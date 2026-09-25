import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { authRequired, platformOnly } from '../middleware/auth.js'
import { uploadLimiter } from '../middleware/rateLimit.js'
import { extractPdfQuestions, structureExtractedQuestions, persistQuestions, stageExtractedQuestions, PDF_EXTRACT_PROMPT } from '../utils/aiTasks.js'
import { hashContent, extractJson, getVisionModel, geminiFilesUpload, createGeminiBatch, getGeminiBatch, downloadGeminiResultsFile, geminiBatchState } from '../utils/aiService.js'
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

// POST /api/import/pdf-batch — upload many PDFs at once via Gemini's BATCH
// MODE (~50% cheaper than /pdf, but async: Google's target turnaround is "up
// to 24h", usually quicker). No per-request concurrency cap needed here like
// /pdf's queue — Gemini processes the whole batch job-side, this route just
// uploads files and submits one job. A background poller (below) checks
// pending batches every 15 min and finishes them through the same
// structure+persist pipeline once Gemini's done. No hard limit on how many
// PDFs — bounded only by multer's array limit and Gemini's own batch limits.
router.post('/pdf-batch', authRequired, platformOnly, uploadLimiter({ key: 'upload-batch', max: 10 }), upload.array('files', 50), async (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: 'At least one PDF file required' })
  const examId = Number(req.body?.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })

  const accepted = []
  const reused = []
  const lines = []
  for (const file of req.files) {
    const buffer = fs.readFileSync(file.path)
    const fileHash = hashContent(buffer)
    const dup = await db.prepare(`SELECT * FROM pdf_imports WHERE file_hash = ? AND institute_id IS NULL AND status = 'completed'`).get(fileHash)
    if (dup) {
      reused.push({ filename: file.originalname, importId: dup.id })
      fs.unlink(file.path, () => {})
      continue
    }

    let uploadedFile
    try {
      uploadedFile = await geminiFilesUpload(buffer, { displayName: file.originalname, mimeType: 'application/pdf' })
    } catch (e) {
      fs.unlink(file.path, () => {})
      // Bail the whole batch rather than submitting a partial one — simplest
      // safe behaviour; already-accepted files above are cleaned up too so a
      // retry doesn't leave orphaned 'batched' rows with no batch job.
      for (const a of accepted) await db.prepare(`DELETE FROM pdf_imports WHERE id = ?`).run(a.importId)
      return res.status(502).json({ error: `Gemini file upload failed for ${file.originalname}: ${e.message}` })
    }

    const batchKey = `pdf-${accepted.length}-${fileHash.slice(0, 8)}`
    const rec = await db.prepare(`INSERT INTO pdf_imports (exam_id, filename, file_path, file_hash, status, created_by, batch_key)
      VALUES (?,?,?,?,?,?,?)`).run(examId, file.originalname, null, fileHash, 'batched', req.user.id, batchKey)
    accepted.push({ importId: rec.lastInsertRowid, filename: file.originalname, fileHash, batchKey })
    lines.push(JSON.stringify({
      key: batchKey,
      request: {
        contents: [{ parts: [{ fileData: { mimeType: 'application/pdf', fileUri: uploadedFile.uri } }, { text: PDF_EXTRACT_PROMPT }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      }
    }))
    fs.unlink(file.path, () => {}) // local temp copy no longer needed — the PDF now lives in Gemini's Files store
  }

  if (!accepted.length) {
    return res.json({ message: 'All files were already imported before — nothing new to batch.', reused })
  }

  const model = await getVisionModel()
  const displayName = `pyq-batch-${exam.code}-${Date.now()}`
  let job
  try {
    job = await createGeminiBatch(model, lines.join('\n'), displayName)
  } catch (e) {
    for (const a of accepted) await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(`Batch submit failed: ${e.message}`.slice(0, 2000), a.importId)
    return res.status(502).json({ error: `Gemini batch submit failed: ${e.message}` })
  }

  const batchRec = await db.prepare(`INSERT INTO pdf_batches (batch_name, model, state, created_by) VALUES (?,?,?,?)`)
    .run(job.name, model, geminiBatchState(job), req.user.id)
  const batchId = batchRec.lastInsertRowid
  for (const a of accepted) await db.prepare(`UPDATE pdf_imports SET batch_id = ? WHERE id = ?`).run(batchId, a.importId)

  res.status(202).json({
    message: `${accepted.length} PDF(s) submitted as a Gemini batch job (up to 24h, checked automatically every 15 min).`,
    batchId, batchName: job.name, accepted: accepted.length, reused
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

// Steps 2+3 of the pipeline (DeepSeek structuring -> syllabus mapping ->
// persist/stage), shared by both the normal upload flow (which runs Step 1,
// Gemini Vision, itself) and /from-extraction (which receives a Step-1 result
// that already ran externally — see the Batch Mode note below).
async function structureAndPersist(importId, examId, extracted, opts = {}) {
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(examId)
  const sections = extracted?.sections || []
  const totalPages = extracted?.totalPages || sections.reduce((a, s) => a + (s.questions?.length || 0), 0)
  await db.prepare(`UPDATE pdf_imports SET total_pages = ?, processed_pages = ?, error = ? WHERE id = ?`)
    .run(totalPages, totalPages, extracted?.error ? String(extracted.error).slice(0, 500) : null, importId)

  const structured = await structureExtractedQuestions({ sections, examCode: extracted.examCode, year: extracted.year, shift: extracted.shift }, exam)
  if (!structured.length) throw new Error('No questions could be extracted from this PDF')

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
  try {
    // Step 1: Gemini Vision extracts questions (handles scanned/image/multi-column/low-quality PDFs)
    const extracted = await extractPdfQuestions({ buffer, mimeType: 'application/pdf' })
    await structureAndPersist(importId, examId, extracted, opts)
    fs.unlink(filePath, () => {}) // cleanup uploaded file
  } catch (e) {
    await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), importId)
  }
}

// Resume a PDF whose Step 1 (Gemini Vision) already ran externally, via
// scripts/batch-pdf-extract.mjs using Gemini's Batch Mode (~50% cheaper, up
// to 24h turnaround) — see /from-extraction below.
export async function processExtractedPdf(importId, examId, extracted, opts = {}) {
  return enqueuePdfJob(async () => {
    try {
      await structureAndPersist(importId, examId, extracted, opts)
    } catch (e) {
      await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), importId)
    }
  })
}

// POST /api/import/from-extraction — finish a PDF that scripts/batch-pdf-extract.mjs
// already ran Gemini Vision on externally via Batch Mode (cheaper, async).
// The script never uploads the PDF itself here — only the small extracted
// JSON — so this skips straight to Step 2 (DeepSeek structuring) + Step 3
// (persist), through the exact same code path, dedup and Import History
// entry as a normal upload.
router.post('/from-extraction', authRequired, platformOnly, async (req, res) => {
  const { examId: rawExamId, filename, fileHash, extracted } = req.body || {}
  const examId = Number(rawExamId)
  if (!examId || !filename || !fileHash || !extracted) {
    return res.status(400).json({ error: 'examId, filename, fileHash and extracted are required' })
  }
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })

  const dup = await db.prepare(`SELECT * FROM pdf_imports WHERE file_hash = ? AND institute_id IS NULL AND status = 'completed'`).get(fileHash)
  if (dup) {
    return res.json({ reused: true, importId: dup.id, questions_created: dup.questions_created, message: 'This paper was already imported before. Using the stored question bank — no re-processing needed.' })
  }

  const rec = await db.prepare(`INSERT INTO pdf_imports (exam_id, filename, file_path, file_hash, status, created_by)
    VALUES (?,?,?,?,?,?)`).run(examId, filename, null, fileHash, 'processing', req.user.id)
  const importId = rec.lastInsertRowid

  res.status(202).json({ importId, message: 'Extraction accepted. Structuring + persisting in background.' })
  processExtractedPdf(importId, examId, extracted).catch(async (e) => {
    await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), importId)
  })
})

