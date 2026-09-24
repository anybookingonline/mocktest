#!/usr/bin/env node
// ---------------------------------------------------------------------------
// PYQ PDF link downloader — crawls public "previous year papers" pages and
// saves every PDF it finds to your local machine. Run this FIRST; once you've
// eyeballed the downloaded folder, feed it to bulk-pdf-import.mjs to actually
// upload + extract into the question bank.
//
// Kya karta hai: ek ya zyada "index" page URLs leta hai (jahan year-wise ya
// exam-wise PDF links hote hain), un pages ko crawl karta hai (ek fix level
// tak sub-pages follow kar sakta hai — e.g. index page -> year page -> PDFs),
// aur har mila hua .pdf link local folder me download kar deta hai. Sirf
// public GET requests karta hai — koi login/paywall bypass nahi karta.
//
// IMPORTANT: sirf un pages ko point karo jinke PDFs public hain aur jinhe
// download karne ka aapko haq hai (jaise official NTA/SSC/UPSC/IBPS/GATE/CUET
// previous-year-papers pages). Kisi site ke ToS/robots.txt ka dhyan rakho.
//
// Usage:
//   # single-level: is page par jitne bhi .pdf links hain, sab download
//   node scripts/pdf-link-downloader.mjs \
//     --url "https://exam-site.gov.in/previous-papers" \
//     --out ./pdfs/JEE-MAIN
//
//   # 2-level: index page -> year ke sub-pages -> un sub-pages ke PDFs
//   node scripts/pdf-link-downloader.mjs \
//     --url "https://exam-site.gov.in/pyq-index" \
//     --depth 1 \
//     --include "2021|2022|2023|2024|2025" \
//     --out ./pdfs/NEET
//
//   --dry-run pehle chala kar dekho kya-kya milega, kuch download mat karo
//
// Options:
//   --url <url>        crawl start karne ka page (repeatable)
//   --out <dir>         local folder jahan PDFs save honge (default ./pdfs)
//   --depth <n>         kitne level tak non-PDF links follow karein (default 0 = sirf diya hua page scan karo)
//   --include <regex>   sirf un links ko follow/download karo jinke URL me ye pattern match ho (case-insensitive)
//   --exclude <regex>   in links ko skip karo (e.g. "answer-key|notification|syllabus")
//   --max-pages <n>     safety cap: kitne sub-pages tak crawl karna hai (default 50)
//   --delay <sec>       har HTTP request ke beech gap (default 1.5s — site par load na daale)
//   --force             pehle se downloaded (same filename) PDF bhi dobara download karo
//   --dry-run           sirf list dikhao, kuch save mat karo
// ---------------------------------------------------------------------------

import fs from 'fs'
import path from 'path'

const args = process.argv.slice(2)
const opt = { urls: [] }
for (let i = 0; i < args.length; i++) {
  const a = args[i]
  if (a === '--url') opt.urls.push(args[++i])
  else if (a === '--out') opt.out = args[++i]
  else if (a === '--depth') opt.depth = Number(args[++i])
  else if (a === '--include') opt.include = args[++i]
  else if (a === '--exclude') opt.exclude = args[++i]
  else if (a === '--max-pages') opt.maxPages = Number(args[++i])
  else if (a === '--delay') opt.delay = Number(args[++i])
  else if (a === '--force') opt.force = true
  else if (a === '--dry-run') opt.dryRun = true
}

const OUT_DIR = opt.out || './pdfs'
const DEPTH = Number.isFinite(opt.depth) ? opt.depth : 0
const MAX_PAGES = Number.isFinite(opt.maxPages) ? opt.maxPages : 50
const DELAY_MS = Math.max(0, (opt.delay ?? 1.5) * 1000)
const INCLUDE_RE = opt.include ? new RegExp(opt.include, 'i') : null
const EXCLUDE_RE = opt.exclude ? new RegExp(opt.exclude, 'i') : null
const UA = 'Mozilla/5.0 (Aisepadho PYQ link downloader; contact: admin)'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...m) => console.log(...m)

if (!opt.urls.length) {
  console.error('Kam se kam ek --url do (index/listing page jahan se crawl shuru ho).')
  process.exit(1)
}

// ------------------------------ HTML link scan -------------------------------
// No HTML-parser dependency — a regex scan of href="..." plus any quoted
// ".pdf" string (covers onclick/data-* attributes some govt sites use) is
// good enough for static listing pages. Won't see links injected by
// client-side JS (a React/Angular-rendered page) — those need a real browser.
function extractLinks(html, baseUrl) {
  const hrefs = new Set()
  const reA = /<a\b[^>]*href\s*=\s*["']([^"'#]+)["']/gi
  let m
  while ((m = reA.exec(html))) hrefs.add(m[1])
  const rePdf = /["']([^"'\s]+\.pdf)(?:["'?])/gi
  while ((m = rePdf.exec(html))) hrefs.add(m[1])

  const out = new Set()
  for (const href of hrefs) {
    try { out.add(new URL(href, baseUrl).href) } catch { /* malformed, skip */ }
  }
  return [...out]
}

