import express from 'express'
import db from '../db.js'
import { authRequired, adminOnly, platformOnly } from '../middleware/auth.js'
import { authLimiter, aiLimiter } from '../middleware/rateLimit.js'
import multer from 'multer'
import { solveDoubtWithAI, explainQuestionWithAI, generateQuestionsWithAI, persistQuestions } from '../utils/aiTasks.js'
import { getAiSettings, getFeatureFlags, transcribeAudio, getConfig, CUSTOM_PRESETS, visionSolvePhoto } from '../utils/aiService.js'
import { getEntitlements, doubtCapFor } from '../utils/addons.js'
import { awardPoints } from '../utils/points.js'
import { getContextualAd, publicAdFields } from '../utils/monetize.js'
import { checkInstituteAiQuota } from '../utils/institute.js'
import { visibilityInstId } from '../utils/visibility.js'

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

const photoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true)
    else cb(new Error('Only image files are allowed'))
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

// GET /api/ai/doubt-quota — live doubt counter for the UI (tier-aware).
// Free users see used/limit with upgrade CTA at 0; paid users see their
// high soft-cap too ("fair-use 50/day") so the limit never surprises them.
router.get('/doubt-quota', async (req, res) => {
  const ent = await getEntitlements(req.user.id)
  const cap = await doubtCapFor(ent)
  // Only root doubts count against the daily cap — Socratic hint follow-ups
  // within an already-counted thread are free (see /doubt below).
  const used = await db.prepare(`SELECT COUNT(*) c FROM doubts WHERE user_id = ? AND parent_doubt_id IS NULL AND created_at::date = current_date`).get(req.user.id)
  const u = Math.min(Number(used?.c) || 0, cap)
  res.json({
    capped: true,
    tier: ent.aiPower || ent.retention ? 'paid' : 'free',
    limit: cap,
    used: u,
    remaining: Math.max(0, cap - u),
    upgrade: ent.aiPower || ent.retention ? null : 'ai_power'
  })
})

// Guardrails for a NEW root doubt (institute pilot quota + per-user daily
// cap). Shared by /doubt and /doubt-photo — Socratic follow-ups in an
// existing thread skip this entirely (the thread's root already counted).
// Returns null when OK, or the {status, body} to respond with when blocked.
async function checkRootDoubtQuota(userId) {
  // Pilot loss guardrail: per-institute daily AI quota (all students combined).
  // Applies before per-user entitlement checks so a free-month pilot can never
  // run an unbounded AI bill (docs/pricing-audit.md §3).
  const instQuota = await checkInstituteAiQuota(userId)
  if (!instQuota.ok) {
    return { status: 429, body: { error: `Aaj aapke institute ka AI quota (${instQuota.quota} doubts) khatam ho gaya hai — kal subah phir try karo.`, quota: instQuota.quota, used: instQuota.used } }
  }
  // Unit-economics guard: every user gets a daily doubt cap by tier
  // (free=monetization.freeDoubtsPerDay, paid=monetization.paidDoubtsPerDay
  // soft-cap). Without this, every free account costs real AI money with
  // zero revenue attached (see docs/pricing-audit.md). Only root doubts
  // count — Socratic follow-ups don't re-check.
  const entGuard = await getEntitlements(userId)
  const cap = await doubtCapFor(entGuard)
  const used = await db.prepare(`SELECT COUNT(*) c FROM doubts WHERE user_id = ? AND parent_doubt_id IS NULL AND created_at::date = current_date`).get(userId)
  if (Number(used?.c) >= cap) {
    return {
      status: 402,
      body: {
        error: entGuard.aiPower || entGuard.retention
          ? `Aaj ke ${cap} AI doubts (fair-use limit) khatam ho gaye — kal phir try karo. Priority support: support@aisepadho.com`
          : `Aaj ke ${cap} free AI doubts khatam ho gaye — kal phir try karo, ya AI Power Pack lo zyada doubts ke liye.`,
        upgrade: entGuard.aiPower ? null : 'ai_power'
      }
    }
  }
  return null
}

