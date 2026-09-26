import express from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { authRequired, adminOnly, platformOnly } from '../middleware/auth.js'
import { b2SelfTest, b2Status } from '../utils/b2.js'
import { ADDONS } from '../utils/addons.js'

// Built from the ADDONS registry itself (not hand-copied) so a new addon's
// enabled/monthly/yearly price keys are automatically readable/saveable here
// the moment it's added to addons.js — never falls out of sync.
function addonConfigKeys() {
  const keys = []
  for (const a of Object.values(ADDONS)) {
    keys.push(a.enabledKey, a.monthly.priceKey, a.yearly.priceKey)
  }
  return keys
}

const router = express.Router()
router.use(authRequired, platformOnly)

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
  const keys = ['platform.name', 'platform.tagline', 'platform.supportEmail', 'platform.logoUrl', 'platform.domain', 'ai.provider', 'ai.fallbackEnabled', 'ai.cacheEnabled', 'ai.cacheTtlDays', 'deepseek.apiKey', 'deepseek.model', 'gemini.apiKey', 'gemini.model', 'gemini.visionModel', 'openrouter.apiKey', 'openrouter.model',
    'monetization.gateways', 'monetization.provider', 'monetization.price', 'monetization.currency', 'monetization.retentionDays', 'monetization.freeHoldHours',
    ...addonConfigKeys(),
    'features.currentAffairs', 'features.focusAreas',
    'features.groupStudy', 'features.groupDiscussions', 'features.battles',
    'groups.freeAfterPaid', 'groups.freeSlots', 'groups.maxFree', 'groups.maxMembers', 'groups.freeSeatDays',
    'razorpay.keyId', 'razorpay.keySecret', 'stripe.secretKey', 'stripe.webhookSecret',
    'phonepe.merchantId', 'phonepe.saltKey', 'phonepe.saltIndex', 'phonepe.env', 'phonepe.baseUrl',
    'qr.upiId', 'qr.qrImage', 'qr.holderName', 'qr.note',
    'b2.keyId', 'b2.appKey', 'b2.bucketId', 'b2.bucketName', 'b2.publicBaseUrl',
    'exa.apiKey', 'exa.monthlyLimit', 'gravity.apiKey', 'features.contextualAds',
    'maintenance.enabled', 'maintenance.message', 'maintenance.eta',
    'telegram.botToken', 'telegram.botUsername', 'telegram.webhookDomain']
  const out = {}
  for (const k of keys) out[k] = (await db.prepare('SELECT value FROM ai_configs WHERE key = ?').get(k))?.value || ''
  res.json({ settings: out })
})

// PUT /api/admin/settings
router.put('/settings', async (req, res) => {
  const b = req.body || {}
  // Secret-shaped keys are never cleared by an empty save — an admin leaving
  // the (masked/blank) field untouched must not wipe a live bot/payment key.
  const SECRET_KEY = /(botToken|apiKey|keySecret|secretKey|webhookSecret|saltKey|appKey)$/
  for (const [k, v] of Object.entries(b)) {
    if (SECRET_KEY.test(k) && !String(v).trim()) continue
    // Maintenance flag arrives as a boolean from the toggle UI — normalize to
    // '1'/'0' so every reader (gate, status endpoint) can truthy-test it.
    if (k === 'maintenance.enabled') {
      await db.prepare(`INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, (v === true || v === 'true' || v === 1 || v === '1') ? '1' : '0')
      continue
    }
    if (k === 'maintenance.message' || k === 'maintenance.eta') {
      await db.prepare(`INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, String(v ?? '').slice(0, 300))
      continue
    }
    await db.prepare(`INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, String(v))
  }
  res.json({ saved: true })
})

// GET /api/admin/maintenance — lightweight status read for the toggle UI
router.get('/maintenance', async (req, res) => {
  const get = async (k) => (await db.prepare('SELECT value FROM ai_configs WHERE key = ?').get(k))?.value || ''
  res.json({
    enabled: (await get('maintenance.enabled')) === '1',
    message: await get('maintenance.message'),
    eta: await get('maintenance.eta')
  })
})

// POST /api/admin/reset-stats - reset usage counters
router.post('/reset-stats', async (req, res) => {
  await db.prepare('UPDATE questions SET usage_count = 0').run()
  res.json({ ok: true })
})

// GET /api/admin/storage - current storage mode (B2 configured from env or settings)
router.get('/storage', async (req, res) => {
  res.json({ storage: await b2Status() })
})

// POST /api/admin/storage/test - live B2 round-trip: authorize → upload → download → delete
router.post('/storage/test', async (req, res) => {
  try { res.json(await b2SelfTest()) } catch (e) { res.status(500).json({ ok: false, error: e.message, steps: [] }) }
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
