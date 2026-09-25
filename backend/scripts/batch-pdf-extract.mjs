#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PYQ bulk import via Gemini's BATCH MODE — ~50% cheaper than the normal
// admin-panel/bulk-pdf-import.mjs path, but async: Google's turnaround target
// is "up to 24h" (usually much faster). Use this for large, non-urgent
// imports (e.g. "add 5 years of PYQs for 8 exams") where cost matters more
// than getting results in the next few minutes.
//
// This talks to Google's Gemini API DIRECTLY from your machine (Files API +
// Batch API) — it needs your own Gemini API key, not an admin login. Only the
// small extracted JSON (not the PDFs) is later sent to your own backend to
// finish structuring + saving into the question bank.
//
// Three-step workflow (separate commands so you're never stuck watching a
// terminal for 24h):
//
//   1) submit — uploads PDFs to Gemini, creates one batch job, saves a local
//      manifest (.batch-jobs/<name>.json) you'll need for the next steps.
//        node scripts/batch-pdf-extract.mjs submit \
//          --dir ./pdfs/NEET --exam NEET --gemini-key AIza...
//
//   2) status — cheap, safe to run anytime (e.g. from cron) to check progress.
//        node scripts/batch-pdf-extract.mjs status --job .batch-jobs/<name>.json
//
//   3) finish — once status shows SUCCEEDED: downloads results, and for each
//      PDF calls your backend's /api/import/from-extraction to run DeepSeek
//      structuring + persist into the question bank (same pipeline, same
//      dedup, same Import History entry as a normal upload). Safe to re-run —
//      already-finished items are skipped.
//        node scripts/batch-pdf-extract.mjs finish --job .batch-jobs/<name>.json \
//          --base https://aisepadho.com --email ... --password ...
//
// Options:
//   --dir <folder>       (submit) local folder of PDFs to batch-extract
//   --exam <code>        (submit) exam code, just recorded in the manifest for you
//   --gemini-key <key>   Gemini API key (or GEMINI_API_KEY env) — same key as Admin > AI Config
//   --model <name>       Gemini vision model (default: gemini-3.6-flash)
//   --job <path>         (status/finish) path to the manifest saved by `submit`
//   --base <url>         (finish) app base URL, default BASE_URL env or http://localhost:3001
//   --email/--password   (finish) platform-admin login (or ADMIN_EMAIL/ADMIN_PASSWORD env)
//   --out <path>         (submit) manifest path override (default .batch-jobs/<timestamp>-<exam>.json)
// ---------------------------------------------------------------------------

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

const [, , cmd, ...rest] = process.argv
const opt = {}
for (let i = 0; i < rest.length; i++) {
  const a = rest[i]
  if (a.startsWith('--')) opt[a.slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[++i]
}

const GEMINI_KEY = opt['gemini-key'] || process.env.GEMINI_API_KEY
const MODEL = opt.model || 'gemini-3.6-flash'
const GEMINI_BASE = 'https://generativelanguage.googleapis.com'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...m) => console.log(...m)

if (!['submit', 'status', 'finish'].includes(cmd)) {
  console.error('Usage: node scripts/batch-pdf-extract.mjs <submit|status|finish> [options]')
  console.error('Run with no args to see the full usage banner at the top of this file.')
  process.exit(1)
}

// Same hashing as backend/src/utils/aiService.js#hashContent — MUST match
// exactly so /from-extraction's dedup lines up with normal-upload dedup.
function hashContent(buf) {
  return crypto.createHash('sha256').update(String(buf)).digest('hex').slice(0, 32)
}

const PDF_EXTRACT_PROMPT = `You are a precise question paper parser. Read the attached exam PDF carefully (it may be scanned, image-based, multi-column, or low quality).
Extract EVERY question along with its options, correct answer (if available), marks, and section. Preserve diagrams/graphs/tables/equations by describing them textually inside the question where needed.
Return ONLY JSON with this exact structure:
{
  "examCode": "exact exam code e.g. JEE-MAIN",
  "year": number or null,
  "shift": "e.g. Jan 27 Shift 1" or null,
  "sections": [
    {
      "subject": "Physics / Chemistry / Maths / etc.",
      "questions": [
        {
          "type": "single | multiple | numerical | integer",
          "question": "full question text (include any figure/graph/table description in [brackets] if relevant)",
          "options": ["A. ...","B. ...","C. ...","D. ..."] ([] if not available),
          "correctAnswer": "letter, option text, or numeric value; null if not stated",
          "marks": number,
          "negativeMarks": number or null,
          "difficulty": "easy | medium | hard (your best guess)",
          "estimatedTime": number in seconds (guess based on difficulty and marks),
          "tags": ["topic tags"]
        }
      ]
    }
  ]
}`

