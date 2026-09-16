// One-off Phase 4 smoke test: per-institute PDF pipeline aggregates used by
// the platform-admin Institutes page (list cards + detail stats).
// Run: node backend/scripts/phase4-smoke.mjs
import { newDb } from 'pg-mem'

const db = newDb()

db.public.none(`
  CREATE TABLE institutes (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
    ai_daily_quota INTEGER DEFAULT 0, ai_import_quota INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE exams (id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
  CREATE TABLE users (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'student', institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL,
    created_at TEXT
  );
  CREATE TABLE institute_invites (
    id SERIAL PRIMARY KEY, institute_id INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
    code TEXT UNIQUE NOT NULL, is_active INTEGER DEFAULT 1, created_at TEXT
  );
  CREATE TABLE pdf_imports (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, file_path TEXT, file_hash TEXT,
    status TEXT NOT NULL DEFAULT 'queued', questions_created INTEGER DEFAULT 0,
    error TEXT, created_by INTEGER,
    institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL,
    review_required INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE pdf_question_staging (
    id SERIAL PRIMARY KEY,
    import_id INTEGER NOT NULL REFERENCES pdf_imports(id) ON DELETE CASCADE,
    institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL,
    exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
    question_text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    duplicate INTEGER DEFAULT 0,
    question_id INTEGER,
    created_at TEXT
  );
`)

