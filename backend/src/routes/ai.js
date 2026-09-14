import express from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { authLimiter, aiLimiter } from '../middleware/rateLimit.js'
import multer from 'multer'
import { solveDoubtWithAI, explainQuestionWithAI, generateQuestionsWithAI, persistQuestions } from '../utils/aiTasks.js'
import { getAiSettings, getFeatureFlags, transcribeAudio, getConfig, CUSTOM_PRESETS } from '../utils/aiService.js'
import { getEntitlements } from '../utils/addons.js'
import { awardPoints } from '../utils/points.js'
import { getContextualAd, publicAdFields } from '../utils/monetize.js'

const router = express.Router()
router.use(authRequired)

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^audio\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('Only audio files are allowed'))
  }
})

// GET /api/ai/features - which optional features are enabled for THIS user
// (admin toggle AND the user's paid entitlements drive the student UI)
router.get('/features', async (req, res) => {
  const flags = await getFeatureFlags()
  const ent = await getEntitlements(req.user.id)
  res.json({
    ...flags,
    voiceUnlocked: flags.voiceDoubts && ent.voiceDoubts,
    telegramUnlimited: flags.telegramBot && ent.aiPower,
    addons: ent.addons
  })
})

// POST /api/ai/doubt - AI doubt solving for any question
router.post('/doubt', aiLimiter(), async (req, res) => {
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
    // Recognition: asking + resolving a doubt both earn points
    await awardPoints(req.user.id, 'doubt_asked')
    await awardPoints(req.user.id, 'doubt_resolved')
    // Contextual ad (free users only; paid users keep a clean tutor surface).
    // Fire-and-forget semantics: ad failure never affects the doubt response.
    let ad = null
    try {
      const ent = await getEntitlements(req.user.id)
      if (!ent.aiPower) {
        ad = publicAdFields(await getContextualAd({
          messages: [
            { role: 'user', content: (q?.question_text || questionText || '') + ' — ' + message },
            { role: 'assistant', content: String(response).slice(0, 500) }
          ],
          sessionId: `doubt-${req.user.id}`,
          user: { id: req.user.id },
          device: { ua: req.headers['user-agent'] || '', ip: req.ip || '' }
        }))
      }
    } catch { /* ads are best-effort */ }
    res.json({ response, ad })
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message })
  }
})

