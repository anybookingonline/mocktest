// Schema-order regression: db.js SCHEMA_SQL must initialize on BOTH
//   (A) a fresh database, and
//   (B) a database created by an older commit whose `questions` table exists
//       WITHOUT institute_id (the exact Render production failure:
//       "column \"institute_id\" does not exist" from the early CREATE INDEX).
// Verified with FUNCTIONAL probes (pg-mem has no pg_indexes/information_schema):
//   - column probe:  SELECT institute_id FROM questions
//   - FK probe:      insert with a bogus institute_id must violate the FK
// Run: node backend/scripts/schema-order-smoke.mjs
import { newDb } from 'pg-mem'
import { readFileSync } from 'fs'

// Pull the real SCHEMA_SQL + statements out of db.js (single source of truth).
const src = readFileSync(new URL('../src/db.js', import.meta.url), 'utf8')
const schemaSql = src.match(/const SCHEMA_SQL = `([\s\S]*?)`/)?.[1]
if (!schemaSql) { console.error('FAIL: could not extract SCHEMA_SQL from db.js'); process.exit(1) }
const fkSql = src.match(/await client\.query\(`(ALTER TABLE questions ADD CONSTRAINT[\s\S]*?)`\)/)?.[1]
if (!fkSql) { console.error('FAIL: could not extract the questions_institute_fk statement'); process.exit(1) }
// The exact legacy-repair block (must run AFTER institutes exists):
const alterBlockMatch = src.match(/(-- Institute content isolation: questions imported by a school\/coaching[\s\S]*?idx_questions_institute ON questions\(institute_id\);)/)
if (!alterBlockMatch) { console.error('FAIL: could not extract the institute_id ALTER block'); process.exit(1) }
const alterBlock = alterBlockMatch[1].split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')

const withFns = (db) => {
  for (const args of [['timestamptz', 'text'], ['timestamp', 'text']]) {
    try { db.public.registerFunction({ name: 'to_char', args, returns: 'text', implementation: () => '2026-01-01 00:00:00' }) } catch { /* already registered */ }
  }
  return db
}

let failures = 0
const assert = (cond, label) => {
  if (!cond) { console.error('FAIL:', label); failures += 1 } else console.log('ok  :', label)
}

// Functional probes -------------------------------------------------------
async function probeColumn(db, label) {
  try {
    await db.public.query('SELECT institute_id FROM questions LIMIT 1')
    assert(true, `${label}: questions.institute_id column exists`)
  } catch (e) {
    assert(false, `${label}: institute_id column probe failed → ${String(e.message).slice(0, 120)}`)
  }
}
async function probeFk(db, label) {
  try {
    const exam = (await db.public.query(`INSERT INTO exams (code, name) VALUES ('PRB-${label}', 'Probe Exam') RETURNING id`)).rows[0]
    const inst = (await db.public.query(`INSERT INTO institutes (name, code) VALUES ('T', 'T-${label}') RETURNING id`)).rows[0]
    await db.public.query(`INSERT INTO questions (exam_id, question_text, correct_answer, institute_id) VALUES (${exam.id}, 'q', 'a', ${inst.id})`)
    assert(true, `${label}: insert with a valid institute_id works`)
    let fkViolated = false
    try {
      await db.public.query(`INSERT INTO questions (exam_id, question_text, correct_answer, institute_id) VALUES (${exam.id}, 'q2', 'a', 999999)`)
    } catch (e) {
      fkViolated = /foreign key/i.test(String(e.message))
    }
    assert(fkViolated, `${label}: bogus institute_id violates the FK (constraint really enforced)`)
    await db.public.query(`INSERT INTO questions (exam_id, question_text, correct_answer) VALUES (${exam.id}, 'global q', 'a')`)
    assert(true, `${label}: NULL institute_id (global question) accepted`)
  } catch (e) {
    assert(false, `${label}: FK probe crashed → ${String(e.message).slice(0, 120)}`)
  }
}

// ---- Scenario A: fresh database — full SCHEMA_SQL must run clean ----
const fresh = withFns(newDb())
try {
  await fresh.public.none(schemaSql)
  try { await fresh.public.none(fkSql) } catch (e) { if (!/already exists/i.test(String(e.message))) throw e }
  await probeColumn(fresh, 'A/fresh')
  await probeFk(fresh, 'A/fresh')
} catch (e) {
  assert(false, `A/fresh: schema init failed → ${String(e.message).slice(0, 200)}`)
}

