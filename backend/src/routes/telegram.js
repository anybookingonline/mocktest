import { Router } from 'express'
import db from '../db.js'
import { getConfig, setConfig } from '../utils/aiService.js'
import { solveDoubtWithAI } from '../utils/aiTasks.js'
import { getEntitlements, doubtCapFor } from '../utils/addons.js'
import { aiLimiter } from '../middleware/rateLimit.js'

// White-label: the bot speaks with the platform's (or institute's) name.
async function brandName() {
  const s = await db.prepare(`SELECT value FROM ai_configs WHERE key = 'platform.name'`).get()
  return s?.value || 'Aisepadho'
}

// ---------------------------------------------------------------------------
// Telegram tutor bot (official Bot API, no SDK). Feature-flagged: the webhook
// answers only when admin enables it AND a bot token is configured.
//
// Flow: student opens the bot in Telegram -> /start CODE (from their Doubts
// page) -> account linked. After that any text they send is a doubt, answered
// by the same AI engine as the in-app tutor, with a daily per-user cap.
// ---------------------------------------------------------------------------

const router = Router()
const DAILY_FREE = 10

const HELP = [
  '🎓 *Tutor Bot* — aapke doubts, seedha Telegram par',
  '',
  'Kisi bhi question ya concept ka doubt Hindi/English/Hinglish me type karo — main turant jawab dunga.',
  '',
  '/start CODE — account link karo (code app ke Doubts page par milta hai)',
  '/stats — aaj ke remaining doubts',
  '/unlink — account unlink karo',
  '/help — ye message'
].join('\n')

function esc(s) {
  return String(s || '').replace(/[_*[\]()`>~]/g, (c) => '\\' + c)
}

async function send(chatId, text) {
  const token = await getConfig('telegram.botToken')
  if (!token) return
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'MarkdownV2', disable_web_page_preview: true })
  }).catch(() => {})
}

// Per-user daily usage (resets every UTC midnight — good enough for a bot cap)
async function usageKey(userId) {
  const day = new Date().toISOString().slice(0, 10)
  return `tg:${userId}:${day}`
}

async function handleUpdate(update) {
  const msg = update.message
  if (!msg || !msg.text) return
  const chatId = String(msg.chat.id)
  const text = msg.text.trim()

  if (text.startsWith('/start')) {
    const code = text.split(/\s+/)[1]
    if (!code) return send(chatId, `Link code missing. Apne ${await brandName()} app → Doubts page par code milega. Wahan se /start CODE bhejo.`)
    const row = await db.prepare('SELECT user_id FROM ai_configs WHERE key LIKE ? AND value = ?')
      .all('tgcode:%', code).catch(() => [])
    // Deterministic codes: recompute instead of storing — match against users
    const crypto = await import('crypto')
    const secret = await getConfig('telegram.botToken') || ''
    const users = await db.prepare('SELECT id FROM users').all()
    const match = users.find((u) => crypto.createHash('sha256').update(`${secret}:${u.id}`).digest('hex').slice(0, 8).toUpperCase() === code)
    if (!match) return send(chatId, 'Code galat hai. Doubts page par latest code check karo.')
    await db.prepare(`INSERT INTO telegram_links (user_id, telegram_chat_id, username)
      VALUES (?, ?, ?)
      ON CONFLICT (user_id) DO UPDATE SET telegram_chat_id = excluded.telegram_chat_id, username = excluded.username, linked_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')`)
      .run(match.id, chatId, msg.from?.username || null)
    return send(chatId, '✅ Link ho gaya! Ab koi bhi doubt type karo — main turant jawab dunga.')
  }

  if (text === '/unlink') {
    await db.prepare('DELETE FROM telegram_links WHERE telegram_chat_id = ?').run(chatId)
    return send(chatId, 'Account unlink kar diya. Phir se link karne ke liye /start CODE bhejo.')
  }

  const link = await db.prepare('SELECT user_id FROM telegram_links WHERE telegram_chat_id = ?').get(chatId)
  if (!link) {
    return send(chatId, `Pehle account link karo: /start CODE (code ${await brandName()} app → Doubts page par hai).`)
  }

  if (text === '/help' || text === '/start') return send(chatId, HELP)

  const ent = await getEntitlements(link.user_id)
  // Fair-use, not unlimited, even for AI Power Pack — same cap the app itself
  // enforces (monetization.paidDoubtsPerDay), so Telegram can't be used to
  // route around the very cap that makes the cost predictable.
  const cap = ent.aiPower ? await doubtCapFor(ent) : DAILY_FREE

  if (text === '/stats') {
    const used = Number(await getConfig(usageKey(link.user_id), '0')) || 0
    return send(chatId, ent.aiPower ? `⚡ *AI Power Pack* active — *${used}/${cap}* doubts today (fair-use).` : `Aaj ke doubts: *${used}/${cap}* used.`)
  }

  // Doubt -> AI, against the fair-use cap above.
  {
    const used = Number(await getConfig(usageKey(link.user_id), '0')) || 0
    if (used >= cap) {
      return send(chatId, `Aaj ka doubt limit (${cap}) khatam ho gaya. Kal phir try karo${ent.aiPower ? '' : ' — ya app me AI Power Pack dekho, roz zyada doubts milte hain'}! 📚`)
    }
    await setConfig(usageKey(link.user_id), String(used + 1))
  }

  await send(chatId, '🤔 Soch raha hoon…')
  try {
    const answer = await solveDoubtWithAI({ questionText: '', options: [], explanation: '', studentMessage: text })
    // Telegram messages cap at 4096 chars
    const out = answer.length > 3900 ? answer.slice(0, 3900) + '\n\n…(app me poora answer dekho)' : answer
    await db.prepare(`INSERT INTO doubts (user_id, question_text, message, ai_response, model)
      VALUES (?, NULL, ?, ?, 'telegram')`).run(link.user_id, text, answer)
    await send(chatId, esc(out))
  } catch (e) {
    await send(chatId, 'Sorry, abhi answer nahi de paya. Thodi der baad try karo.')
  }
}

// Telegram calls this webhook; secret header check prevents spoofing
router.post('/webhook', aiLimiter({ max: 60, windowSec: 60 }), async (req, res) => {
  const secret = await getConfig('telegram.webhookSecret')
  // Hard requirement once a secret exists: without this check anyone on the
  // internet could POST fake Telegram updates (spoof /start codes, inject
  // messages, enumerate link codes). Fail closed — Telegram retries anyway.
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ ok: false })
  }
  if (!secret) {
    // No secret configured yet (fresh bot) — reject unsigned traffic loudly.
    // The admin 'Wire webhook automatically' button sets the secret atomically.
    return res.status(401).json({ ok: false, error: 'Webhook secret not configured — press Wire webhook in Admin → AI Config' })
  }
  res.json({ ok: true }) // answer Telegram immediately; process after
  try { await handleUpdate(req.body || {}) } catch (e) {
    console.error('[telegram] update error:', e.message)
  }
})

