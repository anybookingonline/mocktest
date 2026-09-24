import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { authRequired, platformOnly } from '../middleware/auth.js'
import { uploadLimiter } from '../middleware/rateLimit.js'
import { extractPdfQuestions, structureExtractedQuestions, persistQuestions, stageExtractedQuestions } from '../utils/aiTasks.js'
import { hashContent } from '../utils/aiService.js'
import { b2Configured, putFile } from '../utils/b2.js'

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
router.post('/pdf', authRequired, platformOnly, uploadLimiter(), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required' })
  const examId = Number(req.body?.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })

  const buffer = fs.readFileSync(req.file.path)
  const fileHash = hashContent(buffer)

  // Keep a durable archive copy in Backblaze B2 when configured (local disk is
  // ephemeral on most hosts). The local file is still used for processing and
  // removed after the import completes.
  let storageUrl = null
  if (await b2Configured()) {
    try {
      storageUrl = await putFile(req.file.path, { prefix: 'pdfs', filename: req.file.originalname, contentType: 'application/pdf' })
    } catch (e) {
      console.error('[b2] PDF archive failed:', e.message) // non-fatal — processing continues
    }
  }

  // Reuse: same paper never processed twice. This endpoint is platform-admin
  // only, so the file hash can only collide with the platform's own imports
  // (institute uploads are scoped in routes/institutes.js and are NOT hidden
  // by this check).
  const dup = await db.prepare(`SELECT * FROM pdf_imports WHERE file_hash = ? AND institute_id IS NULL AND status = 'completed'`).get(fileHash)
  if (dup) {
    fs.unlink(req.file.path, () => {})
    return res.json({ reused: true, importId: dup.id, questions_created: dup.questions_created, message: 'This paper was already imported before. Using the stored question bank — no re-processing needed.' })
  }

  const rec = await db.prepare(`INSERT INTO pdf_imports (exam_id, filename, file_path, file_hash, status, created_by)
    VALUES (?,?,?,?,?,?)`).run(examId, req.file.originalname, storageUrl || req.file.path, fileHash, 'processing', req.user.id)
  const importId = rec.lastInsertRowid

  res.status(202).json({ importId, message: 'PDF accepted. Processing in background with Gemini Vision + DeepSeek.' })

  // Background processing (fire & forget) — queued (see processPdf) so a bulk
  // upload of many PDFs can't pile up concurrent Gemini/DeepSeek calls and
  // exhaust the host's memory/CPU.
  processPdf(importId, examId, buffer, req.file.path).catch(async e => {
    await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), importId)
  })
})

// Each PDF import runs Gemini Vision (whole-PDF base64 payload) + DeepSeek in
// series and can take minutes; on a small host (e.g. a single Coolify
// container) letting a bulk import fire many of these concurrently has taken
// the whole app down (memory/CPU exhaustion -> every request, including
// login, starts 503ing). Cap how many run at once; the rest wait in line.
const MAX_CONCURRENT_PDF_JOBS = 2
let activePdfJobs = 0
const pdfJobQueue = []

function runNextPdfJob() {
  if (activePdfJobs >= MAX_CONCURRENT_PDF_JOBS) return
  const job = pdfJobQueue.shift()
  if (!job) return
  activePdfJobs++
  job().finally(() => {
    activePdfJobs--
    runNextPdfJob()
  })
}

function enqueuePdfJob(fn) {
  return new Promise((resolve, reject) => {
    pdfJobQueue.push(() => fn().then(resolve, reject))
    runNextPdfJob()
  })
}

// Exported so the institute (sub-admin) PDF route can reuse the exact same
// Gemini Vision + DeepSeek pipeline (dedup, syllabus mapping, persistence).
// opts.stageOnly: park the extraction in the review queue (pdf_question_staging)
// instead of publishing to the shared bank — institute self-serve imports.
//
// Retry note: transient provider errors (Gemini 503 "high demand" etc.) are
// retried inside the HTTP layer now (postJsonWithRetry, with a fallback vision
// model). If processing still fails, status='failed' + error text is stored
// and the admin can simply re-upload — the dedup hash makes re-uploading safe.
export async function processPdf(importId, examId, buffer, filePath, opts = {}) {
  return enqueuePdfJob(() => runPdfProcessing(importId, examId, buffer, filePath, opts))
}

