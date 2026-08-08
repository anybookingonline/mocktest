import express from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'

const router = express.Router()
router.use(authRequired)

async function qView(q, userId) {
  const bm = userId ? await db.prepare('SELECT 1 FROM bookmarks WHERE user_id=? AND question_id=?').get(userId, q.id) : null
  return {
    id: q.id, exam_id: q.exam_id, subject_id: q.subject_id, chapter_id: q.chapter_id, topic_id: q.topic_id,
    qtype: q.qtype, question_text: q.question_text, options: JSON.parse(q.options_json || '[]'),
    correct_answer: q.correct_answer, explanation: q.explanation, difficulty: q.difficulty,
    marks: q.marks, negative_marks: q.negative_marks, estimated_time: q.estimated_time,
    year: q.year, shift: q.shift, tags: JSON.parse(q.tags_json || '[]'), source: q.source,
    question_image_url: q.question_image_url, solution_image_url: q.solution_image_url, bookmarked: Boolean(bm)
  }
}

// GET /api/questions?examId=&subjectId=&chapterId=&topicId=&difficulty=&source=&limit=&offset=&q=&qtype=&year=
router.get('/', async (req, res) => {
  const { examId, subjectId, chapterId, topicId, difficulty, source, qtype, year, q, limit = 50, offset = 0, sort = 'new' } = req.query
  const where = []
  const params = []
  if (examId) { where.push(`exam_id = $${params.length + 1}`); params.push(Number(examId)) }
  if (subjectId) { where.push(`subject_id = $${params.length + 1}`); params.push(Number(subjectId)) }
  if (chapterId) { where.push(`chapter_id = $${params.length + 1}`); params.push(Number(chapterId)) }
  if (topicId) { where.push(`topic_id = $${params.length + 1}`); params.push(Number(topicId)) }
  if (difficulty) { where.push(`difficulty = $${params.length + 1}`); params.push(difficulty) }
  if (source) { where.push(`source = $${params.length + 1}`); params.push(source) }
  if (qtype) { where.push(`qtype = $${params.length + 1}`); params.push(qtype) }
  if (year) { where.push(`year = $${params.length + 1}`); params.push(Number(year)) }
  if (q) { where.push(`(question_text LIKE $${params.length + 1} OR explanation LIKE $${params.length + 1} OR tags_json LIKE $${params.length + 1})`); params.push(`%${q}%`, `%${q}%`, `%${q}%`) }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const order = sort === 'old' ? 'id ASC' : (sort === 'usage' ? 'usage_count DESC' : 'id DESC')
  const totalRow = await db.prepare(`SELECT COUNT(*) c FROM questions ${w}`).get(...params)
  const rows = await db.prepare(`SELECT * FROM questions ${w} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`).all(...params, Number(limit), Number(offset))
  const questions = []
  for (const r of rows) questions.push(await qView(r, req.user.id))
  res.json({ total: totalRow.c, questions })
})

// GET /api/questions/:id
router.get('/:id', async (req, res) => {
  const q = await db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id)
  if (!q) return res.status(404).json({ error: 'Question not found' })
  await db.prepare('UPDATE questions SET usage_count = usage_count + 1 WHERE id = ?').run(q.id)
  res.json({ question: await qView(q, req.user.id) })
})

// POST /api/questions (admin) - create/import manual question
router.post('/', adminOnly, async (req, res) => {
  const b = req.body || {}
  const { examId, subjectId, chapterId, topicId } = b
  if (!examId || !b.question) return res.status(400).json({ error: 'examId and question text required' })
  const r = await db.prepare(`INSERT INTO questions
    (exam_id, subject_id, chapter_id, topic_id, qtype, question_text, options_json, correct_answer, explanation,
     difficulty, marks, negative_marks, estimated_time, year, shift, tags_json, source, source_meta_json, content_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(Number(examId), subjectId ? Number(subjectId) : null, chapterId ? Number(chapterId) : null, topicId ? Number(topicId) : null,
      b.qtype || 'single', b.question, JSON.stringify(b.options || []), String(b.correct_answer ?? ''),
      b.explanation || '', b.difficulty || 'medium', Number(b.marks) ?? 4, Number(b.negative_marks) ?? 1,
      Number(b.estimated_time) || 90, b.year || null, b.shift || null, JSON.stringify(b.tags || []),
      b.source || 'manual', JSON.stringify(b.sourceMeta || {}), String(Math.random().toString(36).slice(2)))
  res.status(201).json({ id: r.lastInsertRowid })
})

// PUT /api/questions/:id (admin)
router.put('/:id', adminOnly, async (req, res) => {
  const q = await db.prepare('SELECT * FROM questions WHERE id = ?').get(req.params.id)
  if (!q) return res.status(404).json({ error: 'Question not found' })
  const b = req.body || {}
  await db.prepare(`UPDATE questions SET question_text=?, options_json=?, correct_answer=?, explanation=?, difficulty=?, marks=?, negative_marks=?, estimated_time=?, year=?, shift=?, tags_json=?, qtype=?, updated_at=now() WHERE id=?`)
    .run(b.question ?? q.question_text, JSON.stringify(b.options ?? JSON.parse(q.options_json || '[]')),
      b.correct_answer ?? q.correct_answer, b.explanation ?? q.explanation, b.difficulty ?? q.difficulty,
      b.marks ?? q.marks, b.negative_marks ?? q.negative_marks, b.estimated_time ?? q.estimated_time,
      b.year ?? q.year, b.shift ?? q.shift, JSON.stringify(b.tags ?? JSON.parse(q.tags_json || '[]')),
      b.qtype ?? q.qtype, q.id)
  const updated = await db.prepare('SELECT * FROM questions WHERE id = ?').get(q.id)
  res.json({ question: await qView(updated, req.user.id) })
})

// DELETE /api/questions/:id (admin)
router.delete('/:id', adminOnly, async (req, res) => {
  const r = await db.prepare('DELETE FROM questions WHERE id = ?').run(req.params.id)
  res.json({ deleted: r.changes })
})

// POST /api/questions/:id/toggle-bookmark
router.post('/:id/toggle-bookmark', async (req, res) => {
  const q = await db.prepare('SELECT id FROM questions WHERE id = ?').get(req.params.id)
  if (!q) return res.status(404).json({ error: 'Question not found' })
  const exists = await db.prepare('SELECT 1 FROM bookmarks WHERE user_id=? AND question_id=?').get(req.user.id, q.id)
  if (exists) await db.prepare('DELETE FROM bookmarks WHERE user_id=? AND question_id=?').run(req.user.id, q.id)
  else await db.prepare('INSERT INTO bookmarks (user_id, question_id) VALUES (?, ?)').run(req.user.id, q.id)
  res.json({ bookmarked: !exists })
})

// GET /api/bookmarks
router.get('/bookmarks/list', async (req, res) => {
  const rows = await db.prepare(`SELECT q.* FROM questions q JOIN bookmarks b ON b.question_id = q.id WHERE b.user_id = ? ORDER BY b.created_at DESC`).all(req.user.id)
  const questions = []
  for (const r of rows) questions.push(await qView(r, req.user.id))
  res.json({ questions })
})

export default router
