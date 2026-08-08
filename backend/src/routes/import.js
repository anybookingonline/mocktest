import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { extractPdfQuestions, structureExtractedQuestions, persistQuestions } from '../utils/aiTasks.js'
import { hashContent } from '../utils/aiService.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname.replace(/[^\w.\-]/g, '_')}`)
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) cb(null, true)
    else cb(new Error('Only PDF files are allowed'))
  }
})

const router = express.Router()
router.use(authRequired)

// POST /api/import/pdf - upload & process exam PDF via Gemini Vision + DeepSeek
router.post('/pdf', adminOnly, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required' })
  const examId = Number(req.body?.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })

  const buffer = fs.readFileSync(req.file.path)
  const fileHash = hashContent(buffer)

  // Reuse: same paper never processed twice
  const dup = await db.prepare(`SELECT * FROM pdf_imports WHERE file_hash = ? AND status = 'completed'`).get(fileHash)
  if (dup) {
    fs.unlink(req.file.path, () => {})
    return res.json({ reused: true, importId: dup.id, questions_created: dup.questions_created, message: 'This paper was already imported before. Using the stored question bank — no re-processing needed.' })
  }

  const rec = await db.prepare(`INSERT INTO pdf_imports (exam_id, filename, file_path, file_hash, status, created_by)
    VALUES (?,?,?,?,?,?)`).run(examId, req.file.originalname, req.file.path, fileHash, 'processing', req.user.id)
  const importId = rec.lastInsertRowid

  res.status(202).json({ importId, message: 'PDF accepted. Processing in background with Gemini Vision + DeepSeek.' })

  // Background processing (fire & forget)
  processPdf(importId, examId, buffer, req.file.path).catch(async e => {
    await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), importId)
  })
})

// GET /api/import/list - admin list of imports
router.get('/list', adminOnly, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM pdf_imports ORDER BY created_at DESC LIMIT 100').all()
  res.json({ imports: rows })
})

// GET /api/import/:id - status of an import
router.get('/:id', adminOnly, async (req, res) => {
  const row = await db.prepare('SELECT * FROM pdf_imports WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Import not found' })
  res.json({ import: row })
})

async function processPdf(importId, examId, buffer, filePath) {
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(examId)
  try {
    // Step 1: Gemini Vision extracts questions (handles scanned/image/multi-column/low-quality PDFs)
    const extracted = await extractPdfQuestions({ buffer, mimeType: 'application/pdf' })
    const sections = extracted?.sections || []
    const rawQuestions = sections.flatMap(s => (s.questions || []).map(q => ({ ...q, subject: q.subject || s.subject })))
    const totalPages = extracted?.totalPages || sections.reduce((a, s) => a + (s.questions?.length || 0), 0)
    await db.prepare(`UPDATE pdf_imports SET total_pages = ?, processed_pages = ?, error = ? WHERE id = ?`)
      .run(totalPages, totalPages, extracted.error ? String(extracted.error).slice(0, 500) : null, importId)

    // Step 2: DeepSeek structures the extraction into the canonical schema
    const structured = await structureExtractedQuestions({ sections, examCode: extracted.examCode, year: extracted.year, shift: extracted.shift }, exam)
    if (!structured.length) throw new Error('No questions could be extracted from this PDF')

    // Step 3: Map subjects -> create missing syllabus nodes, persist questions (deduped)
    const mapping = await mapSyllabus(examId, structured)
    const created = await persistQuestions(structured, { exam, source: 'pdf', sourceMeta: { importId, year: extracted.year, shift: extracted.shift } }, { mapping })

    await db.prepare(`UPDATE pdf_imports SET status='completed', questions_created=?, error=? WHERE id=?`)
      .run(created, created === 0 ? 'All questions were duplicates (already in bank)' : null, importId)
    // cleanup uploaded file
    fs.unlink(filePath, () => {})
  } catch (e) {
    await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), importId)
  }
}

async function mapSyllabus(examId, questions) {
  const subjects = await db.prepare('SELECT * FROM subjects WHERE exam_id = ?').all(examId)
  const chapters = await db.prepare('SELECT * FROM chapters WHERE exam_id = ?').all(examId)
  const topics = await db.prepare('SELECT * FROM topics WHERE exam_id = ?').all(examId)
  const mapping = {}
  const getOrCreate = async (table, parentCol, parentId, name, extra) => {
    const found = table.find(x => x.name.toLowerCase() === String(name).toLowerCase() && (parentId == null || x[parentCol] === parentId))
    if (found) return found.id
    const r = await db.prepare(`INSERT INTO ${table} (${extra.cols}) VALUES (${extra.marks})`)
      .run(...extra.values(parentId, name))
    return Number(r.lastInsertRowid)
  }
  for (const q of questions) {
    if (!q.subject) continue
    const subId = await getOrCreate('subjects', null, null, q.subject, {
      cols: 'exam_id, name, sort_order', marks: '?, ?, 0', values: () => [examId, q.subject]
    })
    mapping.subjectId = subId
    let chapId = null, topicId = null
    if (q.chapter) {
      chapId = await getOrCreate('chapters', 'subject_id', subId, q.chapter, {
        cols: 'subject_id, exam_id, name, sort_order', marks: '?, ?, ?, 0', values: (pid, name) => [subId, examId, name]
      })
      mapping.chapterId = chapId
      if (q.topic) {
        topicId = await getOrCreate('topics', 'chapter_id', chapId, q.topic, {
          cols: 'chapter_id, exam_id, name, sort_order', marks: '?, ?, ?, 0', values: (pid, name) => [chapId, examId, name]
        })
        mapping.topicId = topicId
      }
    }
  }
  return mapping
}

export default router
