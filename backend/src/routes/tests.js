import express from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { generateQuestionsWithAI, persistQuestions } from '../utils/aiTasks.js'

const router = express.Router()
router.use(authRequired)

export function buildQuestionPicker(config) {
  // config: { examId, subjectIds[], chapterIds[], topicIds[], numQuestions, difficultyMix, excludeIds[], source, year }
  const base = []
  const bparams = []
  const badd = (cond, ...vals) => { base.push(cond); bparams.push(...vals) }
  if (config.examId) badd('exam_id = ?', Number(config.examId))
  if (config.subjectIds?.length) badd(`subject_id IN (${config.subjectIds.map(() => '?').join(',')})`, ...config.subjectIds.map(Number))
  if (config.chapterIds?.length) badd(`chapter_id IN (${config.chapterIds.map(() => '?').join(',')})`, ...config.chapterIds.map(Number))
  if (config.topicIds?.length) badd(`topic_id IN (${config.topicIds.map(() => '?').join(',')})`, ...config.topicIds.map(Number))
  const baseSql = base.length ? base.join(' AND ') : '1'
  if (config.difficultyMix) {
    const parts = []
    const params = []
    for (const [d, n] of Object.entries(config.difficultyMix)) {
      if (n > 0) {
        parts.push(`(difficulty = ? AND id IN (SELECT id FROM questions WHERE difficulty = ? AND ${baseSql} ORDER BY RANDOM() LIMIT ${Number(n)}))`)
        params.push(d, d, ...bparams)
      }
    }
    return { where: parts.length ? '(' + parts.join(' OR ') + ')' : '1', params }
  }
  return { where: baseSql, params: bparams }
}

function parseConfig(str) {
  try { return JSON.parse(str || '{}') } catch { return {} }
}

// GET /api/tests?examId=
router.get('/', async (req, res) => {
  const examId = req.query.examId
  const base = `SELECT t.*, (SELECT COUNT(*) FROM test_questions tq WHERE tq.test_id = t.id) as question_count
    FROM tests t`
  let rows
  if (examId) rows = await db.prepare(`${base} WHERE t.exam_id = ? ORDER BY t.created_at DESC`).all(Number(examId))
  else rows = await db.prepare(`${base} ORDER BY t.created_at DESC`).all()
  const exams = await db.prepare('SELECT id, code, name FROM exams').all()
  const examMap = Object.fromEntries(exams.map(e => [e.id, e.name]))
  res.json({ tests: rows.map(r => ({ ...r, exam_name: examMap[r.exam_id] })) })
})

// GET /api/tests/:id - full test with questions (answers included for simulation)
router.get('/:id', async (req, res) => {
  const test = await db.prepare('SELECT * FROM tests WHERE id = ?').get(req.params.id)
  if (!test) return res.status(404).json({ error: 'Test not found' })
  const rows = await db.prepare(`SELECT q.* FROM questions q JOIN test_questions tq ON tq.question_id = q.id
    WHERE tq.test_id = ? AND q.is_active = 1 ORDER BY tq.position`).all(test.id)
  const questions = rows.map(q => ({
    id: q.id, qtype: q.qtype, question_text: q.question_text, options: JSON.parse(q.options_json || '[]'),
    correct_answer: q.correct_answer, explanation: q.explanation, difficulty: q.difficulty,
    marks: q.marks, negative_marks: q.negative_marks, estimated_time: q.estimated_time,
    year: q.year, shift: q.shift, tags: JSON.parse(q.tags_json || '[]'),
    subject_id: q.subject_id, chapter_id: q.chapter_id, topic_id: q.topic_id
  }))
  res.json({ test: { ...test, config: parseConfig(test.config_json) }, questions })
})