// ---- Scenario B: Render's legacy DB — questions exists WITHOUT institute_id ----
const legacy = withFns(newDb())
try {
  // Exactly what the old commit's DB looked like (core tables only, no isolation).
  await legacy.public.none(`CREATE TABLE exams (id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
    CREATE TABLE subjects (id SERIAL PRIMARY KEY, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, UNIQUE(exam_id, name));
    CREATE TABLE chapters (id SERIAL PRIMARY KEY, subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, UNIQUE(subject_id, name));
    CREATE TABLE topics (id SERIAL PRIMARY KEY, chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE, name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, UNIQUE(chapter_id, name));
    CREATE TABLE questions (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
      chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
      topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
      qtype TEXT NOT NULL DEFAULT 'single',
      question_text TEXT NOT NULL,
      options_json TEXT,
      correct_answer TEXT NOT NULL,
      explanation TEXT,
      solution_image_url TEXT,
      question_image_url TEXT,
      difficulty TEXT DEFAULT 'medium',
      marks NUMERIC NOT NULL DEFAULT 4,
      negative_marks NUMERIC NOT NULL DEFAULT 1,
      estimated_time INTEGER DEFAULT 90,
      year INTEGER,
      shift TEXT,
      tags_json TEXT DEFAULT '[]',
      source TEXT NOT NULL DEFAULT 'ai',
      source_meta_json TEXT,
      content_hash TEXT UNIQUE,
      is_active INTEGER DEFAULT 1,
      usage_count INTEGER DEFAULT 0,
      created_at TEXT, updated_at TEXT
    );
    CREATE TABLE institutes (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
      contact_email TEXT, logo_url TEXT, is_active INTEGER DEFAULT 1, created_at TEXT
    );
    INSERT INTO exams (code, name) VALUES ('JEE-MAIN', 'JEE Main');`)
  // On the legacy DB the old code died at the EARLY index statement. The fix
  // guarantees that statement only runs after the ALTER. Simulate the repaired
  // sequence with the exact statements extracted from db.js:
  await legacy.public.none(alterBlock)
  try { await legacy.public.none(fkSql) } catch (e) { if (!/already exists/i.test(String(e.message))) throw e }
  await probeColumn(legacy, 'B/legacy')
  await probeFk(legacy, 'B/legacy')
} catch (e) {
  assert(false, `B/legacy: repair sequence failed → ${String(e.message).slice(0, 200)}`)
}

// ---- Scenario C: FK idempotency across restarts ----
// pg-mem silently allows duplicate named constraints, so it cannot reproduce
// real Postgres's "constraint ... already exists" rejection here. Two checks
// instead: (1) the statement is a NAMED constraint (Postgres rejects a second
// ADD CONSTRAINT with the same name by design), (2) initSchema() tolerates
// that error (source-level), so restarts can never crash on it.
try {
  assert(/ADD CONSTRAINT questions_institute_fk/.test(fkSql), 'C/restart: FK uses a fixed name (Postgres rejects duplicates by design — restart-safe)')
  const initBody = src.match(/export async function initSchema\(\) \{([\s\S]*?)\n\}/)?.[1] || ''
  assert(/already exists/i.test(initBody), 'C/restart: initSchema catches "already exists" instead of crashing')
} catch (e) {
  assert(false, `C/restart: unexpected error → ${String(e.message).slice(0, 200)}`)
}

// ---- Scenario D: no forward FK — no table references institutes before its CREATE ----
const createOrder = [...src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1])
const institutesIdx = createOrder.indexOf('institutes')
const forwardRefs = []
for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
  const [, table, body] = m
  if (/REFERENCES institutes\(/.test(body) && createOrder.indexOf(table) < institutesIdx) forwardRefs.push(table)
}
assert(forwardRefs.length === 0, `D: no table declares an institutes FK before institutes exists (found: ${forwardRefs.join(', ') || 'none'})`)
// The index on questions(institute_id) must appear AFTER the ALTER block in the script:
const alterPos = src.indexOf('ALTER TABLE questions ADD COLUMN IF NOT EXISTS institute_id')
const indexPos = src.indexOf('CREATE INDEX IF NOT EXISTS idx_questions_institute')
assert(indexPos > alterPos, 'D: idx_questions_institute is declared after the ADD COLUMN (never runs against a missing column)')

console.log(failures ? '\nSCHEMA-ORDER SMOKE TEST FAILED' : '\nSCHEMA-ORDER SMOKE TEST PASSED')
process.exit(failures ? 1 : 0)