// ---------------------------------------------------------------------------
// Batch poller — checks pending Gemini batch jobs every 15 min (turnaround is
// "up to 24h", no point polling more often) and finishes any that succeeded
// through the exact same structure+persist pipeline as every other import
// path. Runs once per process regardless of how many files import this
// module, since ES modules only execute their top-level code once.
// ---------------------------------------------------------------------------
const BATCH_POLL_INTERVAL_MS = 15 * 60 * 1000
const ACTIVE_BATCH_STATES = ['BATCH_STATE_PENDING', 'BATCH_STATE_RUNNING', 'BATCH_STATE_UNSPECIFIED']

async function finishBatch(batchRow, job) {
  const byKey = {}
  if (job.output?.inlinedResponses?.inlinedResponses) {
    for (const rec of job.output.inlinedResponses.inlinedResponses) {
      const k = rec.key || rec.metadata?.key
      if (k) byKey[k] = rec
    }
  } else if (job.output?.responsesFile) {
    const raw = await downloadGeminiResultsFile(job.output.responsesFile)
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try { const rec = JSON.parse(line); byKey[rec.key] = rec } catch { /* skip malformed line */ }
    }
  }

  const rows = await db.prepare(`SELECT * FROM pdf_imports WHERE batch_id = ? AND status = 'batched'`).all(batchRow.id)
  for (const row of rows) {
    const rec = byKey[row.batch_key]
    if (!rec) {
      await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run('Batch completed but this file’s result was missing from it', row.id)
      continue
    }
    const text = rec.response?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
    let extracted
    try {
      extracted = extractJson(text)
    } catch (e) {
      await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(`Extraction JSON parse failed: ${e.message}`.slice(0, 2000), row.id)
      continue
    }
    await db.prepare(`UPDATE pdf_imports SET status='processing' WHERE id=?`).run(row.id)
    processExtractedPdf(row.id, row.exam_id, extracted).catch(async (e) => {
      await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), row.id)
    })
  }
}

