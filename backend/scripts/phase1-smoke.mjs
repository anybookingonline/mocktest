// One-off Phase 1 smoke test: apply the real DDL subset to pg-mem and verify
// the quota-check + institute-scoped insert logic the new endpoint relies on.
// Run: node backend/scripts/phase1-smoke.mjs
import { newDb } from 'pg-mem'

const db = newDb()

// Same DDL fragments the live schema uses (db.js SCHEMA_SQL relevant parts)
db.public.none(`
  CREATE TABLE IF NOT EXISTS institutes (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT UNIQUE NOT NULL,
    contact_email TEXT,
    is_active INTEGER DEFAULT 1,
    ai_daily_quota INTEGER DEFAULT 0,
    ai_import_quota INTEGER DEFAULT 0,
    created_at TEXT
  );
  CREATE TABLE IF NOT EXISTS exams (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pdf_imports (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    file_path TEXT,
    file_hash TEXT,
    status TEXT NOT NULL DEFAULT 'queued',
    questions_created INTEGER DEFAULT 0,
    error TEXT,
    created_by INTEGER,
    institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL,
    created_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_pdf_imports_inst ON pdf_imports(institute_id);
`)

// pg-mem chokes on parameterized text comparisons in filters — inline the
// test-local literals (safe: values are fixed constants, not user input).
async function run(sql, params = []) {
  let s = sql
  params.forEach((v, i) => {
    s = s.replace(`$${i + 1}`, typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`)
  })
  const r = await db.public.query(s)
  return r.rows
}

const assert = (cond, label) => {
  if (!cond) { console.error('FAIL:', label); process.exitCode = 1 } else console.log('ok  :', label)
}

// 1. Seed institute with quota 3 + an exam
await run(`INSERT INTO institutes (name, code, ai_import_quota) VALUES ('Demo School', 'DEMO-01', 3)`)
const inst = (await run(`SELECT id, ai_import_quota FROM institutes WHERE code = 'DEMO-01'`))[0]
assert(inst?.ai_import_quota === 3, 'institutes.ai_import_quota column exists + settable')
await run(`INSERT INTO exams (code, name) VALUES ('SSC', 'SSC CGL')`)
const exam = (await run(`SELECT id FROM exams WHERE code = 'SSC'`))[0]

// 2. Quota-used query — exact shape the route uses (created_at >= monthStart)
const monthStart = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01 00:00:00`
const used = await run(`SELECT COUNT(*) c FROM pdf_imports WHERE institute_id = $1 AND created_at >= $2`, [inst.id, monthStart])
assert(Number(used[0].c) === 0, 'quota usage counts 0 at month start')

// 3. Institute-scoped insert — exact shape the route uses (created_at default
// elided for pg-mem; supplied explicitly here)
const nowStr = new Date().toISOString().replace('T', ' ').slice(0, 19)
const ins = await run(
  `INSERT INTO pdf_imports (exam_id, filename, file_path, file_hash, status, created_by, institute_id, created_at)
   VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
  [exam.id, 'class8-test.pdf', '/tmp/x.pdf', 'hash-abc', 'processing', 7, inst.id, nowStr]
)
assert(ins[0]?.id > 0, 'pdf_imports insert with institute_id + RETURNING id')

// 4. Quota enforcement path: fill to quota, then usage must equal quota
for (let i = 0; i < 2; i++) {
  await run(`INSERT INTO pdf_imports (exam_id, filename, status, institute_id, created_at) VALUES ($1,$2,'processing',$3,$4)`,
    [exam.id, `p${i}.pdf`, inst.id, new Date().toISOString().replace('T', ' ').slice(0, 19)])
}
const used2 = await run(`SELECT COUNT(*) c FROM pdf_imports WHERE institute_id = $1 AND created_at >= $2`, [inst.id, monthStart])
assert(Number(used2[0].c) === 3, 'quota usage counts all institute imports this month (3/3)')

// 5. Sub-admin listing query (route: list last 50 for this institute only)
const list = await run(`SELECT id, filename, status FROM pdf_imports WHERE institute_id = $1 ORDER BY id DESC LIMIT 50`, [inst.id])
assert(list.length === 3, 'institute-scoped listing returns only own imports')

// 6. Hash-dedup query shape
const dup = await run(`SELECT id FROM pdf_imports WHERE file_hash = $1 AND status = 'completed'`, ['hash-done'])
assert(dup.length === 0, 'dedup query runs (no completed match)')

// 7. Second institute is isolated (different institute_id → 0 usage)
await run(`INSERT INTO institutes (name, code, ai_import_quota) VALUES ('Other', 'OTHER-9', 5)`)
const other = (await run(`SELECT id FROM institutes WHERE code='OTHER-9'`))[0]
const used3 = await run(`SELECT COUNT(*) c FROM pdf_imports WHERE institute_id = $1 AND created_at >= $2`, [other.id, monthStart])
assert(Number(used3[0].c) === 0, 'quota accounting is institute-scoped (no cross-leak)')

console.log(process.exitCode ? '\nSMOKE TEST FAILED' : '\nPHASE 1 SMOKE TEST PASSED')
