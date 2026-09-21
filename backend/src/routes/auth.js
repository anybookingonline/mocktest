import express from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { signToken, authRequired } from '../middleware/auth.js'
import { authLimiter } from '../middleware/rateLimit.js'
import { consumeInvite, notifyLinked } from '../utils/institute.js'
import { awardPoints } from '../utils/points.js'
import { sendVerificationEmail, sendPasswordResetEmail, consumeEmailToken, emailConfigured } from '../utils/email.js'

const router = express.Router()

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar, exam_id: u.exam_id, target_exam: u.target_exam, institute_id: u.institute_id || null, email_verified: Boolean(u.email_verified) }
}

router.post('/register', authLimiter(), async (req, res) => {
  const { name, email, password, target_exam, inviteCode } = req.body || {}
  // Frontend bhi examId bhej sakta hai (dropdown se); naam se bhi resolve hota hai.
  const signupExamId = Number(req.body?.examId) || null
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' })
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase())
  if (exists) return res.status(409).json({ error: 'Email already registered' })
  // Resolve the signup exam selection to its id immediately: the Dashboard
  // shows ONLY the target exam when exam_id is set, so a NULL here would
  // drop every new user into the "choose your exam" state with all exams.
  let examId = Number(signupExamId) || null
  try {
    if (!examId && target_exam) {
      const byName = await db.prepare('SELECT id FROM exams WHERE LOWER(name) = LOWER(?) AND is_active = 1').get(String(target_exam))
      if (!byName) {
        const fuzzy = await db.prepare('SELECT id FROM exams WHERE is_active = 1 AND LOWER(?) LIKE LOWER(name || \'%\') ORDER BY LENGTH(name) LIMIT 1').get(String(target_exam))
        examId = fuzzy?.id || null
      } else examId = byName.id
    }
  } catch { /* exam resolution is best-effort — registration kabhi isse fail na ho */ }
  const hash = bcrypt.hashSync(String(password), 10)
  const r = await db.prepare('INSERT INTO users (name, email, password_hash, role, target_exam, exam_id) VALUES (?, ?, ?, ?, ?, ?)')
    .run(name, String(email).toLowerCase(), hash, 'student', target_exam || null, examId)
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)
  // White-label B2B: an institute invite code auto-links the new student to
  // that institute (and is rejected if invalid/exhausted).
  if (inviteCode) {
    const linked = await consumeInvite({ userId: user.id, code: inviteCode })
    if (!linked.ok) {
      await db.prepare('DELETE FROM users WHERE id = ?').run(user.id)
      return res.status(400).json({ error: linked.error })
    }
  }
  const fresh = await db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)
  // Welcome points — instant positive feedback on day one
  await awardPoints(fresh.id, 'register')
  if (inviteCode) await awardPoints(fresh.id, 'invite_accepted', { dedupe: `invite:${fresh.id}` })
  // Best-effort Telegram welcome if this student has already linked the bot
  notifyLinked(fresh.id, `🎓 Welcome to Aisepadho, ${fresh.name}! Account ready hai — login karo, target exam set karo aur pehla free test do.`).catch(() => {})
  // Best-effort verification email (soft verify — account is already usable)
  const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
  if (await emailConfigured().catch(() => false)) sendVerificationEmail(fresh, baseUrl).catch(() => {})
  res.status(201).json({ token: signToken(fresh), user: publicUser(fresh) })
})

router.post('/login', authLimiter(), async (req, res) => {
  const { email, password } = req.body || {}
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase())
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  res.json({ token: signToken(user), user: publicUser(user) })
})

router.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

// ---------------------------------------------------------------------------
// Email verification + password reset (transactional email flows)
// ---------------------------------------------------------------------------

// POST /api/auth/send-verification — resend the verify link (logged-in user)
router.post('/send-verification', authRequired, async (req, res) => {
  if (req.user.email_verified) return res.json({ ok: true, alreadyVerified: true })
  if (!(await emailConfigured())) return res.status(503).json({ error: 'Email service not configured' })
  const baseUrl = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
  sendVerificationEmail(req.user, baseUrl).catch(() => {})
  res.json({ ok: true })
})

// GET /api/auth/verify-email?token=..&uid=.. — clicked from the email link
router.get('/verify-email', async (req, res) => {
  const { token, uid } = req.query
  const ok = token && uid && await consumeEmailToken(Number(uid), 'verify', token)
  if (ok) await db.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').run(Number(uid))
  const base = process.env.FRONTEND_URL || `${req.protocol}://${req.get('host')}`
  return res.redirect(302, `${base}/verify-email?status=${ok ? 'ok' : 'bad'}`)
})

// POST /api/auth/forgot-password — always 200 (no account enumeration)
router.post('/forgot-password', authLimiter(), async (req, res) => {
  const { email } = req.body || {}
  if (!email) return res.status(400).json({ error: 'Email required' })
  if (!(await emailConfigured())) return res.status(503).json({ error: 'Email service not configured — admin se reset karwao' })
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase())
  if (user) sendPasswordResetEmail(user).catch(() => {}) // fire-and-forget
  res.json({ ok: true, message: 'Agar ye email registered hai, reset code aa chuka hai (spam folder bhi check karein)' })
})

// POST /api/auth/reset-password — { email, code, password }
router.post('/reset-password', authLimiter(), async (req, res) => {
  const { email, code, password } = req.body || {}
  if (!email || !code || !password) return res.status(400).json({ error: 'Email, code and new password required' })
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email).toLowerCase())
  if (!user) return res.status(400).json({ error: 'Invalid or expired code' })
  const ok = await consumeEmailToken(user.id, 'password_reset', code)
  if (!ok) return res.status(400).json({ error: 'Invalid or expired code' })
  const hash = bcrypt.hashSync(String(password), 10)
  await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, user.id)
  res.json({ ok: true, message: 'Password updated — ab naye password se login karo' })
})

router.put('/me', authRequired, async (req, res) => {
  const { name, target_exam, exam_id, avatar, password } = req.body || {}
  await db.prepare('UPDATE users SET name = COALESCE(?, name), target_exam = COALESCE(?, target_exam), exam_id = COALESCE(?, exam_id), avatar = COALESCE(?, avatar), updated_at = now() WHERE id = ?')
    .run(name || null, target_exam || null, exam_id ?? null, avatar || null, req.user.id)
  if (password) {
    const hash = bcrypt.hashSync(String(password), 10)
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id)
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  res.json({ user: publicUser(user) })
})

router.get('/settings', authRequired, async (req, res) => {
  const s = await db.prepare('SELECT value FROM ai_configs WHERE key = ?').get('platform.name')
  res.json({ platformName: s?.value || 'ExamAI' })
})

export default router