async function pollBatches() {
  const placeholders = ACTIVE_BATCH_STATES.map(() => '?').join(',')
  const pending = await db.prepare(`SELECT * FROM pdf_batches WHERE state IN (${placeholders})`).all(...ACTIVE_BATCH_STATES)
  for (const b of pending) {
    try {
      const job = await getGeminiBatch(b.batch_name)
      const state = geminiBatchState(job)
      await db.prepare(`UPDATE pdf_batches SET state=?, checked_at=to_char(now(),'YYYY-MM-DD HH24:MI:SS') WHERE id=?`).run(state, b.id)
      if (state === 'BATCH_STATE_SUCCEEDED') {
        await finishBatch(b, job)
      } else if (['BATCH_STATE_FAILED', 'BATCH_STATE_CANCELLED', 'BATCH_STATE_EXPIRED'].includes(state)) {
        await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE batch_id=? AND status='batched'`).run(`Gemini batch job ${state}`, b.id)
      }
    } catch (e) {
      console.error(`[pdf-batch-poll] batch ${b.batch_name} check failed:`, e.message)
    }
  }
}

setInterval(() => { pollBatches().catch((e) => console.error('[pdf-batch-poll]', e.message)) }, BATCH_POLL_INTERVAL_MS)

// GET /api/import/list - admin list of imports (+ live Gemini batch state for
// any 'batched' rows, so the UI can show progress without a separate call)
router.get('/list', authRequired, platformOnly, async (req, res) => {
  const rows = await db.prepare(`
    SELECT i.*, b.batch_name, b.state AS batch_state, b.checked_at AS batch_checked_at
    FROM pdf_imports i
    LEFT JOIN pdf_batches b ON b.id = i.batch_id
    ORDER BY i.created_at DESC LIMIT 100
  `).all()
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