// Admin helpers: wire the webhook URL + send a test message
//
// Webhook URL resolution (in priority order):
//   1. `telegram.webhookDomain` admin setting — e.g. https://aisepadho.com
//      (set this when the bot was created against a different host, like the
//      Vercel frontend domain: Telegram only needs ONE public HTTPS URL and
//      the frontend already proxies /api/* to the backend)
//   2. BACKEND_URL env
//   3. the request's own origin (same-host deployments)
router.post('/admin/setup', authRequiredAdmin, async (req, res) => {
  const token = await getConfig('telegram.botToken')
  if (!token) return res.status(400).json({ error: 'telegram.botToken not configured' })
  const override = (await getConfig('telegram.webhookDomain') || '').trim().replace(/\/$/, '')
  const base = override || process.env.BACKEND_URL || `${req.protocol}://${req.get('host')}`
  const url = `${base}/api/telegram/webhook`
  const whSecret = Math.random().toString(36).slice(2, 14)
  const apiRes = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, secret_token: whSecret, allowed_updates: ['message'] })
  })
  const data = await apiRes.json().catch(() => ({}))
  if (!data.ok) return res.status(502).json({ error: data.description || 'setWebhook failed' })
  await setConfig('telegram.webhookSecret', whSecret)
  res.json({ ok: true, webhookUrl: url })
})

router.post('/admin/test', authRequiredAdmin, async (req, res) => {
  const token = await getConfig('telegram.botToken')
  const chatId = req.body?.chatId
  if (!token || !chatId) return res.status(400).json({ error: 'botToken + chatId required' })
  const r = await send(String(chatId), `✅ ${(await brandName())} Telegram bot test — wiring works!`)
  res.json({ ok: r !== false })
})

async function authRequiredAdmin(req, res, next) {
  const { authRequired, platformOnly } = await import('../middleware/auth.js')
  authRequired(req, res, (e) => e ? next(e) : platformOnly(req, res, next))
}

export default router
