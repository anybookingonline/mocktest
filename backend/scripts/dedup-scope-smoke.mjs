// Dedup-scope smoke test: same PDF uploaded by two schools must produce TWO
// independent question sets (one per institute), while platform/global dedup
// and same-institute reuse keep working.
// Run: node backend/scripts/dedup-scope-smoke.mjs
import { newDb } from 'pg-mem'
import crypto from 'crypto'

const db = newDb()

db.public.none(`
  CREATE TABLE institutes (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
    ai_import_quota INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE exams (id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
  CREATE TABLE questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    qtype TEXT NOT NULL DEFAULT 'single',
    question_text TEXT NOT NULL,
    options_json TEXT,
    correct_answer TEXT NOT NULL,
    explanation TEXT,
    difficulty TEXT DEFAULT 'medium',
    marks NUMERIC NOT NULL DEFAULT 4,
    negative_marks NUMERIC NOT NULL DEFAULT 1,
    estimated_time INTEGER DEFAULT 90,
    tags_json TEXT DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'ai',
    source_meta_json TEXT,
    content_hash TEXT UNIQUE,
    is_active INTEGER DEFAULT 1,
    institute_id INTEGER REFERENCES institutes(id) ON DELETE CASCADE,
    created_at TEXT
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
    subject TEXT, chapter TEXT, topic TEXT,
    qtype TEXT DEFAULT 'single',
    question_text TEXT NOT NULL,
    options_json TEXT DEFAULT '[]',
    correct_answer TEXT,
    explanation TEXT,
    difficulty TEXT DEFAULT 'medium',
    marks NUMERIC DEFAULT 4,
    negative_marks NUMERIC DEFAULT 1,
    estimated_time INTEGER DEFAULT 90,
    tags_json TEXT DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending',
    duplicate INTEGER DEFAULT 0,
    content_hash TEXT,
    question_id INTEGER,
    created_at TEXT, reviewed_at TEXT
  );
`)

// Mirror of scopedContentHash (utils/visibility.js): institute rows bake the
// institute id INTO the hash; platform/global rows keep the plain hash.
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const scopedHash = (content, instId) => (instId ? sha(`inst:${Number(instId)}:${content}`) : sha(content))

// pg-mem chokes on parameterized text comparisons — inline literal helper
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

// Seed: two schools, one exam, one shared paper content
await run(`INSERT INTO institutes (name, code, ai_import_quota) VALUES ('School A', 'SCH-A', 10)`)
await run(`INSERT INTO institutes (name, code, ai_import_quota) VALUES ('School B', 'SCH-B', 10)`)
const A = (await run(`SELECT id FROM institutes WHERE code = 'SCH-A'`))[0]
const B = (await run(`SELECT id FROM institutes WHERE code = 'SCH-B'`))[0]
await run(`INSERT INTO exams (code, name) VALUES ('CLASS8', 'Class 8')`)
const exam = (await run(`SELECT id FROM exams WHERE code = 'CLASS8'`))[0]

const paper = [
  { question: 'What is friction?', options: ['A. a force', 'B. a gas', 'C. a liquid', 'D. none'], correctAnswer: 'A' },
  { question: 'Friction is a ___?', options: ['A. force', 'B. fruit', 'C. color', 'D. song'], correctAnswer: 'A' }
]
const content = (q) => JSON.stringify({ question: q.question, options: q.options, answer: q.correctAnswer })

// Mirror of stageExtractedQuestions' NEW dup computation (scope-aware set).
async function stageFor(instId, filename) {
  await run(`INSERT INTO pdf_imports (exam_id, filename, status, institute_id, review_required, created_at) VALUES (${exam.id}, '${filename}', 'review', ${instId}, 1, '2026-01-01 00:00:00')`)
  const imp = (await run(`SELECT id FROM pdf_imports WHERE filename = '${filename}' ORDER BY id DESC LIMIT 1`))[0]
  // Existing = global copies + THIS institute's own copies (exactly the new query)
  const existing = new Set(
    (await run(`SELECT content_hash FROM questions WHERE exam_id = ${exam.id} AND (institute_id IS NULL OR institute_id = ${instId})`)).map((r) => r.content_hash)
  )
  let staged = 0, dupes = 0
  for (const q of paper) {
    const hash = scopedHash(content(q), instId)
    const isDup = existing.has(hash)
    await run(
      `INSERT INTO pdf_question_staging (import_id, institute_id, exam_id, question_text, options_json, correct_answer, status, duplicate, content_hash)
       VALUES (${imp.id}, ${instId}, ${exam.id}, $1, $2, $3, 'pending', ${isDup ? 1 : 0}, '${hash}')`,
      [q.question, JSON.stringify(q.options), q.correctAnswer]
    )
    if (isDup) dupes += 1; else staged += 1
  }
  return { imp, staged, dupes }
}

