import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'

const router = express.Router()
router.use(authRequired)

function parseJ(str, f = []) { try { return JSON.parse(str || '[]') } catch { return f } }

// POST /api/attempts - start a test attempt
// body: { testId, timeLimitSeconds?, questionIds? }
router.post('/', async (req, res) => {
  const { testId, timeLimitSeconds, questionIds } = req.body || {}
  const test = testId ? await db.prepare('SELECT * FROM tests WHERE id = ?').get(testId) : null
  let questions
  if (test) {
    questions = await db.prepare(`SELECT q.* FROM questions q JOIN test_questions tq ON tq.question_id = q.id
      WHERE tq.test_id = ? AND q.is_active = 1 ORDER BY tq.position`).all(test.id)
  } else if (questionIds?.length) {
    const marks = '?,'.repeat(questionIds.length).slice(0, -1)
    questions = await db.prepare(`SELECT * FROM questions WHERE id IN (${marks})`).all(...questionIds.map(Number))
  } else {
    return res.status(400).json({ error: 'Provide testId or questionIds' })
  }
  if (!questions.length) return res.status(400).json({ error: 'Test has no questions' })

  const config = test ? (() => { try { return JSON.parse(test.config_json || '{}') } catch { return {} } })() : (req.body?.config || {})
  const limit = Number(timeLimitSeconds) || Number(config.durationSeconds) || Number(config.duration) * 60 || 7200
  const r = await db.prepare(`INSERT INTO attempts (test_id, user_id, title, exam_id, kind, status, time_limit_seconds, duration_seconds, questions_json)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(test?.id || null, req.user.id, test?.title || req.body?.title || 'Practice Set',
      test?.exam_id || req.body?.examId || null, test?.kind || req.body?.kind || 'practice',
      'in_progress', limit, 0, JSON.stringify(questions.map(q => q.id)))
  res.status(201).json({ attemptId: r.lastInsertRowid, timeLimitSeconds: limit, questionCount: questions.length })
})

// GET /api/attempts/my - history
router.get('/my', async (req, res) => {
  const rows = await db.prepare(`SELECT * FROM attempts WHERE user_id = ? AND status != 'in_progress' ORDER BY started_at DESC LIMIT 100`).all(req.user.id)
  res.json({ attempts: rows })
})

// GET /api/attempts/my/in-progress
router.get('/my/in-progress', async (req, res) => {
  const rows = await db.prepare(`SELECT * FROM attempts WHERE user_id = ? AND status = 'in_progress' ORDER BY started_at DESC LIMIT 10`).all(req.user.id)
  res.json({ attempts: rows })
})

// GET /api/attempts/:id - full attempt state (questions + answers + telemetry)
router.get('/:id', async (req, res) => {
  const a = await db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!a) return res.status(404).json({ error: 'Attempt not found' })
  const qids = parseJ(a.questions_json)
  const rows = await db.prepare(`SELECT id, qtype, question_text, options_json, correct_answer, explanation,
    difficulty, marks, negative_marks, estimated_time, year, shift, tags_json, subject_id, chapter_id, topic_id
    FROM questions WHERE id IN (${'?,'.repeat(qids.length).slice(0, -1) || 'NULL'})`).all(...qids)
  const orderMap = Object.fromEntries(qids.map((id, i) => [id, i]))
  const questions = rows.sort((x, y) => (orderMap[x.id] ?? 0) - (orderMap[y.id] ?? 0)).map(q => ({
    ...q, options: JSON.parse(q.options_json || '[]'), tags: JSON.parse(q.tags_json || '[]')
  }))
  res.json({
    attempt: {
      id: a.id, test_id: a.test_id, title: a.title, kind: a.kind, status: a.status,
      started_at: a.started_at, completed_at: a.completed_at, time_limit_seconds: a.time_limit_seconds,
      duration_seconds: a.duration_seconds, score: a.score, correct: a.correct, wrong: a.wrong,
      skipped: a.skipped, accuracy: a.accuracy,
      answers: parseJ(a.answers_json), timeline: parseJ(a.timeline_json),
      ai_explained: parseJ(a.ai_explained_json)
    },
    questions
  })
})

// POST /api/attempts/:id/answer - verify immediately, update telemetry
// body: { questionId, selected (null = skip), timeSpent (sec), markedForReview? }
router.post('/:id/answer', async (req, res) => {
  const a = await db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!a) return res.status(404).json({ error: 'Attempt not found' })
  if (a.status !== 'in_progress') return res.status(400).json({ error: 'Attempt is not in progress' })
  const b = req.body || {}
  const q = await db.prepare('SELECT id, correct_answer, marks, negative_marks FROM questions WHERE id = ?').get(b.questionId)
  if (!q) return res.status(404).json({ error: 'Question not found' })

  const selected = b.selected ?? null
  let isCorrect = false
  if (selected != null) {
    const ans = String(q.correct_answer).trim().toLowerCase()
    const sel = String(selected).trim().toLowerCase()
    isCorrect = sel === ans
  }

  const answers = parseJ(a.answers_json)
  const existing = answers.findIndex(x => x.questionId === Number(b.questionId))
  const entry = {
    questionId: Number(b.questionId), selected, correct: isCorrect,
    timeSpent: Number(b.timeSpent) || 0, markedForReview: Boolean(b.markedForReview),
    submittedAt: new Date().toISOString()
  }
  if (existing >= 0) answers[existing] = entry
  else answers.push(entry)

  // telemetry: elapsed and pace snapshot
  const timeline = parseJ(a.timeline_json)
  const nowSec = a.duration_seconds + (Number(b.timeSpent) || 0)
  const remaining = Math.max(0, (a.time_limit_seconds || 0) - nowSec)
  const answeredCount = answers.filter(x => x.selected != null).length
  const remainingCount = Math.max(1, parseJ(a.questions_json).length - answeredCount)
  timeline.push({
    t: nowSec, questionId: Number(b.questionId), correct: isCorrect,
    remainingTime: remaining, avgPerRemaining: remaining / remainingCount,
    accuracy: answers.length ? Math.round((answers.filter(x => x.correct).length / answers.length) * 100) : 0
  })

  await db.prepare(`UPDATE attempts SET answers_json = ?, timeline_json = ?, duration_seconds = ? WHERE id = ?`)
    .run(JSON.stringify(answers), JSON.stringify(timeline), nowSec, a.id)

  // update topic stats for weak-topic analysis
  const qmeta = await db.prepare('SELECT topic_id FROM questions WHERE id = ?').get(b.questionId)
  if (qmeta?.topic_id) {
    await db.prepare(`INSERT INTO topic_stats (user_id, topic_id, attempts, correct, total_time_sec) VALUES (?,?,1,?,?)
      ON CONFLICT(user_id, topic_id) DO UPDATE SET
        attempts = topic_stats.attempts + 1, correct = topic_stats.correct + excluded.correct, total_time_sec = topic_stats.total_time_sec + excluded.total_time_sec`)
      .run(req.user.id, qmeta.topic_id, isCorrect ? 1 : 0, Number(b.timeSpent) || 0)
  }

  res.json({ correct: isCorrect, answer: entry, pace: timeline[timeline.length - 1] })
})

// POST /api/attempts/:id/mark-review
router.post('/:id/mark-review', async (req, res) => {
  const a = await db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!a) return res.status(404).json({ error: 'Attempt not found' })
  const answers = parseJ(a.answers_json)
  const b = req.body || {}
  const i = answers.findIndex(x => x.questionId === Number(b.questionId))
  if (i >= 0) answers[i].markedForReview = true
  else answers.push({ questionId: Number(b.questionId), selected: null, correct: false, timeSpent: 0, markedForReview: true })
  await db.prepare('UPDATE attempts SET answers_json = ? WHERE id = ?').run(JSON.stringify(answers), a.id)
  res.json({ ok: true })
})

// POST /api/attempts/:id/complete
router.post('/:id/complete', async (req, res) => {
  const a = await db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!a) return res.status(404).json({ error: 'Attempt not found' })
  const answers = parseJ(a.answers_json)
  const questions = parseJ(a.questions_json)
  const correct = answers.filter(x => x.correct).length
  const wrong = answers.filter(x => x.selected != null && !x.correct).length
  const skipped = Math.max(0, questions.length - correct - wrong)
  // compute score from marks
  const marksMap = {}
  if (a.test_id) {
    const rows = await db.prepare(`SELECT id, marks, negative_marks FROM questions WHERE id IN (${'?,'.repeat(questions.length).slice(0, -1) || 'NULL'})`).all(...questions)
    rows.forEach(r => { marksMap[r.id] = { m: r.marks, n: r.negative_marks } })
  }
  let score = 0
  for (const x of answers) {
    const mm = marksMap[x.questionId] || { m: 4, n: 1 }
    if (x.correct) score += mm.m
    else if (x.selected != null) score -= mm.n
  }
  const accuracy = correct + wrong ? Math.round((correct / (correct + wrong)) * 1000) / 10 : 0
  const now = new Date().toISOString()
  await db.prepare(`UPDATE attempts SET status='completed', completed_at=?, score=?, correct=?, wrong=?, skipped=?, accuracy=?, duration_seconds=COALESCE(?, duration_seconds) WHERE id=?`)
    .run(now, Math.round(score * 100) / 100, correct, wrong, skipped, accuracy, req.body?.elapsedSeconds ?? a.duration_seconds, a.id)
  const updated = await db.prepare('SELECT * FROM attempts WHERE id = ?').get(a.id)
  // simple ranking computation
  await computeRankings(a.exam_id, req.user.id)
  res.json({ attempt: updated })
})

// POST /api/attempts/:id/pause | /resume
router.post('/:id/:action(pause|resume)', async (req, res) => {
  const a = await db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!a) return res.status(404).json({ error: 'Attempt not found' })
  const action = req.params.action
  const seconds = Number(req.body?.elapsedSeconds) || a.duration_seconds
  await db.prepare(`UPDATE attempts SET status = ?, duration_seconds = ? WHERE id = ?`)
    .run(action === 'pause' ? 'paused' : 'in_progress', seconds, a.id)
  res.json({ ok: true, status: action === 'pause' ? 'paused' : 'in_progress' })
})

// POST /api/attempts/:id/ai-explained - record that AI explanation was shown for a question
router.post('/:id/ai-explained', async (req, res) => {
  const a = await db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!a) return res.status(404).json({ error: 'Attempt not found' })
  const list = parseJ(a.ai_explained_json)
  if (!list.includes(Number(req.body?.questionId))) list.push(Number(req.body.questionId))
  await db.prepare('UPDATE attempts SET ai_explained_json = ? WHERE id = ?').run(JSON.stringify(list), a.id)
  res.json({ ok: true })
})

// GET /api/attempts/:id/pace - live pace dashboard computation
router.get('/:id/pace', async (req, res) => {
  const a = await db.prepare('SELECT * FROM attempts WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id)
  if (!a) return res.status(404).json({ error: 'Attempt not found' })
  const timeline = parseJ(a.timeline_json)
  const totalQ = parseJ(a.questions_json).length
  const limit = a.time_limit_seconds || 7200
  const elapsed = a.duration_seconds
  const remaining = Math.max(0, limit - elapsed)
  const answered = parseJ(a.answers_json)
  const answeredCount = answered.filter(x => x.selected != null).length
  const remainingQ = Math.max(0, totalQ - answeredCount)
  const avgPerRemaining = remainingQ ? remaining / remainingQ : 0
  const speed = elapsed && answeredCount ? elapsed / answeredCount : 0 // sec per question so far
  const correct = answered.filter(x => x.correct).length
  const projected = elapsed && answeredCount ? (totalQ * elapsed) / Math.max(1, answeredCount) : null
  const completionPrediction = projected ? Math.min(100, Math.round((projected / limit) * 100)) : null
  res.json({
    elapsed, remaining, totalQ, answeredCount, remainingQ, avgPerRemaining, speed,
    accuracy: answeredCount ? Math.round((correct / answeredCount) * 100) : 0,
    projectedCompletionSeconds: projected, completionPrediction,
    timeline: timeline.slice(-200)
  })
})

async function computeRankings(examId, userId) {
  if (!examId) return
  try {
    const rows = await db.prepare(`SELECT user_id, AVG(score) score, AVG(accuracy) accuracy FROM attempts
      WHERE exam_id = ? AND status='completed' AND score > 0 GROUP BY user_id ORDER BY score DESC, accuracy DESC`).all(examId)
    rows.forEach(async (r, i) => {
      await db.prepare(`INSERT INTO rankings_cache (exam_id, user_id, score, accuracy, rank, updated_at)
        VALUES (?,?,?,?,?,now())
        ON CONFLICT(exam_id, user_id) DO UPDATE SET score=excluded.score, accuracy=excluded.accuracy, rank=excluded.rank, updated_at=now()`)
        .run(examId, r.user_id, r.score, r.accuracy, i + 1)
    })
  } catch { /* non-fatal */ }
}

export default router
