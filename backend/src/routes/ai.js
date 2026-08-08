import express from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { solveDoubtWithAI, explainQuestionWithAI } from '../utils/aiTasks.js'
import { getAiSettings } from '../utils/aiService.js'

const router = express.Router()
router.use(authRequired)

// POST /api/ai/doubt - AI doubt solving for any question
router.post('/doubt', async (req, res) => {
  const { questionId, questionText, message } = req.body || {}
  if (!message) return res.status(400).json({ error: 'message required' })
  let q = null
  if (questionId) q = await db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId)
  try {
    const response = await solveDoubtWithAI({
      questionText: q?.question_text || questionText || '',
      options: q ? JSON.parse(q.options_json || '[]') : [],
      explanation: q?.explanation || '',
      studentMessage: message
    })
    await db.prepare(`INSERT INTO doubts (user_id, question_id, question_text, message, ai_response, model)
      VALUES (?,?,?,?,?,?)`).run(req.user.id, questionId || null, q?.question_text || questionText || null, message, response, 'ai')
    res.json({ response })
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message })
  }
})

// POST /api/ai/explain - generate/refresh explanation for a question
router.post('/explain', async (req, res) => {
  const { questionId } = req.body || {}
  const q = await db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId)
  if (!q) return res.status(404).json({ error: 'Question not found' })
  try {
    const explanation = await explainQuestionWithAI({
      questionText: q.question_text, options: JSON.parse(q.options_json || '[]'), correctAnswer: q.correct_answer
    })
    await db.prepare('UPDATE questions SET explanation = ? WHERE id = ?').run(explanation, q.id)
    res.json({ explanation })
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message })
  }
})

// GET /api/ai/doubts - user's doubt history
router.get('/doubts', async (req, res) => {
  const rows = await db.prepare('SELECT * FROM doubts WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id)
  res.json({ doubts: rows })
})

// ------------------------------- Adaptive engine ----------------------------

const DIFF_POINTS = { easy: 1, medium: 2, hard: 3 }
const DIFF_NAMES = { 1: 'easy', 2: 'medium', 3: 'hard' }

// POST /api/ai/adaptive/start - start adaptive practice session
// body: { examId, subjectId?, chapterId?, topicId?, numQuestions=10 }
router.post('/adaptive/start', async (req, res) => {
  const b = req.body || {}
  if (!b.examId) return res.status(400).json({ error: 'examId required' })
  const num = Number(b.numQuestions) || 10
  const r = await db.prepare(`INSERT INTO attempts (user_id, title, exam_id, kind, status, time_limit_seconds, questions_json)
    VALUES (?, 'Adaptive Practice', ?, 'adaptive', 'in_progress', NULL, '[]')`).run(req.user.id, b.examId)
  await db.prepare(`UPDATE attempts SET questions_json = ? WHERE id = ?`).run(JSON.stringify({ config: b, num, completed: [] }), r.lastInsertRowid)
  res.status(201).json({ attemptId: r.lastInsertRowid })
})

// POST /api/ai/adaptive/:id/next - get next question (adaptive difficulty)
// body: { lastQuestionId?, wasCorrect? }
router.post('/adaptive/:id/next', async (req, res) => {
  const a = await db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!a) return res.status(404).json({ error: 'Session not found' })
  if (a.kind !== 'adaptive') return res.status(400).json({ error: 'Not an adaptive session' })
  let state = parseState(a.questions_json)
  const b = req.body || {}

  // adapt difficulty
  let level = state.currentLevel || 2
  if (b.lastQuestionId != null) {
    if (b.wasCorrect) level = Math.min(3, level + 1)
    else level = Math.max(1, level - 1)
    state.currentLevel = level
    state.completed.push(b.lastQuestionId)
    await updateTopicStats(req.user.id, b.lastQuestionId, b.wasCorrect)
    if (state.completed.length >= state.num) {
      await finishAdaptive(a.id, state)
      return res.json({ done: true, completed: state.completed.length, total: state.num })
    }
  }

  const cfg = state.config || {}
  const where = ['exam_id = ?', 'is_active = 1']
  const params = [cfg.examId]
  if (cfg.subjectId) { where.push('subject_id = ?'); params.push(cfg.subjectId) }
  if (cfg.chapterId) { where.push('chapter_id = ?'); params.push(cfg.chapterId) }
  if (cfg.topicId) { where.push('topic_id = ?'); params.push(cfg.topicId) }
  if (state.completed.length) { where.push(`id NOT IN (${state.completed.map(() => '?').join(',')})`); params.push(...state.completed) }

  let question
  // try current difficulty first, then relax
  for (const d of [DIFF_NAMES[level], level < 3 ? DIFF_NAMES[level + 1] : DIFF_NAMES[level - 1]]) {
    question = await db.prepare(`SELECT * FROM questions WHERE ${where.join(' AND ')} AND difficulty = ? ORDER BY RANDOM() LIMIT 1`).get(...params, d)
    if (question) break
  }
  if (!question) {
    question = await db.prepare(`SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT 1`).get(...params)
  }
  if (!question) return res.status(404).json({ error: 'No more questions available. Try another topic.' })

  const nextAnswers = a.answers_json ? JSON.parse(a.answers_json) : []
  nextAnswers.push({ questionId: question.id })
  state.currentLevel = level
  await db.prepare('UPDATE attempts SET questions_json = ?, answers_json = ? WHERE id = ?')
    .run(JSON.stringify(state), JSON.stringify(nextAnswers), a.id)

  res.json({
    done: false,
    question: {
      id: question.id, qtype: question.qtype, question_text: question.question_text,
      options: JSON.parse(question.options_json || '[]'), correct_answer: question.correct_answer,
      explanation: question.explanation, difficulty: question.difficulty,
      marks: question.marks, negative_marks: question.negative_marks, tags: JSON.parse(question.tags_json || '[]')
    },
    level: DIFF_NAMES[level],
    completed: state.completed.length,
    total: state.num
  })
})

