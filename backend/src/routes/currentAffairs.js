import { Router } from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { getEntitlements } from '../utils/addons.js'
import { getOrCreateDailyQuiz } from '../utils/currentAffairs.js'

// ---------------------------------------------------------------------------
// Current Affairs Pro — daily AI quiz. Entitlement: current_affairs add-on,
// or any base paid plan (retention/ai_power holders get it bundled).
// ---------------------------------------------------------------------------

const router = Router()
router.use(authRequired)

async function hasAccess(userId) {
  const e = await getEntitlements(userId)
  return e.currentAffairs || e.retention || e.aiPower
}

// GET /api/ca/today — today's quiz metadata (or 402 if not entitled)
router.get('/today', async (req, res) => {
  const u = await db.prepare('SELECT target_exam FROM users WHERE id = ?').get(req.user.id)
  let exam = null
  if (u?.target_exam) {
    exam = await db.prepare('SELECT * FROM exams WHERE code ILIKE ? OR name ILIKE ? ORDER BY id LIMIT 1')
      .get(`%${u.target_exam}%`, `%${u.target_exam}%`)
  }
  if (!exam) exam = await db.prepare('SELECT * FROM exams ORDER BY id LIMIT 1').get()
  if (!exam) return res.status(404).json({ error: 'No exams configured' })
  if (!(await hasAccess(req.user.id))) {
    return res.status(402).json({ error: 'Current Affairs Pro chahiye — Plans page se unlock karo.', upgrade: true })
  }
  try {
    const quiz = await getOrCreateDailyQuiz(exam)
    // strip answers — student view
    res.json({
      testId: quiz.testId, cached: quiz.cached, exam: { id: exam.id, name: exam.name },
      count: quiz.questions.length,
      questions: quiz.questions.map(({ correct_answer, explanation, ...rest }) => rest)
    })
  } catch (e) {
    res.status(502).json({ error: e.message })
  }
})

// POST /api/ca/attempt — start an attempt on today's quiz via the standard flow
router.post('/attempt', async (req, res) => {
  if (!(await hasAccess(req.user.id))) {
    return res.status(402).json({ error: 'Current Affairs Pro chahiye — Plans page se unlock karo.', upgrade: true })
  }
  const u = await db.prepare('SELECT target_exam FROM users WHERE id = ?').get(req.user.id)
  let exam = u?.target_exam
    ? await db.prepare('SELECT * FROM exams WHERE code ILIKE ? OR name ILIKE ? ORDER BY id LIMIT 1').get(`%${u.target_exam}%`, `%${u.target_exam}%`)
    : null
  if (!exam) exam = await db.prepare('SELECT * FROM exams ORDER BY id LIMIT 1').get()
  if (!exam) return res.status(404).json({ error: 'No exams configured' })
  const quiz = await getOrCreateDailyQuiz(exam)
  const a = await db.prepare(`INSERT INTO attempts (test_id, user_id, title, exam_id, kind, status, time_limit_seconds, duration_seconds, questions_json)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(
    quiz.testId, req.user.id, `Current Affairs Quiz`, exam.id, 'current_affairs', 'in_progress',
    quiz.questions.length * 90, 0, JSON.stringify(quiz.questions.map((q) => q.id)))
  res.status(201).json({ attemptId: Number(a.lastInsertRowid), questionCount: quiz.questions.length, timeLimitSeconds: quiz.questions.length * 90 })
})

// GET /api/ca/admin/stats
router.get('/admin/stats', authRequired, adminOnly, async (_req, res) => {
  res.json(await (await import('../utils/currentAffairs.js')).caStats())
})

export default router
