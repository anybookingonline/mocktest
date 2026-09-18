#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Bulk PYQ PDF importer — "har site se manual fetch" ka shortcut.
//
// Kya karta hai: ek folder (ya ek direct download URL list) se PDFs uthata hai,
// admin login karke /api/import/pdf par upload karta hai — baaki pipeline
// (B2 archive -> dedup -> Gemini Vision -> DeepSeek -> review/approve -> bank)
// wahi server-side chalti hai jo dashboard se upload karne par chalti hai.
//
// Usage:
//   # 1) ek folder me saare PDFs daal do, phir:
//   node scripts/bulk-pdf-import.mjs --dir ./pdfs --exam JEE-MAIN
//
//   # 2) seedha URL list se (koi bhi public PDF link):
//   node scripts/bulk-pdf-import.mjs --url https://site.com/paper.pdf --url https://x.com/y.pdf --exam NEET
//
//   # dono saath bhi chalega; --dry-run pehle chala kar dekho kya-kya jayega
//
// Options:
//   --base <url>      app ka base URL (default: BASE_URL env ya http://localhost:3001)
//   --email <e>       platform-admin login email  (ya ADMIN_EMAIL env)
//   --password <p>    admin password               (ya ADMIN_PASSWORD env)
//   --exam <code>     exam code (e.g. JEE-MAIN) — code nahi pata to list dikhata hai
//   --delay <sec>     uploads ke beech gap (default 5s — provider spike na ho)
//   --dry-run         sirf dikhao kya upload hoga, kuch bhejo mat
//   --only-failed     sirf in files ka retry (pehle wale run me fail hui thi)
// ---------------------------------------------------------------------------

import fs from 'fs'
import path from 'path'

// ----------------------------- tiny arg parse -------------------------------
const args = process.argv.slice(2)
const opt = {}
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--dir' || a === '--url' || a === '--exam' || a === '--base' || a === '--email' || a === '--password' || a === '--delay') {
    if (a === '--url') (opt.urls ||= []).push(args[++i])
    else opt[a.slice(2)] = args[++i]
  } else if (a === '--dry-run') opt.dryRun = true
  else if (a === '--only-failed') opt.onlyFailed = true
}
const BASE = (opt.base || process.env.BASE_URL || 'http://localhost:3001').replace(/\/$/, '')
const EMAIL = opt.email || process.env.ADMIN_EMAIL
const PASSWORD = opt.password || process.env.ADMIN_PASSWORD
const DELAY_MS = Math.max(0, Number(opt.delay || 5) * 1000)
const EXAM = opt.exam

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...m) => console.log(...m)

async function api(pathname, { method = 'GET', token, body, form } = {}) {
  const headers = {}
  if (token) headers.Authorization = `Bearer ${token}`
  if (body && !form) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: form || (body ? JSON.stringify(body) : undefined)
  })
  const text = await res.text()
  let data
  try { data = JSON.parse(text) } catch { data = { raw: text.slice(0, 200) } }
  return { ok: res.ok, status: res.status, data }
}