function extractJson(text) {
  if (!text) throw new Error('Empty response')
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end > start) t = t.slice(start, end + 1)
  return JSON.parse(t)
}

function requireKey() {
  if (!GEMINI_KEY) {
    console.error('Gemini API key chahiye: --gemini-key ya GEMINI_API_KEY env (Admin > AI Config me jo key daal rakhi hai, wahi).')
    process.exit(1)
  }
}

// ------------------------------- Files API ----------------------------------
// Resumable upload: https://ai.google.dev/gemini-api/docs/files
async function uploadFile(buffer, { displayName, mimeType }) {
  const start = await fetch(`${GEMINI_BASE}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': GEMINI_KEY,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { displayName } })
  })
  if (!start.ok) throw new Error(`Files API start failed: HTTP ${start.status} ${await start.text()}`)
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Files API did not return an upload URL')

  const done = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(buffer.length),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize'
    },
    body: buffer
  })
  if (!done.ok) throw new Error(`Files API upload failed: HTTP ${done.status} ${await done.text()}`)
  const data = await done.json()
  let file = data.file
  // PDFs are normally ACTIVE immediately, but poll briefly just in case.
  for (let i = 0; file?.state === 'PROCESSING' && i < 10; i++) {
    await sleep(2000)
    const r = await fetch(`${GEMINI_BASE}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': GEMINI_KEY } })
    file = (await r.json())
  }
  if (file?.state === 'FAILED') throw new Error(`Gemini file processing failed for ${displayName}`)
  return file // { name: "files/xxx", uri: "https://.../files/xxx", state, ... }
}