// POST /api/tests - create from question bank
router.post('/', async (req, res) => {
  const b = req.body || {}
  if (!b.examId || !b.title) return res.status(400).json({ error: 'examId and title required' })
  const config = b.config || {}
  const num = Number(config.numQuestions) || 0
  let picked = []
  if (num > 0) {
    const { where, params } = buildQuestionPicker(config)
    picked = await db.prepare(`SELECT * FROM questions WHERE ${where} ORDER BY RANDOM() LIMIT ${num}`).all(...params)
  } else if (b.questionIds?.length) {
    const ids = b.questionIds.map(Number)
    const marks = '?,'.repeat(ids.length).slice(0, -1)
    picked = await db.prepare(`SELECT * FROM questions WHERE id IN (${marks})`).all(...ids)
  }
  if (!picked.length) return res.status(400).json({ error: 'No questions found for the given configuration' })
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(b.examId)
  const duration = Number(config.duration) || exam?.duration_minutes || 60
  const r = await db.prepare(`INSERT INTO tests (exam_id, title, description, kind, config_json, created_by, is_active)
    VALUES (?,?,?,?,?,?,1)`).run(b.examId, b.title, b.description || '', b.kind || 'custom',
    JSON.stringify({ ...config, duration, durationSeconds: duration * 60 }), req.user.id)
  const testId = r.lastInsertRowid
  const insert = await db.prepare('INSERT INTO test_questions (test_id, question_id, position) VALUES (?, ?, ?) ON CONFLICT(test_id, question_id) DO NOTHING')
  for (let i = 0; i < picked.length; i++) await insert.run(testId, picked[i].id, i)
  res.status(201).json({ testId, questionCount: picked.length })
})

// POST /api/tests/ai - generate full test with AI questions
router.post('/ai', async (req, res) => {
  const b = req.body || {}
  if (!b.examId) return res.status(400).json({ error: 'examId required' })
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(b.examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  const config = b.config || {}
  const num = Number(config.numQuestions) || Number(config.count) || exam.total_questions || 20
  const batch = Math.min(Math.max(Number(config.batchSize) || 5, 1), 8)
  try {
    const all = []
    const tasks = []
    for (let offset = 0; offset < num; offset += batch) {
      const want = Math.min(batch, num - offset)
      tasks.push(generateQuestionsWithAI({
        exam, count: want, subject: config.subject || null, chapter: config.chapter || null,
        topic: config.topic || null, difficulty: config.difficulty || null, seed: `${Date.now()}-${offset}`
      }))
    }
    const results = await Promise.all(tasks)
    for (const qs of results) all.push(...qs)
    await persistQuestions(all, { exam, source: 'ai', sourceMeta: { generatedBy: 'admin', kind: config.kind || 'mock' } })
    const ids = await db.prepare(`SELECT id FROM questions WHERE exam_id = ? AND source = 'ai' ORDER BY id DESC LIMIT ${num}`).all(exam.id)
    const title = b.title || `${exam.name} ${config.kind || 'Mock'} Test ${new Date().toLocaleDateString('en-IN')}`
    const r = await db.prepare(`INSERT INTO tests (exam_id, title, description, kind, config_json, created_by, is_active)
      VALUES (?,?,?,?,?,?,1)`).run(exam.id, title, b.description || 'AI generated full mock test', config.kind || 'full',
      JSON.stringify({ ...config, numQuestions: num, duration: Number(config.duration) || exam.duration_minutes }), req.user.id)
    const insert = await db.prepare('INSERT INTO test_questions (test_id, question_id, position) VALUES (?, ?, ?) ON CONFLICT(test_id, question_id) DO NOTHING')
    for (let i = 0; i < ids.length; i++) await insert.run(r.lastInsertRowid, ids[i].id, i)
    res.status(201).json({ testId: r.lastInsertRowid, questionCount: ids.length, aiCreated: all.length })
  } catch (e) {
    res.status(502).json({ error: 'AI generation failed: ' + e.message })
  }
})

// DELETE /api/tests/:id (admin)
router.delete('/:id', adminOnly, async (req, res) => {
  await db.prepare('DELETE FROM test_questions WHERE test_id = ?').run(req.params.id)
  const r = await db.prepare('DELETE FROM tests WHERE id = ?').run(req.params.id)
  res.json({ deleted: r.changes })
})

export default router