// ------------------------------- login --------------------------------------
async function login() {
  if (!EMAIL || !PASSWORD) {
    console.error('Admin credentials chahiye: --email/--password ya ADMIN_EMAIL/ADMIN_PASSWORD env')
    process.exit(1)
  }
  const r = await api('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
  if (!r.ok || !r.data.token) {
    console.error(`Login failed (${r.status}):`, r.data.error || r.data.raw)
    process.exit(1)
  }
  return r.data.token
}

// --------------------------- exam code resolve ------------------------------
async function resolveExam(token) {
  const r = await api('/api/exams', { token })
  const exams = r.data.exams || []
  if (!EXAM) {
    log('\nExam code chahiye. Available exams:')
    for (const e of exams) log(`  ${e.code}  (${e.name})`)
    log('\nDobara chalao: --exam <code>')
    process.exit(0)
  }
  const exam = exams.find((e) => e.code?.toLowerCase() === EXAM.toLowerCase() || e.name?.toLowerCase() === EXAM.toLowerCase())
  if (!exam) {
    console.error(`Exam '${EXAM}' nahi mila. /api/exams me available codes dekho (exam ke bina chala kar list dekho).`)
    process.exit(1)
  }
  return exam
}

// ------------------------------ collect PDFs --------------------------------
function collectFiles() {
  const files = []
  if (opt.dir) {
    if (!fs.existsSync(opt.dir)) {
      console.error(`Folder nahi mila: ${opt.dir}`); process.exit(1)
    }
    for (const f of fs.readdirSync(opt.dir)) {
      if (/\.pdf$/i.test(f)) files.push({ path: path.join(opt.dir, f), name: f })
    }
  }
  return files
}

async function downloadUrl(url) {
  log(`  ⬇ downloading ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Aisepadho bulk importer)' } })
  if (!res.ok) throw new Error(`download HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1000 || !buf.subarray(0, 5).toString().startsWith('%PDF')) {
    throw new Error('ye valid PDF nahi lag rahi (HTML/error page aayi?)')
  }
  const name = decodeURIComponent(url.split('/').pop().split('?')[0] || 'paper.pdf')
  const tmp = path.join('/tmp', `bulk-${Date.now()}-${name.replace(/[^\w.\-]/g, '_')}`)
  fs.writeFileSync(tmp, buf)
  return { path: tmp, name }
}

// ------------------------------ upload ek PDF -------------------------------
async function uploadOne(token, examId, { path: p, name }) {
  const fd = new FormData()
  fd.append('examId', String(examId))
  fd.append('file', new Blob([fs.readFileSync(p)], { type: 'application/pdf' }), name)
  return api('/api/import/pdf', { method: 'POST', token, form: fd })
}

// --------------------------------- main -------------------------------------
const results = []
async function main() {
  log(`Bulk PYQ importer → ${BASE}`)
  const token = await login()
  const exam = await resolveExam(token)

  let items = collectFiles()
  for (const u of opt.urls || []) {
    try { items.push(await downloadUrl(u)) } catch (e) {
      log(`  ✗ URL skip: ${e.message} (${u})`)
      results.push({ name: u, status: 'download-failed', error: e.message })
    }
  }
  if (!items.length) {
    log('Koi PDF nahi mili. --dir folder ya --url list do.')
    process.exit(0)
  }
  log(`\n${items.length} PDF(s) → exam "${exam.name}"${opt.dryRun ? ' (DRY RUN)' : ''}\n`)

  for (const [i, item] of items.entries()) {
    const label = `${i + 1}/${items.length} ${item.name}`
    if (opt.dryRun) { log(`  [dry] ${label}`); continue }
    try {
      const r = await uploadOne(token, exam.id, item)
      if (r.ok && !r.data.error) {
        if (r.data.reused) results.push({ name: item.name, status: 'reused', note: 'pehle se bank me tha (₹0)' })
        else results.push({ name: item.name, status: 'processing', importId: r.data.importId })
        log(`  ✓ ${label} → ${r.data.reused ? 'REUSED (already imported)' : 'queued for extraction'}`)
      } else {
        results.push({ name: item.name, status: 'rejected', error: r.data.error || `HTTP ${r.status}` })
        log(`  ✗ ${label} → ${r.data.error || r.status}`)
      }
    } catch (e) {
      results.push({ name: item.name, status: 'error', error: e.message })
      log(`  ✗ ${label} → ${e.message}`)
    }
    if (i < items.length - 1) await sleep(DELAY_MS)
  }

  // temp downloads clean
  for (const it of items) { try { if (String(it.path).startsWith('/tmp/bulk-')) fs.unlink(it.path, () => {}) } catch {} }

  log('\n──── Summary ────')
  for (const r of results) log(`  ${r.status.padEnd(16)} ${r.name}${r.error ? ' — ' + r.error : ''}${r.note ? ' — ' + r.note : ''}`)
  const okCount = results.filter((r) => ['processing', 'reused'].includes(r.status)).length
  log(`\n${okCount}/${results.length} accepted. Admin → PDF Import me "Import History" se status dekho;`)
  log('extraction ke baad wahi Review → Approve karna hai (mandatory quality gate).')
}

main().catch((e) => { console.error(e); process.exit(1) })
