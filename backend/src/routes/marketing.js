import { Router } from 'express'
import { authRequired, platformOnly } from '../middleware/auth.js'
import { aiLimiter, rateLimit } from '../middleware/rateLimit.js'
import { buildWeeklyCalendar, generateAsset, schoolOutreach, salesChat, marketingStats } from '../utils/marketing.js'

// ---------------------------------------------------------------------------
// Marketing Studio routes.
//   /api/marketing/*       — platform-admin only (generation + stats)
//   /api/marketing/chat    — PUBLIC (marketing site widget), rate-limited
// ---------------------------------------------------------------------------

const router = Router()

router.use(authRequired, platformOnly)

// Weekly content calendar (AI)
router.post('/calendar', aiLimiter({ max: 5 }), async (req, res) => {
  try {
    res.json(await buildWeeklyCalendar(req.body || {}))
  } catch (e) {
    res.status(502).json({ error: 'AI generation failed: ' + e.message })
  }
})

// Single asset generator (reel script, WhatsApp broadcast, winner post, tips)
router.post('/asset', aiLimiter({ max: 10 }), async (req, res) => {
  try {
    res.json(await generateAsset(String(req.body?.type || ''), req.body?.payload || {}))
  } catch (e) {
    res.status(e.status || 502).json({ error: e.status ? e.message : 'AI generation failed: ' + e.message })
  }
})

// B2B outreach sequence (email + WhatsApp 4-touch + objection sheet)
router.post('/outreach', aiLimiter({ max: 10 }), async (req, res) => {
  try {
    res.json(await schoolOutreach(req.body || {}))
  } catch (e) {
    res.status(502).json({ error: 'AI generation failed: ' + e.message })
  }
})

// Rollout snapshot: signups, chat usage, coupon performance
router.get('/stats', async (req, res) => {
  res.json(await marketingStats())
})

// ------------------------- PUBLIC sales chat (widget) -----------------------
// Mounted below admin guard via a sub-router so it stays public but limited.
const chatRouter = Router()
chatRouter.post('/chat', rateLimit({ key: 'sales-chat', windowSec: 60, max: 8, message: 'Too many messages — please wait a moment.' }), async (req, res) => {
  const lang = ['en', 'hinglish', 'hi'].includes(req.body?.lang) ? req.body.lang : ''
  const fallbackReply = {
    en: 'A technical glitch — please try again in a bit! 😊',
    hi: 'थोड़ी तकनीकी दिक्कत है — थोड़ी देर बाद कोशिश करें! 😊',
    hinglish: 'Thodi technical dikkat hai — thodi der baad try karo! 😊'
  }[lang || 'hinglish']
  try {
    const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-10) : []
    res.json(await salesChat({ messages, lang }))
  } catch (e) {
    res.status(502).json({ error: 'Chat unavailable right now.', reply: fallbackReply, quick: [] })
  }
})

export { chatRouter }
export default router