// ------------------------------- Batch API ----------------------------------
async function createBatch(requestsJsonl, displayName) {
  const jsonlBuf = Buffer.from(requestsJsonl, 'utf8')
  const jsonlFile = await uploadFile(jsonlBuf, { displayName: `${displayName}-requests.jsonl`, mimeType: 'application/jsonl' })

  // Field names here MUST be exact camelCase per Google's discovery doc
  // (GenerateContentBatch/InputConfig) — unlike the plain generateContent
  // endpoint, batchGenerateContent rejects snake_case with a 400 (confirmed
  // by hand against the live API while building this).
  const res = await fetch(`${GEMINI_BASE}/v1beta/models/${MODEL}:batchGenerateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': GEMINI_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      batch: { displayName, inputConfig: { fileName: jsonlFile.name } }
    })
  })
  if (!res.ok) throw new Error(`batchGenerateContent failed: HTTP ${res.status} ${await res.text()}`)
  return res.json() // { name: "batches/xxxx", ... }
}

async function getBatch(batchName) {
  const res = await fetch(`${GEMINI_BASE}/v1beta/${batchName}`, { headers: { 'x-goog-api-key': GEMINI_KEY } })
  if (!res.ok) throw new Error(`batch status failed: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

function batchState(job) {
  // Confirmed against Google's discovery doc (GenerateContentBatch.state):
  // BATCH_STATE_PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED | EXPIRED.
  return job?.state || 'BATCH_STATE_UNSPECIFIED'
}

async function downloadResultsFile(fileName) {
  const res = await fetch(`${GEMINI_BASE}/download/v1beta/${fileName}:download?alt=media`, {
    headers: { 'x-goog-api-key': GEMINI_KEY }
  })
  if (!res.ok) throw new Error(`results download failed: HTTP ${res.status} ${await res.text()}`)
  return res.text()
}

// ------------------------------- manifest -----------------------------------
function loadManifest(p) {
  if (!fs.existsSync(p)) { console.error(`Manifest nahi mila: ${p}`); process.exit(1) }
  return JSON.parse(fs.readFileSync(p, 'utf8'))
}
function saveManifest(p, m) {
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, JSON.stringify(m, null, 2))
}

// --------------------------------- submit ------------------------------------
async function cmdSubmit() {
  requireKey()
  if (!opt.dir) { console.error('--dir <folder ke PDFs> chahiye'); process.exit(1) }
  const files = fs.readdirSync(opt.dir).filter((f) => /\.pdf$/i.test(f))
  if (!files.length) { console.error('Us folder me koi .pdf nahi mila.'); process.exit(0) }
  log(`${files.length} PDF(s) mile. Gemini Files API par upload ho rahi hain...`)

  const items = []
  const lines = []
  for (const [i, f] of files.entries()) {
    const full = path.join(opt.dir, f)
    const buf = fs.readFileSync(full)
    const fileHash = hashContent(buf)
    log(`  ⬆ [${i + 1}/${files.length}] ${f} (${(buf.length / 1024 / 1024).toFixed(1)} MB)`)
    const uploaded = await uploadFile(buf, { displayName: f, mimeType: 'application/pdf' })
    const key = `pdf-${i}-${fileHash.slice(0, 8)}`
    items.push({ key, filename: f, fileHash, localPath: full, geminiFile: uploaded.name })
    lines.push(JSON.stringify({
      key,
      request: {
        contents: [{ parts: [{ fileData: { mimeType: 'application/pdf', fileUri: uploaded.uri } }, { text: PDF_EXTRACT_PROMPT }] }],
        generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
      }
    }))
  }

  const displayName = `pyq-batch-${opt.exam || 'exam'}-${Date.now()}`
  log(`\nBatch job submit ho raha hai (${items.length} requests)...`)
  const job = await createBatch(lines.join('\n'), displayName)
  log(`✓ Batch submitted: ${job.name}`)

  const manifestPath = opt.out || path.join('.batch-jobs', `${displayName}.json`)
  saveManifest(manifestPath, { batchName: job.name, model: MODEL, exam: opt.exam || null, createdAt: new Date().toISOString(), items, results: {} })
  log(`\nManifest saved: ${manifestPath}`)
  log(`Status check karne ke liye:  node scripts/batch-pdf-extract.mjs status --job "${manifestPath}"`)
  log(`(Google ka target turnaround 24h tak hai — usually zyada jaldi ho jaata hai. Job kabhi bhi ~48h se zyada pending rahe to expire ho jaata hai.)`)
}

// --------------------------------- status ------------------------------------
async function cmdStatus() {
  requireKey()
  if (!opt.job) { console.error('--job <manifest path> chahiye'); process.exit(1) }
  const m = loadManifest(opt.job)
  const job = await getBatch(m.batchName)
  const state = batchState(job)
  log(`Batch: ${m.batchName}`)
  log(`State: ${state}`)
  if (job.batchStats) log(`Progress: ${job.batchStats.successfulRequestCount || 0}/${job.batchStats.requestCount || '?'} done, ${job.batchStats.failedRequestCount || 0} failed, ${job.batchStats.pendingRequestCount || 0} pending`)
  if (state !== 'BATCH_STATE_SUCCEEDED' && state !== 'BATCH_STATE_FAILED') {
    log('Abhi ready nahi — thodi der baad dobara check karo (ya cron me daal do).')
  } else if (state === 'BATCH_STATE_SUCCEEDED') {
    log(`Ready hai! Ab chalao: node scripts/batch-pdf-extract.mjs finish --job "${opt.job}" --base <url> --email ... --password ...`)
  } else {
    log('Job FAILED. Raw response neeche hai:')
    console.log(JSON.stringify(job, null, 2))
  }
}

// --------------------------------- finish ------------------------------------
async function api(base, pathname, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(`${base}${pathname}`, { method, headers, body: body ? JSON.stringify(body) : undefined })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 300) } }
  return { ok: res.ok, status: res.status, data }
}