function parseState(str) {
  try { return JSON.parse(str || '{}') } catch { return {} }
}
async function updateTopicStats(userId, questionId, wasCorrect) {
  try {
    const q = await db.prepare('SELECT topic_id FROM questions WHERE id = ?').get(questionId)
    if (!q?.topic_id) return
    await db.prepare(`INSERT INTO topic_stats (user_id, topic_id, attempts, correct, total_time_sec) VALUES (?,?,1,?,0)
      ON CONFLICT(user_id, topic_id) DO UPDATE SET attempts = topic_stats.attempts + 1, correct = topic_stats.correct + excluded.correct`)
      .run(userId, q.topic_id, wasCorrect ? 1 : 0)
  } catch { /* non-fatal */ }
}
async function finishAdaptive(id, state) {
  try {
    const answers = await db.prepare('SELECT answers_json FROM attempts WHERE id = ?').get(id)
    const list = answers?.answers_json ? JSON.parse(answers.answers_json) : []
    const correct = list.filter(x => x.selected != null && x.correct).length
    const wrong = list.filter(x => x.selected != null && !x.correct).length
    const total = list.length
    await db.prepare(`UPDATE attempts SET status='completed', completed_at=now(), correct=?, wrong=?,
      skipped=?, score=?, accuracy=?, questions_json=? WHERE id=?`)
      .run(correct, wrong, Math.max(0, total - correct - wrong), correct * 4 - wrong, total ? Math.round((correct / total) * 1000) / 10 : 0,
        JSON.stringify({ ...state, done: true }), id)
  } catch { /* non-fatal */ }
}

// GET /api/ai/provider-status (view of which providers configured)
router.get('/provider-status', async (req, res) => {
  const s = await getAiSettings()
  res.json({
    provider: s['ai.provider'] || 'deepseek',
    fallbackEnabled: s['ai.fallbackEnabled'] !== 'false',
    deepseekConfigured: Boolean(s['deepseek.apiKey']),
    geminiConfigured: Boolean(s['gemini.apiKey']),
    openrouterConfigured: Boolean(s['openrouter.apiKey'])
  })
})

// POST /api/ai/config (admin) - save provider settings
router.post('/config', adminOnly, async (req, res) => {
  const b = req.body || {}
  const allowed = ['ai.provider', 'ai.fallbackEnabled', 'deepseek.apiKey', 'deepseek.model', 'gemini.apiKey', 'gemini.model', 'gemini.visionModel', 'openrouter.apiKey', 'openrouter.model']
  for (const [k, v] of Object.entries(b)) {
    if (allowed.includes(k) && v != null) {
      await db.prepare(`INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, String(v))
    }
  }
  const s = await getAiSettings()
  res.json({ saved: true, provider: s['ai.provider'] })
})

export default router