// Mirrors utils/institute.js monthStart()
const monthStart = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01 00:00:00`
}
const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19)
const lastMonth = '2020-01-01 00:00:00'

// Literal-inlining helper (pg-mem chokes on parameterized text comparisons)
async function run(sql, params = []) {
  let s = sql
  params.forEach((v, i) => {
    s = s.replace(`$${i + 1}`, typeof v === 'number' ? String(v) : v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  })
  const r = await db.public.query(s)
  return r.rows
}
const assert = (cond, label) => {
  if (!cond) { console.error('FAIL:', label); process.exitCode = 1 } else console.log('ok  :', label)
}

// Seed: A (quota 5) and B (quota OFF), plus users/invites
await run(`INSERT INTO institutes (name, code, ai_import_quota) VALUES ('Alpha School', 'ALPHA-1', 5)`)
await run(`INSERT INTO institutes (name, code, ai_import_quota) VALUES ('Beta Coaching', 'BETA-2', 0)`)
const A = (await run(`SELECT id FROM institutes WHERE code='ALPHA-1'`))[0].id
const B = (await run(`SELECT id FROM institutes WHERE code='BETA-2'`))[0].id
await run(`INSERT INTO users (name, email, role, institute_id) VALUES ('s1','s1@x.com','student',${A})`)
await run(`INSERT INTO institute_invites (institute_id, code) VALUES (${A}, 'SCH-AAAA')`)

// Imports: A has 2 this month + 1 last month; B has 1 this month
await run(`INSERT INTO pdf_imports (filename, status, institute_id, created_at) VALUES ('a1.pdf','completed',${A},'${nowStr()}')`)
await run(`INSERT INTO pdf_imports (filename, status, institute_id, created_at) VALUES ('a2.pdf','review',${A},'${nowStr()}')`)
await run(`INSERT INTO pdf_imports (filename, status, institute_id, created_at) VALUES ('a_old.pdf','completed',${A},'${lastMonth}')`)
await run(`INSERT INTO pdf_imports (filename, status, institute_id, created_at) VALUES ('b1.pdf','completed',${B},'${nowStr()}')`)
const a1 = (await run(`SELECT id FROM pdf_imports WHERE filename='a1.pdf'`))[0].id
const a2 = (await run(`SELECT id FROM pdf_imports WHERE filename='a2.pdf'`))[0].id

// Staging: A -> 3 pending + 4 approved-with-bank-id + 2 rejected; B -> 1 pending
for (let i = 0; i < 3; i++) await run(`INSERT INTO pdf_question_staging (import_id, institute_id, question_text, status) VALUES (${a2}, ${A}, 'pending q${i}', 'pending')`)
for (let i = 0; i < 4; i++) await run(`INSERT INTO pdf_question_staging (import_id, institute_id, question_text, status, question_id) VALUES (${a1}, ${A}, 'pub q${i}', 'approved', ${100 + i})`)
for (let i = 0; i < 2; i++) await run(`INSERT INTO pdf_question_staging (import_id, institute_id, question_text, status) VALUES (${a1}, ${A}, 'rej q${i}', 'rejected')`)
await run(`INSERT INTO pdf_question_staging (import_id, institute_id, question_text, status) VALUES (${a1}, ${B}, 'b pending', 'pending')`)

// ---- Mirrors listInstitutes() Phase-4 aggregates ----
const ms = monthStart()
const [usedRows, pendingRows, publishedRows] = await Promise.all([
  run(`SELECT institute_id, COUNT(*) c FROM pdf_imports WHERE created_at >= '${ms}' GROUP BY institute_id`),
  run(`SELECT institute_id, COUNT(*) c FROM pdf_question_staging WHERE status = 'pending' GROUP BY institute_id`),
  run(`SELECT institute_id, COUNT(*) c FROM pdf_question_staging WHERE status = 'approved' AND question_id IS NOT NULL GROUP BY institute_id`)
])
const byInst = (arr) => Object.fromEntries(arr.map((r) => [Number(r.institute_id), Number(r.c)]))
const usedMap = byInst(usedRows), pendingMap = byInst(pendingRows), pubMap = byInst(publishedRows)

assert(usedMap[A] === 2, `A monthly usage = 2 (last-month import excluded) — got ${usedMap[A]}`)
assert(usedMap[B] === 1, `B monthly usage = 1 — got ${usedMap[B]}`)
assert(pendingMap[A] === 3, `A pending review = 3 (rejected/approved excluded) — got ${pendingMap[A]}`)
assert(pubMap[A] === 4, `A published = 4 (approved WITH question_id only) — got ${pubMap[A]}`)
assert(pubMap[B] === undefined || pubMap[B] === 0, 'B published = 0 (its only staged row is pending)')

// ---- Mirrors instituteStats() Phase-4 detail stats ----
const pdfUsedA = (await run(`SELECT COUNT(*) c FROM pdf_imports WHERE institute_id = ${A} AND created_at >= '${ms}'`))[0]
const pdfPendingA = (await run(`SELECT COUNT(*) c FROM pdf_question_staging WHERE institute_id = ${A} AND status = 'pending'`))[0]
const pdfPublishedA = (await run(`SELECT COUNT(*) c FROM pdf_question_staging WHERE institute_id = ${A} AND status = 'approved' AND question_id IS NOT NULL`))[0]
const pdfRecentA = await run(`SELECT id, filename, status, questions_created, review_required, created_at FROM pdf_imports WHERE institute_id = ${A} ORDER BY id DESC LIMIT 5`)
assert(Number(pdfUsedA.c) === 2, `detail: A usage this month = 2 — got ${pdfUsedA.c}`)
assert(Number(pdfPendingA.c) === 3, `detail: A pending = 3 — got ${pdfPendingA.c}`)
assert(Number(pdfPublishedA.c) === 4, `detail: A published = 4 — got ${pdfPublishedA.c}`)
assert(pdfRecentA.length === 3 && pdfRecentA.every((r) => ['a1.pdf', 'a2.pdf', 'a_old.pdf'].includes(r.filename)), 'detail: recent imports list returns only this institute\'s rows (scoped, limited)')

// Scoping: B's aggregates never include A's rows
const pdfPendingB = (await run(`SELECT COUNT(*) c FROM pdf_question_staging WHERE institute_id = ${B} AND status = 'pending'`))[0]
assert(Number(pdfPendingB.c) === 1, 'isolation: B pending = 1 (A rows not leaked)')

console.log(process.exitCode ? '\nPHASE 4 SMOKE TEST FAILED' : '\nPHASE 4 SMOKE TEST PASSED')