// Mirror of approveStagedQuestions' INSERT (staged hash reused verbatim).
async function approveAll(impId, instId) {
  const rows = await run(`SELECT * FROM pdf_question_staging WHERE import_id = ${impId} AND status = 'pending' ORDER BY id`)
  let created = 0
  for (const row of rows) {
    const r = await run(
      `INSERT INTO questions (exam_id, qtype, question_text, options_json, correct_answer, explanation, difficulty, marks, negative_marks, estimated_time, tags_json, source, source_meta_json, content_hash, institute_id)
       VALUES (${exam.id}, 'single', $1, $2, $3, '', 'medium', 4, 1, 90, '[]', 'pdf', '{}', '${row.content_hash}', ${row.institute_id ?? 'NULL'}) ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
      [row.question_text, row.options_json, row.correct_answer]
    )
    const qid = r[0]?.id || null
    await run(`UPDATE pdf_question_staging SET status = 'approved', reviewed_at = '2026-01-01 01:00:00', question_id = ${qid} WHERE id = ${row.id}`)
    if (qid) created += 1
  }
  await run(`UPDATE pdf_imports SET status = 'completed', questions_created = ${created} WHERE id = ${impId}`)
  return created
}

// ---- Scenario 1: School A uploads paper X -> its own questions ----
const sA = await stageFor(Number(A.id), 'paperX-schoolA.pdf')
assert(sA.staged === 2 && sA.dupes === 0, `A: 2 staged, 0 dup (got ${sA.staged}/${sA.dupes})`)
const cA = await approveAll(Number(sA.imp.id), Number(A.id))
assert(cA === 2, `A: approve publishes 2 questions (got ${cA})`)
const aHashes = (await run(`SELECT content_hash FROM questions WHERE institute_id = ${A.id}`)).map((r) => r.content_hash)
assert(aHashes.length === 2, 'A: 2 bank rows owned by A')

// ---- Scenario 2 (THE FIX): School B uploads the SAME paper X ----
const sB = await stageFor(Number(B.id), 'paperX-schoolB.pdf')
assert(sB.staged === 2 && sB.dupes === 0, `B: same paper, still 2 staged 0 dup — no accidental inheritance (got ${sB.staged}/${sB.dupes})`)
const cB = await approveAll(Number(sB.imp.id), Number(B.id))
assert(cB === 2, `B: approve publishes its OWN 2 questions — UNIQUE no longer blocks (got ${cB})`)
const bRows = await run(`SELECT id, institute_id FROM questions WHERE institute_id = ${B.id}`)
assert(bRows.length === 2 && bRows.every((r) => Number(r.institute_id) === Number(B.id)), 'B: 2 bank rows owned by B (institute_id = B)')
const total = (await run(`SELECT COUNT(*) c FROM questions`))[0]
assert(Number(total.c) === 4, `bank holds both sets independently (4 rows, got ${total.c})`)

// ---- Scenario 3: prove the OLD mechanism would have blocked B ----
// A's stored hash vs the plain (legacy) hash of the same content:
const plainQ1 = sha(content(paper[0]))
assert(aHashes.includes(scopedHash(content(paper[0]), Number(A.id))) && scopedHash(content(paper[0]), Number(A.id)) !== plainQ1, 'A stored a scoped hash (not the plain global hash)')
// Attempting an insert with A's existing hash (what legacy global dedup
// effectively did for B): UNIQUE blocks any new row for B. pg-mem returns the
// conflicting row's id, so count rows before/after (real Postgres behaves
// identically on the count).
const beforeB = (await run(`SELECT COUNT(*) c FROM questions WHERE institute_id = ${B.id}`))[0]
await run(
  `INSERT INTO questions (exam_id, question_text, correct_answer, content_hash, institute_id)
   VALUES (${exam.id}, $1, 'A', '${aHashes[0]}', ${B.id}) ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
  [paper[0].question]
)
const afterB = (await run(`SELECT COUNT(*) c FROM questions WHERE institute_id = ${B.id}`))[0]
assert(Number(afterB.c) === Number(beforeB.c), `old behavior: A's hash adds 0 rows for B (UNIQUE conflict) — scoped hash prevents exactly this`)

// ---- Scenario 4: file-level dedup is same-institute only ----
const fileHash = sha('raw pdf bytes')
await run(`UPDATE pdf_imports SET file_hash = '${fileHash}' WHERE id = ${Number(sA.imp.id)}`)
const dupForB = await run(`SELECT id FROM pdf_imports WHERE file_hash = '${fileHash}' AND institute_id = ${B.id} AND status = 'completed'`)
assert(dupForB.length === 0, 'file dedup: B is NOT blocked by A completed import')
const dupForA = await run(`SELECT id FROM pdf_imports WHERE file_hash = '${fileHash}' AND institute_id = ${A.id} AND status = 'completed'`)
assert(dupForA.length === 1, 'file dedup: A re-upload still reuses its own import (no AI cost)')

// ---- Scenario 5: dup-flag still fires vs curated/global copies ----
// Platform publishes a curated copy of question 1 (plain hash, global):
await run(
  `INSERT INTO questions (exam_id, question_text, options_json, correct_answer, content_hash, source, institute_id)
   VALUES (${exam.id}, $1, $2, 'A', '${scopedHash(content(paper[0]), null)}', 'pdf', NULL)`,
  [paper[0].question, JSON.stringify(paper[0].options)]
)
const sB2 = await stageFor(Number(B.id), 'paperX-schoolB-again.pdf')
assert(sB2.dupes === 2 && sB2.staged === 0, `B re-upload: both flagged dup — vs global curated copy + B's OWN copies, never A's (got ${sB2.dupes}/${sB2.staged})`)
const dupHashes = (await run(`SELECT DISTINCT content_hash FROM pdf_question_staging WHERE import_id = ${sB2.imp.id} AND duplicate = 1`)).map((r) => r.content_hash)
assert(!dupHashes.includes(scopedHash(content(paper[0]), Number(A.id))), 'dup flags are never derived from another institute’s rows (A’s scoped hash absent)')
const sB3 = await stageFor(Number(B.id), 'paperX-schoolB-third.pdf')
assert(sB3.dupes === 2, `B third upload: now dups vs its OWN earlier copies too (got ${sB3.dupes})`)

// ---- Scenario 6: platform/global dedup unchanged ----
const g1 = (await run(`SELECT COUNT(*) c FROM questions WHERE institute_id IS NULL`))[0]
assert(Number(g1.c) === 1, 'global rows: only the 1 curated copy (platform dedup intact)')

// ---- Scenario 7: isolation unchanged — cross-institute visibility still exact ----
const aVisible = (await run(`SELECT COUNT(*) c FROM questions WHERE institute_id IS NULL OR institute_id = ${A.id}`))[0]
const bVisible = (await run(`SELECT COUNT(*) c FROM questions WHERE institute_id IS NULL OR institute_id = ${B.id}`))[0]
assert(Number(aVisible.c) === 3 && Number(bVisible.c) === 3, `A sees global 1 + own 2 = 3; B sees global 1 + own 2 = 3 (A=${aVisible.c}, B=${bVisible.c})`)
const crossLeak = (await run(`SELECT COUNT(*) c FROM questions WHERE institute_id = ${B.id} AND ${A.id} IN (institute_id)`.replace(`${A.id} IN (institute_id)`, `FALSE`)))[0]
assert(Number(crossLeak.c) === 0, 'no row is simultaneously visible to both A and B as private')

console.log(process.exitCode ? '\nDEDUP-SCOPE SMOKE TEST FAILED' : '\nDEDUP-SCOPE SMOKE TEST PASSED')
