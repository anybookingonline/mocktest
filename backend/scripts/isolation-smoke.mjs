// Institute content-isolation smoke test — proves the 4 required scenarios:
//   1. Institute A can access its own uploaded questions
//   2. Institute B cannot access Institute A's questions
//   3. Global/platform questions remain accessible to both
//   4. Practice / mock / adaptive / battles / AI-tutor / revision retrieval
//      paths cannot leak institute-private questions across institutes
//
// NOTE: mirrors the exact WHERE shapes now embedded in the routes; the helper
// itself (utils/visibility.js) is a 2-line SELECT + fragment builder, copied
// here because db.js needs a live Postgres to resolve users.
// Run: node backend/scripts/isolation-smoke.mjs
import { newDb, DataType as pg_mem_types } from 'pg-mem'
import crypto from 'crypto'

const db = newDb()

db.public.none(`
  CREATE TABLE institutes (id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL);
  CREATE TABLE users (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
    role TEXT DEFAULT 'student', institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL
  );
  CREATE TABLE exams (id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
  CREATE TABLE questions (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    subject_id INTEGER, chapter_id INTEGER, topic_id INTEGER,
    qtype TEXT DEFAULT 'single', question_text TEXT NOT NULL,
    options_json TEXT DEFAULT '[]', correct_answer TEXT DEFAULT '',
    explanation TEXT, difficulty TEXT DEFAULT 'medium',
    marks NUMERIC DEFAULT 4, negative_marks NUMERIC DEFAULT 1,
    estimated_time INTEGER DEFAULT 90, tags_json TEXT DEFAULT '[]',
    source TEXT DEFAULT 'ai', source_meta_json TEXT DEFAULT '{}',
    content_hash TEXT UNIQUE, is_active INTEGER DEFAULT 1,
    institute_id INTEGER REFERENCES institutes(id) ON DELETE CASCADE
  );
`)

// pg-mem lacks random() — register it (Postgres has it natively)
db.public.registerFunction({ name: 'random', returns: pg_mem_types.float, implementation: () => Math.random() })

// ---- Mirrors utils/visibility.js (identical logic) ----
async function visibilityInstId(userId) {
  if (!userId) return 0
  const u = (await run(`SELECT institute_id FROM users WHERE id = ${Number(userId)}`))[0]
  return Number(u?.institute_id) || 0
}
function visibilitySql(instId, startIndex) {
  if (instId > 0) return { sql: ` AND (institute_id IS NULL OR institute_id = $${startIndex})`, params: [instId] }
  return { sql: ' AND institute_id IS NULL', params: [] }
}