// POST /api/ai/doubt - AI doubt solving for any question
// body.mode: 'direct' (default, straight answer) | 'socratic' (hint-by-hint —
// see solveDoubtWithAI). body.parentDoubtId: continue an existing Socratic
// thread (a "still stuck?" follow-up) instead of starting a new doubt.
router.post('/doubt', aiLimiter(), async (req, res) => {
  const { questionId, questionText, message, mode, parentDoubtId } = req.body || {}
  if (!message) return res.status(400).json({ error: 'message required' })

  // A follow-up in an existing thread: load the root + prior exchanges so the
  // AI sees the whole hint history, and skip the daily-cap/quota checks below
  // (the thread's root doubt already counted as this session's "1 doubt").
  let root = null
  let thread = []
  if (parentDoubtId) {
    const parentRow = await db.prepare('SELECT * FROM doubts WHERE id = ? AND user_id = ?').get(Number(parentDoubtId), req.user.id)
    if (!parentRow) return res.status(404).json({ error: 'Original doubt not found' })
    const rootId = parentRow.parent_doubt_id || parentRow.id
    thread = await db.prepare(`SELECT * FROM doubts WHERE user_id = ? AND (id = ? OR parent_doubt_id = ?) ORDER BY created_at ASC`)
      .all(req.user.id, rootId, rootId)
    root = thread[0]
  } else {
    const blocked = await checkRootDoubtQuota(req.user.id)
    if (blocked) return res.status(blocked.status).json(blocked.body)
  }

  let q = null
  const effQuestionId = root ? root.question_id : questionId
  if (effQuestionId) {
    q = await db.prepare('SELECT * FROM questions WHERE id = ?').get(effQuestionId)
    // AI-tutor context: institute-private questions leak nahi hone chahiye —
    // dusre institute ka question explain karne se pehle ownership check.
    if (q?.institute_id) {
      const instId = await visibilityInstId(req.user.id)
      if (Number(q.institute_id) !== instId) q = null
    }
  }
  const effMode = root ? root.mode : (mode === 'socratic' ? 'socratic' : 'direct')
  const effQuestionText = root ? root.question_text : (q?.question_text || questionText || '')
  const hintRound = thread.length // 0 for a fresh doubt, 1+ for each follow-up

  try {
    const response = await solveDoubtWithAI({
      questionText: effQuestionText,
      options: q ? JSON.parse(q.options_json || '[]') : [],
      explanation: q?.explanation || '',
      studentMessage: message,
      mode: effMode,
      thread,
      hintRound
    })
    const rec = await db.prepare(`INSERT INTO doubts (user_id, question_id, question_text, message, ai_response, model, parent_doubt_id, mode, hint_round)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(req.user.id, effQuestionId || null, effQuestionText || null, message, response, 'ai', root ? root.id : null, effMode, hintRound)
    // Recognition + quota only for the root of a doubt — follow-up hint
    // replies within the same thread don't each earn/cost separately.
    let ad = null
    if (!root) {
      await awardPoints(req.user.id, 'doubt_asked')
      // Contextual ad (free users only; paid users keep a clean tutor surface).
      // Fire-and-forget semantics: ad failure never affects the doubt response.
      try {
        const ent = await getEntitlements(req.user.id)
        if (!ent.aiPower) {
          ad = publicAdFields(await getContextualAd({
            messages: [
              { role: 'user', content: (effQuestionText || '') + ' — ' + message },
              { role: 'assistant', content: String(response).slice(0, 500) }
            ],
            sessionId: `doubt-${req.user.id}`,
            user: { id: req.user.id },
            device: { ua: req.headers['user-agent'] || '', ip: req.ip || '' }
          }))
        }
      } catch { /* ads are best-effort */ }
    }
    res.json({ response, ad, doubtId: rec.lastInsertRowid, rootDoubtId: root ? root.id : rec.lastInsertRowid, mode: effMode, hintRound })
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message })
  }
})

// POST /api/ai/doubt-photo - Photo Solver: student uploads a photo of a
// question (handwritten/textbook/their own attempt) instead of typing it.
// Always starts a NEW root doubt (photos aren't threaded — see
// visionSolvePhoto's comment: the model transcribes the question into text in
// this one call, so any follow-up goes through the normal /doubt
// parentDoubtId path with no image involved).
router.post('/doubt-photo', aiLimiter(), photoUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Photo file required' })
  const mode = req.body?.mode === 'socratic' ? 'socratic' : 'direct'
  const message = String(req.body?.message || '')

  const blocked = await checkRootDoubtQuota(req.user.id)
  if (blocked) return res.status(blocked.status).json(blocked.body)

  try {
    const { questionText, response } = await visionSolvePhoto({
      buffer: req.file.buffer, mimeType: req.file.mimetype, studentMessage: message, mode
    })
    const rec = await db.prepare(`INSERT INTO doubts (user_id, question_id, question_text, message, ai_response, model, mode, hint_round)
      VALUES (?,?,?,?,?,?,?,0)`).run(req.user.id, null, questionText, message || '📷 (photo)', response, 'ai', mode)
    await awardPoints(req.user.id, 'doubt_asked')
    let ad = null
    try {
      const ent = await getEntitlements(req.user.id)
      if (!ent.aiPower) {
        ad = publicAdFields(await getContextualAd({
          messages: [{ role: 'user', content: questionText }, { role: 'assistant', content: String(response).slice(0, 500) }],
          sessionId: `doubt-${req.user.id}`,
          user: { id: req.user.id },
          device: { ua: req.headers['user-agent'] || '', ip: req.ip || '' }
        }))
      }
    } catch { /* ads are best-effort */ }
    res.json({ response, questionText, ad, doubtId: rec.lastInsertRowid, mode })
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message })
  }
})

// POST /api/ai/explain - generate/refresh explanation for a question
router.post('/explain', aiLimiter(), async (req, res) => {
  const { questionId, language } = req.body || {}
  const q = await db.prepare('SELECT * FROM questions WHERE id = ?').get(questionId)
  if (!q) return res.status(404).json({ error: 'Question not found' })
  // Institute-private: sirf same-institute user hi AI explanation le sakta hai
  if (q.institute_id) {
    const instId = await visibilityInstId(req.user.id)
    if (Number(q.institute_id) !== instId) return res.status(404).json({ error: 'Question not found' })
  }
  try {
    const explanation = await explainQuestionWithAI({
      questionText: q.question_text, options: JSON.parse(q.options_json || '[]'), correctAnswer: q.correct_answer,
      language: language || null
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
// Roots newest-first (list order), each with its Socratic hint replies
// nested underneath in chronological order (conversation order).
router.get('/doubts', async (req, res) => {
  const roots = await db.prepare('SELECT * FROM doubts WHERE user_id = ? AND parent_doubt_id IS NULL ORDER BY created_at DESC LIMIT 50').all(req.user.id)
  if (roots.length) {
    const replies = await db.prepare(`SELECT * FROM doubts WHERE user_id = ? AND parent_doubt_id IS NOT NULL ORDER BY created_at ASC`).all(req.user.id)
    const byRoot = new Map()
    for (const r of replies) {
      if (!byRoot.has(r.parent_doubt_id)) byRoot.set(r.parent_doubt_id, [])
      byRoot.get(r.parent_doubt_id).push(r)
    }
    for (const root of roots) root.replies = byRoot.get(root.id) || []
  }
  res.json({ doubts: roots })
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
  // Institute isolation: student ko global + apne institute ke questions only.
  const myInstId = await visibilityInstId(req.user.id)
  const pick = async (scope = {}) => {
    const where = ['exam_id = ?', 'is_active = 1']
    const params = [scope.examId ?? cfg.examId]
    if (myInstId > 0) { where.push('(institute_id IS NULL OR institute_id = ?)'); params.push(myInstId) }
    else where.push('institute_id IS NULL')
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
      seed: `adaptive-${state.completed?.length || 0}-${Date.now()}`,
      language: cfg.language || null
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
router.get('/custom-presets', authRequired, platformOnly, (req, res) => {
  res.json({ presets: CUSTOM_PRESETS })
})

// POST /api/ai/config (admin) - save provider settings
router.post('/config', authRequired, platformOnly, aiLimiter(), async (req, res) => {
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
