import express from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { cacheGet, cacheSet, cacheDel } from '../utils/redis.js'

const router = express.Router()
router.use(authRequired)

// GET /api/exams - list all exams
router.get('/', async (req, res) => {
  const cached = await cacheGet('exams:list')
  if (cached) return res.json({ exams: cached, cached: true })
  const exams = await db.prepare('SELECT * FROM exams WHERE is_active = 1 ORDER BY name').all()
  await cacheSet('exams:list', exams, 60)
  res.json({ exams })
})

// GET /api/exams/:id - exam detail with full syllabus tree
router.get('/:id', async (req, res) => {
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  const subjects = await db.prepare('SELECT * FROM subjects WHERE exam_id = ? ORDER BY sort_order').all(exam.id)
  const chapters = await db.prepare('SELECT * FROM chapters WHERE exam_id = ? ORDER BY sort_order').all(exam.id)
  const topics = await db.prepare('SELECT * FROM topics WHERE exam_id = ? ORDER BY sort_order').all(exam.id)
  const counts = await db.prepare('SELECT subject_id, chapter_id, topic_id, COUNT(*) c FROM questions WHERE exam_id = ? GROUP BY subject_id, chapter_id, topic_id').all(exam.id)
  res.json({ exam, subjects, chapters, topics, counts })
})

// GET /api/exams/:id/syllabus - syllabus grouped
router.get('/:id/syllabus', async (req, res) => {
  const examId = Number(req.params.id)
  const subjects = await db.prepare('SELECT * FROM subjects WHERE exam_id = ? ORDER BY sort_order').all(examId)
  const chapters = await db.prepare('SELECT * FROM chapters WHERE exam_id = ? ORDER BY sort_order').all(examId)
  const topics = await db.prepare('SELECT * FROM topics WHERE exam_id = ? ORDER BY sort_order').all(examId)
  const counts = await db.prepare('SELECT subject_id, chapter_id, topic_id, COUNT(*) c FROM questions WHERE exam_id = ? GROUP BY subject_id, chapter_id, topic_id').all(examId)
  const bySubject = subjects.map(s => ({
    ...s,
    chapters: chapters.filter(c => c.subject_id === s.id).map(c => ({
      ...c,
      topics: topics.filter(t => t.chapter_id === c.id).map(t => ({
        ...t,
        questionCount: counts.filter(x => x.topic_id === t.id).reduce((a, b) => a + b.c, 0)
      })),
      questionCount: counts.filter(x => x.chapter_id === c.id).reduce((a, b) => a + b.c, 0)
    })),
    questionCount: counts.filter(x => x.subject_id === s.id).reduce((a, b) => a + b.c, 0)
  }))
  res.json({ syllabus: bySubject })
})

// ---- Admin: manage exams & syllabus ----

// POST /api/exams  (admin)
router.post('/', adminOnly, async (req, res) => {
  const b = req.body || {}
  const code = String(b.code || '').trim().toUpperCase()
  if (!code || !b.name) return res.status(400).json({ error: 'code and name required' })
  const dup = await db.prepare('SELECT id FROM exams WHERE code = ?').get(code)
  if (dup) return res.status(409).json({ error: 'Exam code already exists' })
  const r = await db.prepare(`INSERT INTO exams (code, name, description, icon, duration_minutes, total_questions, marks_per_question, negative_marks, subjects_json, is_active)
    VALUES (?,?,?,?,?,?,?,?,?,?)`)
    .run(code, b.name, b.description || '', b.icon || '🎯', Number(b.duration_minutes) || 180, Number(b.total_questions) || 100,
      Number(b.marks_per_question) ?? 4, Number(b.negative_marks) ?? 1, JSON.stringify(b.subjects || []), b.is_active === false ? 0 : 1)
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(r.lastInsertRowid)
  if (Array.isArray(b.subjects)) await seedSyllabus(exam.id, b.subjects)
  await cacheDel('exams:list')
  res.status(201).json({ exam })
})

// PUT /api/exams/:id (admin)
router.put('/:id', adminOnly, async (req, res) => {
  const b = req.body || {}
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(req.params.id)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })
  await db.prepare(`UPDATE exams SET name=?, description=?, icon=?, duration_minutes=?, total_questions=?, marks_per_question=?, negative_marks=?, subjects_json=?, is_active=?, updated_at=now() WHERE id=?`)
    .run(b.name ?? exam.name, b.description ?? exam.description, b.icon ?? exam.icon,
      Number(b.duration_minutes) ?? exam.duration_minutes, Number(b.total_questions) ?? exam.total_questions,
      Number(b.marks_per_question) ?? exam.marks_per_question, Number(b.negative_marks) ?? exam.negative_marks,
      b.subjects ? JSON.stringify(b.subjects) : exam.subjects_json, b.is_active === false ? 0 : (b.is_active === true ? 1 : exam.is_active), exam.id)
  if (Array.isArray(b.subjects)) await seedSyllabus(exam.id, b.subjects)
  await cacheDel('exams:list')
  const updated = await db.prepare('SELECT * FROM exams WHERE id = ?').get(exam.id)
  res.json({ exam: updated })
})

// DELETE /api/exams/:id (admin)
router.delete('/:id', adminOnly, async (req, res) => {
  const r = await db.prepare('DELETE FROM exams WHERE id = ?').run(req.params.id)
  await cacheDel('exams:list')
  res.json({ deleted: r.changes })
})

// POST /api/exams/:id/syllabus (admin) - upsert syllabus
router.post('/:id/syllabus', adminOnly, async (req, res) => {
  const examId = Number(req.params.id)
  if (!await db.prepare('SELECT id FROM exams WHERE id = ?').get(examId)) return res.status(404).json({ error: 'Exam not found' })
  const subjects = req.body?.subjects || []
  await seedSyllabus(examId, subjects)
  const full = await db.prepare('SELECT id, code, name FROM exams WHERE id = ?').get(examId)
  res.json({ ok: true, exam: full })
})

async function seedSyllabus(examId, subjects) {
  for (const [si, s] of subjects.entries()) {
    const sr = await db.prepare('INSERT INTO subjects (exam_id, name, sort_order) VALUES (?, ?, ?) ON CONFLICT(exam_id, name) DO NOTHING RETURNING id').run(examId, String(s.name), si)
    let subjectId = sr.lastInsertRowid
    if (sr.changes === 0) subjectId = (await db.prepare('SELECT id FROM subjects WHERE exam_id = ? AND name = ?').get(examId, String(s.name))).id
    for (const [ci, c] of (s.chapters || []).entries()) {
      const cr = await db.prepare('INSERT INTO chapters (subject_id, exam_id, name, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(subject_id, name) DO NOTHING RETURNING id').run(subjectId, examId, String(c.name), ci)
      let chapterId = cr.lastInsertRowid
      if (cr.changes === 0) chapterId = (await db.prepare('SELECT id FROM chapters WHERE subject_id = ? AND name = ?').get(subjectId, String(c.name))).id
      for (const [ti, t] of (c.topics || []).entries()) {
        await db.prepare('INSERT INTO topics (chapter_id, exam_id, name, sort_order) VALUES (?, ?, ?, ?) ON CONFLICT(chapter_id, name) DO NOTHING').run(chapterId, examId, String(t), ti)
      }
    }
  }
}

export default router
