import { Router } from 'express'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { dueRevision, startRevisionMock, generateDoubtMock, runRevisionCron } from '../utils/revision.js'
import { solveDoubtWithAI } from '../utils/aiTasks.js'
import db from '../db.js'

// ---------------------------------------------------------------------------
// Spaced Revision (#7) + Doubt Revision (#4) routes.
// ---------------------------------------------------------------------------

const router = Router()

// GET /api/revision/cron?secret=... — daily cron (secret-protected; NO JWT —
// external cron runners call this). Decay stale boxes + Telegram nudges.
router.get('/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(403).json({ error: 'CRON_SECRET not configured' })
  if (String(req.query.secret || '') !== secret) return res.status(401).json({ error: 'Invalid secret' })
  const out = await runRevisionCron()
  res.json({ ok: true, ...out })
})

router.use(authRequired)

// GET /api/revision/due — today's "ye revise karo" list (forgetting curve)
router.get('/due', async (req, res) => {
  const due = await dueRevision(req.user.id, { limit: 12 })
  res.json({ due })
})

// POST /api/revision/start — one-click 10-Q mixed revision mock
router.post('/start', async (req, res) => {
  const out = await startRevisionMock(req.user.id)
  if (out.empty) return res.status(404).json({ error: 'Aaj kuch due nahi hai — practice karte raho! 🎉' })
  res.status(201).json(out)
})

// POST /api/revision/doubt-mock — generate 3 similar questions for a doubt (#4)
router.post('/doubt-mock', async (req, res) => {
  const doubtId = Number(req.body?.doubtId)
  if (!doubtId) return res.status(400).json({ error: 'doubtId required' })
  const out = await generateDoubtMock({ doubtId, userId: req.user.id })
  if (out.error) return res.status(400).json({ error: out.error })
  res.status(201).json(out)
})

// POST /api/revision/admin/run-cron (admin manual trigger)
router.post('/admin/run-cron', adminOnly, async (_req, res) => {
  const out = await runRevisionCron()
  res.json({ ok: true, ...out })
})

export default router