function isPdfUrl(url) {
  return /\.pdf(?:$|[?#])/i.test(url)
}

function sameDomain(a, b) {
  try { return new URL(a).hostname === new URL(b).hostname } catch { return false }
}

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const ct = res.headers.get('content-type') || ''
  if (!ct.includes('text/html') && !ct.includes('text')) throw new Error(`not HTML (${ct})`)
  return res.text()
}

// --------------------------------- crawl -------------------------------------
async function crawl() {
  const visited = new Set()
  const pdfUrls = new Set()
  let queue = opt.urls.map((u) => ({ url: u, depth: 0 }))

  while (queue.length && visited.size < MAX_PAGES) {
    const { url, depth } = queue.shift()
    if (visited.has(url)) continue
    visited.add(url)

    log(`  🔎 [d${depth}] ${url}`)
    let html
    try {
      html = await fetchText(url)
    } catch (e) {
      log(`     ✗ skip: ${e.message}`)
      continue
    }
    await sleep(DELAY_MS)

    const links = extractLinks(html, url)
    const nextQueue = []
    for (const link of links) {
      if (isPdfUrl(link)) {
        if (INCLUDE_RE && !INCLUDE_RE.test(link)) continue
        if (EXCLUDE_RE && EXCLUDE_RE.test(link)) continue
        pdfUrls.add(link)
      } else if (depth < DEPTH) {
        if (!sameDomain(link, url)) continue
        if (visited.has(link)) continue
        if (EXCLUDE_RE && EXCLUDE_RE.test(link)) continue
        if (INCLUDE_RE && !INCLUDE_RE.test(link)) continue // sub-pages bhi include filter se hi hote hain (e.g. sirf 2021-2025 wale year-page)
        nextQueue.push({ url: link, depth: depth + 1 })
      }
    }
    queue.push(...nextQueue)
  }

  if (visited.size >= MAX_PAGES && queue.length) {
    log(`  ⚠ --max-pages (${MAX_PAGES}) limit hit — kuch pages crawl nahi hue. Zaroorat ho to --max-pages badhao.`)
  }
  return [...pdfUrls]
}

// ------------------------------- download -------------------------------------
function safeFilename(url) {
  try {
    const u = new URL(url)
    const base = decodeURIComponent(u.pathname.split('/').pop() || 'paper.pdf')
    return base.replace(/[^\w.\-]/g, '_') || 'paper.pdf'
  } catch { return `paper-${Date.now()}.pdf` }
}

async function downloadPdf(url, destDir) {
  const name = safeFilename(url)
  const dest = path.join(destDir, name)
  if (fs.existsSync(dest) && !opt.force) return { status: 'exists', name }

  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.length < 1000 || !buf.subarray(0, 5).toString().startsWith('%PDF')) {
    throw new Error('valid PDF nahi lagi (HTML/error page mila?)')
  }
  fs.writeFileSync(dest, buf)
  return { status: 'downloaded', name, bytes: buf.length }
}

// --------------------------------- main ---------------------------------------
async function main() {
  log(`PYQ link downloader — ${opt.urls.length} start URL(s), depth=${DEPTH}, max-pages=${MAX_PAGES}`)
  const pdfUrls = await crawl()
  log(`\n${pdfUrls.length} PDF link(s) mile.\n`)
  if (!pdfUrls.length) {
    log('Koi PDF link nahi mila. Agar page JS se render hota hai (SPA), ya PDFs ek level aur andar hain, --depth badhao.')
    return
  }

  if (opt.dryRun) {
    for (const u of pdfUrls) log(`  [dry] ${u}`)
    return
  }

  fs.mkdirSync(OUT_DIR, { recursive: true })
  let downloaded = 0, exists = 0, failed = 0
  for (const [i, url] of pdfUrls.entries()) {
    const label = `${i + 1}/${pdfUrls.length}`
    try {
      const r = await downloadPdf(url, OUT_DIR)
      if (r.status === 'exists') { exists++; log(`  · ${label} already have ${r.name}`) }
      else { downloaded++; log(`  ✓ ${label} ${r.name} (${(r.bytes / 1024).toFixed(0)} KB)`) }
    } catch (e) {
      failed++
      log(`  ✗ ${label} ${url} → ${e.message}`)
    }
    if (i < pdfUrls.length - 1) await sleep(DELAY_MS)
  }

  log('\n──── Summary ────')
  log(`  downloaded: ${downloaded}   already had: ${exists}   failed: ${failed}`)
  log(`  saved to: ${path.resolve(OUT_DIR)}`)
  log(`\nAb inhe upload karne ke liye:`)
  log(`  node scripts/bulk-pdf-import.mjs --dir "${OUT_DIR}" --exam <EXAM_CODE> --base https://aisepadho.com --email ... --password ...`)
}

main().catch((e) => { console.error(e); process.exit(1) })