// POST /api/ai/explain - generate/refresh explanation for a question
router.post('/explain', aiLimiter(), async (req, res) => {
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

// POST /api/ai/transcribe - voice doubt: audio -> text (Whisper), then the
// frontend sends the transcript through /ai/doubt as usual
router.post('/transcribe', aiLimiter(), voiceUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Audio file required' })
  // Voice is a paid add-on — server-side enforcement, not just UI hiding
  const ent = await getEntitlements(req.user.id)
  if (!ent.voiceDoubts) return res.status(402).json({ error: 'Voice Doubts add-on required', upgrade: '/retention' })
  try {
    const text = await transcribeAudio({ buffer: req.file.buffer, mimeType: req.file.mimetype })
    res.json({ text })
  } catch (e) {
    res.status(502).json({ error: 'Transcription failed: ' + e.message })
  }
})

// GET /api/ai/telegram/link - one-time bot code for linking a student account
router.get('/telegram/link', async (req, res) => {
  const s = await getFeatureFlags()
  if (!s.telegramBot) return res.status(403).json({ error: 'Telegram tutor is not enabled' })
  // user-scoped code: deterministic so it can be re-shown without storing state
  const crypto = await import('crypto')
  const secret = await getConfig('telegram.botToken')
  const code = crypto.createHash('sha256').update(`${secret}:${req.user.id}`).digest('hex').slice(0, 8).toUpperCase()
  res.json({ code, botUsername: (await getConfig('telegram.botUsername')) || '' })
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
router.post('/adaptive/start', aiLimiter(), async (req, res) => {
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
  // Scoped picker: current difficulty first, then relax one step.
  const pick = async (scope = {}) => {
    const where = ['exam_id = ?', 'is_active = 1']
    const params = [scope.examId ?? cfg.examId]
    const subjectId = scope.subjectId !== undefined ? scope.subjectId : cfg.subjectId
    const chapterId = scope.chapterId !== undefined ? scope.chapterId : cfg.chapterId
    const topicId = scope.topicId !== undefined ? scope.topicId : cfg.topicId
    if (subjectId) { where.push('subject_id = ?'); params.push(subjectId) }
    if (chapterId) { where.push('chapter_id = ?'); params.push(chapterId) }
    if (topicId) { where.push('topic_id = ?'); params.push(topicId) }
    if (state.completed.length) { where.push(`id NOT IN (${state.completed.map(() => '?').join(',')})`); params.push(...state.completed) }
    for (const d of [DIFF_NAMES[level], level < 3 ? DIFF_NAMES[level + 1] : DIFF_NAMES[level - 1]]) {
      const q = await db.prepare(`SELECT * FROM questions WHERE ${where.join(' AND ')} AND difficulty = ? ORDER BY RANDOM() LIMIT 1`).get(...params, d)
      if (q) return q
    }
    return db.prepare(`SELECT * FROM questions WHERE ${where.join(' AND ')} ORDER BY RANDOM() LIMIT 1`).get(...params)
  }

  let question = await pick()
  let aiGenerated = false
  let relaxed = false
  // 1) AI fallback: empty topic (e.g. fresh Bank PO syllabus) used to hard-404.
  //    Generate a small batch once, persist it under the same topic mapping and
  //    the normal DB picker serves the rest of the session for free.
  if (!question && (await generateAdaptiveBatch(state, level))) {
    question = await pick()
    aiGenerated = Boolean(question)
  }
  // 2) Last resort: widen the scope (topic -> chapter -> subject -> exam) so a
  //    session never dies mid-way. Flagged so the UI can tell the student.
  if (!question) {
    question = await pick({ topicId: null })
    if (!question) question = await pick({ topicId: null, chapterId: null })
    if (!question) question = await pick({ topicId: null, chapterId: null, subjectId: null })
    relaxed = Boolean(question)
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
    total: state.num,
    aiGenerated,
    relaxed
  })
})

function parseState(str) {
  try { return JSON.parse(str || '{}') } catch { return {} }
}

// AI generation fallback for adaptive sessions. Cost-guarded: max 4 AI calls
// per session, then the relaxed DB picker takes over. Failures are non-fatal.
async function generateAdaptiveBatch(state, level) {
  try {
    const cfg = state.config || {}
    if (!cfg.examId) return false
    state.aiCount = Number(state.aiCount) || 0
    if (state.aiCount >= 4) return false
    const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(Number(cfg.examId))
    if (!exam) return false
    const subject = cfg.subjectId ? await db.prepare('SELECT name FROM subjects WHERE id = ?').get(Number(cfg.subjectId)) : null
    const chapter = cfg.chapterId ? await db.prepare('SELECT name FROM chapters WHERE id = ?').get(Number(cfg.chapterId)) : null
    const topic = cfg.topicId ? await db.prepare('SELECT name FROM topics WHERE id = ?').get(Number(cfg.topicId)) : null
    const list = await generateQuestionsWithAI({
      exam, count: 3,
      subject: subject?.name || null, chapter: chapter?.name || null, topic: topic?.name || null,
      difficulty: DIFF_NAMES[level] || 'medium',
      seed: `adaptive-${state.completed?.length || 0}-${Date.now()}`
    })
    if (!Array.isArray(list) || !list.length) return false
    await persistQuestions(list, {
      exam, source: 'ai', sourceMeta: { generatedBy: 'adaptive' },
      mapping: { subjectId: cfg.subjectId || null, chapterId: cfg.chapterId || null, topicId: cfg.topicId || null }
    })
    state.aiCount += 1 // persisted with the session state on the next save
    return true
  } catch { return false }
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
    openrouterConfigured: Boolean(s['openrouter.apiKey']),
    customConfigured: Boolean(s['custom.baseUrl'] && s['custom.enabled'] !== 'false')
  })
})

// GET /api/ai/custom-presets (admin) - quick presets for the custom provider
router.get('/custom-presets', adminOnly, (req, res) => {
  res.json({ presets: CUSTOM_PRESETS })
})

// POST /api/ai/config (admin) - save provider settings
router.post('/config', adminOnly, aiLimiter(), async (req, res) => {
  const b = req.body || {}
  const allowed = ['ai.provider', 'ai.fallbackEnabled', 'deepseek.apiKey', 'deepseek.model', 'gemini.apiKey', 'gemini.model', 'gemini.visionModel', 'openrouter.apiKey', 'openrouter.model', 'custom.name', 'custom.baseUrl', 'custom.apiKey', 'custom.model', 'custom.enabled',
    'features.voiceDoubts', 'features.telegramBot', 'openai.apiKey', 'telegram.botToken', 'telegram.botUsername']
  for (const [k, v] of Object.entries(b)) {
    if (allowed.includes(k) && v != null) {
      await db.prepare(`INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(k, String(v))
    }
  }
  const s = await getAiSettings()
  res.json({ saved: true, provider: s['ai.provider'] })
})

export default router
