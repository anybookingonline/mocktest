import express from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'

const router = express.Router()
router.use(authRequired, adminOnly)

// GET /api/admin/stats - platform overview
router.get('/stats', async (req, res) => {
  const u = async (s, ...p) => (await db.prepare(s).get(...p)).c
  res.json({
    users: await u(`SELECT COUNT(*) c FROM users WHERE role='student'`),
    admins: await u(`SELECT COUNT(*) c FROM users WHERE role='admin'`),
    exams: await u('SELECT COUNT(*) c FROM exams'),
    questions: await u('SELECT COUNT(*) c FROM questions'),
    questionsAI: await u(`SELECT COUNT(*) c FROM questions WHERE source='ai'`),
    questionsPDF: await u(`SELECT COUNT(*) c FROM questions WHERE source='pdf'`),
    tests: await u('SELECT COUNT(*) c FROM tests'),
    attempts: await u('SELECT COUNT(*) c FROM attempts'),
    imports: await u('SELECT COUNT(*) c FROM pdf_imports'),
    importsCompleted: await u(`SELECT COUNT(*) c FROM pdf_imports WHERE status='completed'`),
    newUsersToday: await u(`SELECT COUNT(*) c FROM users WHERE created_at::date = current_date`),
    attemptsToday: await u(`SELECT COUNT(*) c FROM attempts WHERE created_at::date = current_date OR started_at::date = current_date`)
  })
})

// GET /api/admin/questions - same as questions but admin view (full)
router.get('/questions', async (req, res) => {
  const rows = await db.prepare(`SELECT q.*, e.name exam_name, s.name subject_name FROM questions q
    LEFT JOIN exams e ON e.id = q.exam_id LEFT JOIN subjects s ON s.id = q.subject_id
    ORDER BY q.id DESC LIMIT 500`).all()
  res.json({ questions: rows.map(r => ({ ...r, options: JSON.parse(r.options_json || '[]'), tags: JSON.parse(r.tags_json || '[]') })) })
})

// GET /api/admin/users
router.get('/users', async (req, res) => {
  const rows = await db.prepare(`SELECT u.id, u.name, u.email, u.role, u.target_exam, u.created_at,
    (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id AND a.status='completed') tests_taken,
    (SELECT COALESCE(AVG(score),0) FROM attempts a WHERE a.user_id = u.id AND a.status='completed') avg_score
    FROM users u ORDER BY u.created_at DESC`).all()
  res.json({ users: rows })
})

// PUT /api/admin/users/:id - update role / block
router.put('/users/:id', async (req, res) => {
  const b = req.body || {}
  if (b.role && !['student', 'admin'].includes(b.role)) return res.status(400).json({ error: 'Invalid role' })
  await db.prepare('UPDATE users SET role = COALESCE(?, role), name = COALESCE(?, name), target_exam = COALESCE(?, target_exam) WHERE id = ?')
    .run(b.role || null, b.name || null, b.target_exam || null, req.params.id)
  res.json({ ok: true })
})

// POST /api/admin/users - create user
router.post('/users', async (req, res) => {
  const b = req.body || {}
  if (!b.name || !b.email || !b.password) return res.status(400).json({ error: 'name, email, password required' })
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(String(b.email).toLowerCase())
  if (exists) return res.status(409).json({ error: 'Email exists' })
  const hash = bcrypt.hashSync(String(b.password), 10)
  const r = await db.prepare('INSERT INTO users (name, email, password_hash, role, target_exam) VALUES (?,?,?,?,?)')
    .run(b.name, String(b.email).toLowerCase(), hash, b.role || 'student', b.target_exam || null)
  res.status(201).json({ id: r.lastInsertRowid })
})

// DELETE /api/admin/users/:id
router.delete('/users/:id', async (req, res) => {
  if (Number(req.params.id) === req.user.id) return res.status(400).json({ error: 'Cannot delete yourself' })
  const r = await db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id)
  res.json({ deleted: r.changes })
})

// GET /api/admin/attempts - all attempts
router.get('/attempts', async (req, res) => {
  const rows = await db.prepare(`SELECT a.*, u.name user_name, u.email FROM attempts a JOIN users u ON u.id = a.user_id ORDER BY a.started_at DESC LIMIT 200`).all()
  res.json({ attempts: rows })
})

// GET /api/admin/reports - aggregate platform reports
router.get('/reports', async (req, res) => {
  const byExam = await db.prepare(`SELECT e.id, e.name, COUNT(DISTINCT q.id) questions,
    COUNT(DISTINCT CASE WHEN q.source='ai' THEN q.id END) ai,
    COUNT(DISTINCT CASE WHEN q.source='pdf' THEN q.id END) pdf,
    COUNT(DISTINCT a.id) attempts FROM exams e
    LEFT JOIN questions q ON q.exam_id = e.id
    LEFT JOIN attempts a ON a.exam_id = e.id
    GROUP BY e.id ORDER BY e.name`).all()
  const perDay = await db.prepare(`SELECT date(started_at) AS "day", COUNT(*) attempts, SUM(correct + wrong + skipped) questions_answered
    FROM attempts WHERE status='completed' AND started_at::timestamptz >= now() - interval '30 days' GROUP BY "day"`).all()
  const bySource = await db.prepare(`SELECT source, COUNT(*) c FROM questions GROUP BY source`).all()
  const byDifficulty = await db.prepare(`SELECT difficulty, COUNT(*) c FROM questions GROUP BY difficulty`).all()
  res.json({ byExam, perDay, bySource, byDifficulty })
})

// GET /api/admin/settings
router.get('/settings', async (req, res) => {
  const keys = ['platform.name', 'platform.tagline', 'platform.supportEmail', 'ai.provider', 'ai.fallbackEnabled', 'ai.cacheEnabled', 'ai.cacheTtlDays', 'deepseek.apiKey', 'deepseek.model', 'gemini.apiKey', 'gemini.model', 'gemini.visionModel', 'openrouter.apiKey', 'openrouter.model',
    'monetization.gateways', 'monetization.provider', 'monetization.price', 'monetization.currency', 'monetization.retentionDays', 'monetization.freeHoldHours',
    'razorpay.keyId', 'razorpay.keySecret', 'stripe.secretKey', 'stripe.webhookSecret',
    'phonepe.merchantId', 'phonepe.saltKey', 'phonepe.saltIndex', 'phonepe.env', 'phonepe.baseUrl',
    'qr.upiId', 'qr.qrImage', 'qr.holderName', 'qr.note']
  const out = {}
  for (const k of keys) out[k] = (await db.prepare('SELECT value FROM ai_configs WHERE key = ?').get(k))?.value || ''
  res.json({ settings: out })
})

// PUT /api/admin/settings
router.put('/settings', async (req, res) => {
  const b = req.body || {}
  for (const [k, v] of Object.entries(b)) {
    await db.prepare(`INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, String(v))
  }
  res.json({ saved: true })
})

// POST /api/admin/reset-stats - reset usage counters
router.post('/reset-stats', async (req, res) => {
  await db.prepare('UPDATE questions SET usage_count = 0').run()
  res.json({ ok: true })
})

// GET /api/admin/ai-cache - cache stats
router.get('/ai-cache', async (req, res) => {
  const { cacheStats } = await import('../utils/aiService.js')
  res.json(await cacheStats())
})

// POST /api/admin/ai-cache/clear - empty the AI cache
router.post('/ai-cache/clear', async (req, res) => {
  const { clearAiCache } = await import('../utils/aiService.js')
  await clearAiCache()
  res.json({ ok: true })
})

export default router