async function runPdfProcessing(importId, examId, buffer, filePath, opts = {}) {
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
    if (opts.stageOnly) {
      // Review-queue flow: extraction parks in staging; status 'review' tells
      // the dashboard to stop polling and show the Review button instead.
      const { staged, dupes } = await stageExtractedQuestions(structured, { importId, instituteId: opts.instituteId, examId })
      await db.prepare(`UPDATE pdf_imports SET status='review', error=? WHERE id=?`)
        .run(`Review queue: ${staged} naye questions + ${dupes} duplicates (bank me already the). Approve karo publish ke liye.`, importId)
    } else {
      await mapSyllabus(examId, structured) // mutates each question with its own subjectId/chapterId/topicId
      const created = await persistQuestions(structured, { exam, source: 'pdf', sourceMeta: { importId, year: extracted.year, shift: extracted.shift } })

      await db.prepare(`UPDATE pdf_imports SET status='completed', questions_created=?, error=? WHERE id=?`)
        .run(created, created === 0 ? 'All questions were duplicates (already in bank)' : null, importId)
    }
    // cleanup uploaded file
    fs.unlink(filePath, () => {})
  } catch (e) {
    await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), importId)
  }
}

// GET /api/import/list - admin list of imports
router.get('/list', authRequired, platformOnly, async (req, res) => {
  const rows = await db.prepare('SELECT * FROM pdf_imports ORDER BY created_at DESC LIMIT 100').all()
  res.json({ imports: rows })
})

// GET /api/import/:id - status of an import
router.get('/:id', authRequired, platformOnly, async (req, res) => {
  const row = await db.prepare('SELECT * FROM pdf_imports WHERE id = ?').get(req.params.id)
  if (!row) return res.status(404).json({ error: 'Import not found' })
  res.json({ import: row })
})

// Loads the exam's syllabus tree and, for every question, resolves (creating
// if needed) its subject/chapter/topic id — writing them directly onto the
// question object as subjectId/chapterId/topicId. A real paper spans many
// subjects, so this has to be per-question, not one shared id for the batch.
async function mapSyllabus(examId, questions) {
  const subjects = await db.prepare('SELECT * FROM subjects WHERE exam_id = ?').all(examId)
  const chapters = await db.prepare('SELECT * FROM chapters WHERE exam_id = ?').all(examId)
  const topics = await db.prepare('SELECT * FROM topics WHERE exam_id = ?').all(examId)

  // `list` is both the lookup cache and the thing we grow on insert — without
  // that, two questions in the same paper needing the same new chapter would
  // both try to INSERT it and the second would hit the table's UNIQUE(name)
  // constraint.
  const getOrCreate = async (list, tableName, parentCol, parentId, name, extra) => {
    const found = list.find((x) => x.name.toLowerCase() === String(name).toLowerCase() && (parentId == null || x[parentCol] === parentId))
    if (found) return found.id
    const r = await db.prepare(`INSERT INTO ${tableName} (${extra.cols}) VALUES (${extra.marks})`)
      .run(...extra.values(parentId, name))
    const id = Number(r.lastInsertRowid)
    list.push({ id, name, ...(parentCol ? { [parentCol]: parentId } : {}) })
    return id
  }

  for (const q of questions) {
    if (!q.subject) continue
    q.subjectId = await getOrCreate(subjects, 'subjects', null, null, q.subject, {
      cols: 'exam_id, name, sort_order', marks: '?, ?, 0', values: () => [examId, q.subject]
    })
    if (q.chapter) {
      q.chapterId = await getOrCreate(chapters, 'chapters', 'subject_id', q.subjectId, q.chapter, {
        cols: 'subject_id, exam_id, name, sort_order', marks: '?, ?, ?, 0', values: () => [q.subjectId, examId, q.chapter]
      })
      if (q.topic) {
        q.topicId = await getOrCreate(topics, 'topics', 'chapter_id', q.chapterId, q.topic, {
          cols: 'chapter_id, exam_id, name, sort_order', marks: '?, ?, ?, 0', values: () => [q.chapterId, examId, q.topic]
        })
      }
    }
  }
}

export default router