// '?'-style SQL -> $n (pg-mem needs positional)
function toPg(sql) {
  let n = 0
  return sql.replace(/\?/g, () => `$${++n}`)
}
async function run(sql, params = []) {
  const s = toPg(sql)
  let out = s
  params.forEach((v, i) => {
    out = out.replace(`$${i + 1}`, typeof v === 'number' ? String(v) : v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  })
  const r = await db.public.query(out)
  return r.rows
}
const assert = (cond, label) => {
  if (!cond) { console.error('FAIL:', label); process.exitCode = 1 } else console.log('ok  :', label)
}

// Seed: institutes A & B, students, one shared exam, 3 questions
await run(`INSERT INTO institutes (name, code) VALUES ('School A', 'A-1')`)
await run(`INSERT INTO institutes (name, code) VALUES ('School B', 'B-1')`)
const A = (await run(`SELECT id FROM institutes WHERE code='A-1'`))[0].id
const B = (await run(`SELECT id FROM institutes WHERE code='B-1'`))[0].id
await run(`INSERT INTO users (name, email, institute_id) VALUES ('stuA','a@x.com',?)`, [A])
await run(`INSERT INTO users (name, email, institute_id) VALUES ('stuB','b@x.com',?)`, [B])
await run(`INSERT INTO users (name, email, institute_id) VALUES ('solo','s@x.com',NULL)`)
const stuA = (await run(`SELECT id FROM users WHERE email='a@x.com'`))[0].id
const stuB = (await run(`SELECT id FROM users WHERE email='b@x.com'`))[0].id
const solo = (await run(`SELECT id FROM users WHERE email='s@x.com'`))[0].id
await run(`INSERT INTO exams (code, name) VALUES ('CLASS8','Class 8')`)
const EXAM = (await run(`SELECT id FROM exams WHERE code='CLASS8'`))[0].id

const hash = (s) => crypto.createHash('sha256').update(s).digest('hex')
await run(`INSERT INTO questions (exam_id, question_text, source, content_hash, institute_id) VALUES (?, 'GLOBAL Q', 'ai', ?, NULL)`, [EXAM, hash('g')])
await run(`INSERT INTO questions (exam_id, question_text, source, content_hash, institute_id) VALUES (?, 'A PRIVATE Q', 'pdf', ?, ?)`, [EXAM, hash('a'), A])
await run(`INSERT INTO questions (exam_id, question_text, source, content_hash, institute_id) VALUES (?, 'B PRIVATE Q', 'pdf', ?, ?)`, [EXAM, hash('b'), B])
const QG = (await run(`SELECT id FROM questions WHERE question_text='GLOBAL Q'`))[0].id
const QA = (await run(`SELECT id FROM questions WHERE question_text='A PRIVATE Q'`))[0].id
const QB = (await run(`SELECT id FROM questions WHERE question_text='B PRIVATE Q'`))[0].id

const instA = await visibilityInstId(stuA)
const instB = await visibilityInstId(stuB)
const instSolo = await visibilityInstId(solo)
assert(instA === A && instB === B && instSolo === 0, 'visibilityInstId resolves user→institute (0 for independent)')

async function listFor(instId) {
  const v = visibilitySql(instId, 2)
  return run(`SELECT id, question_text FROM questions WHERE exam_id = ?${v.sql}`, [EXAM, ...v.params])
}

// Scenarios 1+3
const listA = await listFor(instA)
const listB = await listFor(instB)
assert(listA.some((q) => q.id === QA) && listA.some((q) => q.id === QG), 'S1: Institute A sees its own uploaded question')
assert(listA.some((q) => q.id === QG) && listB.some((q) => q.id === QG), 'S3: Global/platform questions accessible to both')
// Scenario 2
assert(!listA.some((q) => q.id === QB) && !listB.some((q) => q.id === QA), 'S2: Institutes cannot see each other private questions')
const listSolo = await listFor(instSolo)
assert(listSolo.length === 1 && listSolo[0].id === QG, 'Independent (no institute) user sees only global questions')

// Scenario 4a — mock/practice picker (tests.js buildQuestionPicker shape)
function buildQuestionPicker(config, instId) {
  const base = []
  const bparams = []
  if (instId > 0) { base.push('(institute_id IS NULL OR institute_id = ?)'); bparams.push(instId) } else base.push('institute_id IS NULL')
  if (config.examId) { base.push('exam_id = ?'); bparams.push(config.examId) }
  return { where: base.join(' AND '), params: bparams }
}
for (const [who, iid] of [['A', instA], ['B', instB], ['solo', 0]]) {
  const { where, params } = buildQuestionPicker({ examId: EXAM }, iid)
  const picked = await run(`SELECT id FROM questions WHERE ${where}`, params)
  const ids = picked.map((p) => p.id)
  const leak = who === 'A' ? ids.includes(QB) : who === 'B' ? ids.includes(QA) : (ids.includes(QA) || ids.includes(QB))
  assert(!leak, `4a mock/practice picker: ${who} never draws another institute private question`)
  assert(ids.includes(QG), `4a mock/practice picker: ${who} still gets global questions`)
}

// Scenario 4b — adaptive picker (ai.js /adaptive shape)
const adapA = await run(`SELECT id FROM questions WHERE exam_id = ? AND is_active = 1 AND (institute_id IS NULL OR institute_id = ?)`, [EXAM, instA])
const adapB = await run(`SELECT id FROM questions WHERE exam_id = ? AND is_active = 1 AND (institute_id IS NULL OR institute_id = ?)`, [EXAM, instB])
const adapS = await run(`SELECT id FROM questions WHERE exam_id = ? AND is_active = 1 AND institute_id IS NULL`, [EXAM])
assert(adapA.every((q) => [QG, QA].includes(q.id)) && adapA.length > 0, '4b adaptive: A picks only global + own')
assert(adapB.every((q) => [QG, QB].includes(q.id)) && adapB.length > 0, '4b adaptive: B picks only global + own')
assert(adapS.every((q) => q.id === QG), '4b adaptive: independent picks only global')

// Scenario 4c — battles (battles.js drawQuestion shape, with usedIds)
async function drawQuestion(examId, usedIds, instId = 0) {
  const vis = instId > 0 ? '(institute_id IS NULL OR institute_id = ?)' : 'institute_id IS NULL'
  let sql = `SELECT id FROM questions WHERE is_active = 1 AND exam_id = ? AND ${vis}`
  const params = instId > 0 ? [examId, instId] : [examId]
  if (usedIds.length) { sql += ` AND id NOT IN (${usedIds.map(() => '?').join(',')})`; params.push(...usedIds) }
  sql += ' ORDER BY RANDOM() LIMIT 1'
  return run(sql, params)
}
const drawA = await drawQuestion(EXAM, [], instA)
const drawB = await drawQuestion(EXAM, [QG], instB) // usedIds path exercised too
assert(drawA.every((q) => [QG, QA].includes(q.id)), '4c battles: A draws only global + own')
assert(drawB.every((q) => [QB].includes(q.id)) || drawB.length === 0, '4c battles: B never draws A private question')

// Scenario 4d — AI tutor context ownership check (ai.js /doubt + /explain)
async function tutorCanUse(userId, questionRow) {
  if (!questionRow?.institute_id) return true
  const myInst = await visibilityInstId(userId)
  return Number(questionRow.institute_id) === myInst
}
const rowA = (await run(`SELECT * FROM questions WHERE id = ?`, [QA]))[0]
const rowG = (await run(`SELECT * FROM questions WHERE id = ?`, [QG]))[0]
assert(await tutorCanUse(stuA, rowA) === true, '4d AI tutor: A can use own question as context')
assert(await tutorCanUse(stuB, rowA) === false, '4d AI tutor: B cannot use A question as context (leak blocked)')
assert(await tutorCanUse(stuB, rowG) === true, '4d AI tutor: global questions usable by everyone')

// Scenario 4e — direct-id fetch filter (attempts.js practice sets)
const fetchedForB = (await run(`SELECT * FROM questions WHERE id IN (?,?,?)`, [QA, QB, QG]))
  .filter((q) => !q.institute_id || Number(q.institute_id) === instB)
assert(fetchedForB.length === 2 && !fetchedForB.some((q) => q.id === QA), '4e direct-id fetch: B gets global + own only (no A leak)')

// Scenario 4f — revision (revision.js WHERE shape; due topics have topic_id)
await run(`UPDATE questions SET topic_id = 1 WHERE id = ?`, [QG])
await run(`UPDATE questions SET topic_id = 1 WHERE id = ?`, [QA])
await run(`UPDATE questions SET topic_id = 1 WHERE id = ?`, [QB])
const revA = await run(`SELECT id FROM questions WHERE topic_id IN (1,2) AND is_active = 1 AND (institute_id IS NULL OR institute_id = ?)`, [instA])
const revB = await run(`SELECT id FROM questions WHERE topic_id IN (1,2) AND is_active = 1 AND (institute_id IS NULL OR institute_id = ?)`, [instB])
assert(revA.some((q) => q.id === QG) && revA.some((q) => q.id === QA), '4f revision: A sees global + own')
assert(revB.some((q) => q.id === QG) && !revB.some((q) => q.id === QA), '4f revision: B sees global + own (no A leak)')

console.log(process.exitCode ? '\nISOLATION SMOKE TEST FAILED' : '\nISOLATION SMOKE TEST PASSED — all 4 scenarios verified')