async function cmdFinish() {
  requireKey()
  if (!opt.job) { console.error('--job <manifest path> chahiye'); process.exit(1) }
  const m = loadManifest(opt.job)

  const job = await getBatch(m.batchName)
  const state = batchState(job)
  if (state !== 'BATCH_STATE_SUCCEEDED') {
    log(`Batch abhi ready nahi hai (state: ${state}). Pehle 'status' se confirm karo.`)
    return
  }

  // Small batches (this script's per-item text prompt is short) may come back
  // inlined instead of as a results file — handle both per GenerateContentBatchOutput.
  const byKey = {}
  if (job.output?.inlinedResponses?.inlinedResponses) {
    for (const rec of job.output.inlinedResponses.inlinedResponses) {
      if (rec.metadata?.key) byKey[rec.metadata.key] = rec
    }
    // Inline results carry the key under metadata (set from InlinedRequest.metadata
    // at submit time) — but this script submits via a JSONL file, whose per-line
    // "key" the API instead echoes at the top level of each result record.
    if (!Object.keys(byKey).length) {
      for (const rec of job.output.inlinedResponses.inlinedResponses) {
        if (rec.key) byKey[rec.key] = rec
      }
    }
  } else if (job.output?.responsesFile) {
    log(`Results download ho rahi hain: ${job.output.responsesFile}`)
    const raw = await downloadResultsFile(job.output.responsesFile)
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const rec = JSON.parse(line)
        byKey[rec.key] = rec
      } catch { /* skip malformed line */ }
    }
  } else {
    console.error("Results job.output me nahi mile (na inlinedResponses, na responsesFile) — raw job JSON neeche hai, isse mujhe bhejo taaki fix kar saku:")
    console.log(JSON.stringify(job, null, 2))
    process.exit(1)
  }

  const base = (opt.base || process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
  const email = opt.email || process.env.ADMIN_EMAIL
  const password = opt.password || process.env.ADMIN_PASSWORD
  if (!email || !password) { console.error('Admin credentials chahiye: --email/--password ya ADMIN_EMAIL/ADMIN_PASSWORD env'); process.exit(1) }
  const login = await api(base, '/api/auth/login', { method: 'POST', body: { email, password } })
  if (!login.ok || !login.data.token) { console.error(`Login failed (${login.status}):`, login.data.error || login.data.raw); process.exit(1) }
  const token = login.data.token

  const examsRes = await api(base, '/api/exams', { token })
  const examList = examsRes.data.exams || []
  const exam = examList.find((e) => e.code?.toLowerCase() === String(m.exam).toLowerCase())
  if (!exam) { console.error(`Exam '${m.exam}' backend par nahi mila. Available: ${examList.map((e) => e.code).join(', ')}`); process.exit(1) }

  m.results = m.results || {}
  for (const item of m.items) {
    if (m.results[item.key]?.status === 'done') { log(`  · ${item.filename} already finished, skip`); continue }
    const rec = byKey[item.key]
    if (!rec) { log(`  ✗ ${item.filename}: batch result me nahi mila`); m.results[item.key] = { status: 'missing' }; continue }
    const text = rec.response?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') || ''
    let extracted
    try { extracted = extractJson(text) } catch (e) {
      log(`  ✗ ${item.filename}: extraction JSON parse fail (${e.message})`)
      m.results[item.key] = { status: 'parse-failed' }
      continue
    }
    const r = await api(base, '/api/import/from-extraction', {
      method: 'POST', token,
      body: { examId: exam.id, filename: item.filename, fileHash: item.fileHash, extracted }
    })
    if (r.ok) {
      log(`  ✓ ${item.filename} → ${r.data.reused ? 'reused (already in bank)' : 'queued for structuring'}`)
      m.results[item.key] = { status: 'done', importId: r.data.importId }
    } else {
      log(`  ✗ ${item.filename} → ${r.data.error || r.status}`)
      m.results[item.key] = { status: 'failed', error: r.data.error || String(r.status) }
    }
    saveManifest(opt.job, m) // save after every item so a crash mid-run doesn't lose progress
  }

  log('\nDone. Admin → PDF Import → Import History me structuring/persist ka final status dekho.')
}

const run = { submit: cmdSubmit, status: cmdStatus, finish: cmdFinish }[cmd]
run().catch((e) => { console.error(e); process.exit(1) })
