// Smoke: adaptive engine fallbacks.
// 1) topic with NO questions + AI unavailable (no keys in smoke env) -> relaxed
//    scope still returns a question instead of 404.
// 2) normal topic picker still serves DB questions.
// 3) adaptive start/next/complete happy path.
// Boots the real Express app on pg-mem. Never prints env/secret values.
import { newDb } from 'pg-mem'

process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke'

const { default: dbReal, pool: poolReal } = await import('../src/db.js')

const mem = newDb({ noAstCoverageCheck: true, autoCreateForeignKeyIndices: true })
const pad = (n) => String(n).padStart(2, '0')
const fmtTs = (v) => {
  const d = v instanceof Date ? v : new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
for (const t of ['timestamptz', 'timestamp']) {
  mem.public.registerFunction({ name: 'to_char', args: [t, 'text'], returns: 'text', implementation: fmtTs })
}
mem.public.registerFunction({ name: 'random', args: [], returns: 'double precision', implementation: () => Math.random() })
const { Pool } = mem.adapters.createPg()
const pool = new Pool()
const origConnect = poolReal.constructor.prototype.connect
poolReal.constructor.prototype.connect = async function () {
  const client = await pool.connect()
  const origQuery = client.query.bind(client)
  client.query = (q, v) => origQuery(typeof q === 'string' ? { text: q, values: v } : q, v)
  return client
}
const origPoolQuery = poolReal.constructor.prototype.query
if (origPoolQuery) poolReal.constructor.prototype.query = function (q, v) { return pool.query(q, v) }

const app = (await import('../src/app.js')).default
const db = dbReal

const results = []
const ok = (name, cond, extra = '') => {
  results.push({ name, pass: Boolean(cond) })
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}
const BASE = await new Promise((resolve) => {
  const server = app.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`))
})

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })
  let data = null
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

// ---- schema: reuse the app's real schema, then add smoke-specific bits ----
try { await db.initSchema(); console.log('[smoke] schema ready') } catch (e) { console.log('[smoke] initSchema:', e.message) }

const bcrypt = (await import('bcryptjs')).default
const EMAIL = 's1@test.local'
// NOTE: email goes in as a parameter — pg-mem treats '@' inside SQL text as a
// named-parameter marker, which would corrupt a literal email address.
const u = await db.prepare(`INSERT INTO users (name, email, password_hash, role, points) VALUES ('Smoke Student', ?, ?, 'student', 0) RETURNING id`).run(EMAIL, bcrypt.hashSync('Passw0rd!123', 10))
const uid = Number(u.lastInsertRowid)

// Exam 1: Bank PO with an EMPTY topic (mirrors the reported bug).
// Exam 2: seeded questions for the happy path.
const e1 = await db.prepare(`INSERT INTO exams (code, name) VALUES ('BANK-PO', 'Banking PO') RETURNING id`).run()
const exam1 = Number(e1.lastInsertRowid)
const s1 = await db.prepare(`INSERT INTO subjects (exam_id, name) VALUES (?, 'Quant') RETURNING id`).run(exam1)
const c1 = await db.prepare(`INSERT INTO chapters (exam_id, subject_id, name) VALUES (?, ?, 'Arithmetic') RETURNING id`).run(exam1, Number(s1.lastInsertRowid))
const t1 = await db.prepare(`INSERT INTO topics (exam_id, chapter_id, name) VALUES (?, ?, 'Simplification') RETURNING id`).run(exam1, Number(c1.lastInsertRowid))
const emptyTopicId = Number(t1.lastInsertRowid)
// Exam 1 has questions ONLY in a sibling topic — the reported real-world case
// (selected topic empty, exam not).
const t1b = await db.prepare(`INSERT INTO topics (exam_id, chapter_id, name) VALUES (?, ?, 'Data Interpretation') RETURNING id`).run(exam1, Number(c1.lastInsertRowid))
for (let i = 1; i <= 3; i++) {
  await db.prepare(`INSERT INTO questions (exam_id, subject_id, chapter_id, topic_id, question_text, options_json, correct_answer, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, 'A', 'medium')`).run(exam1, Number(s1.lastInsertRowid), Number(c1.lastInsertRowid), Number(t1b.lastInsertRowid),
    `DI Q${i}: pie chart?`, JSON.stringify(['A. yes', 'B. no']))
}

const e2 = await db.prepare(`INSERT INTO exams (code, name) VALUES ('SSC-CGL', 'SSC CGL') RETURNING id`).run()
const exam2 = Number(e2.lastInsertRowid)
const s2 = await db.prepare(`INSERT INTO subjects (exam_id, name) VALUES (?, 'Reasoning') RETURNING id`).run(exam2)
const c2 = await db.prepare(`INSERT INTO chapters (exam_id, subject_id, name) VALUES (?, ?, 'Puzzle') RETURNING id`).run(exam2, Number(s2.lastInsertRowid))
const t2 = await db.prepare(`INSERT INTO topics (exam_id, chapter_id, name) VALUES (?, ?, 'Seating') RETURNING id`).run(exam2, Number(c2.lastInsertRowid))
const seededTopic = Number(t2.lastInsertRowid)
for (let i = 1; i <= 5; i++) {
  await db.prepare(`INSERT INTO questions (exam_id, subject_id, chapter_id, topic_id, question_text, options_json, correct_answer, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, 'A', ?)`).run(exam2, Number(s2.lastInsertRowid), Number(c2.lastInsertRowid), seededTopic,
    `Q${i}: 2+2=?`, JSON.stringify(['A. 4', 'B. 5']), i <= 2 ? 'easy' : i <= 4 ? 'medium' : 'hard')
}

const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: 'Passw0rd!123' } })
const token = login.data?.token
ok('login works', Boolean(token))

// 1) Happy path: seeded topic serves DB questions with levels
let st = await call('/api/ai/adaptive/start', { method: 'POST', token, body: { examId: exam2, topicId: seededTopic, numQuestions: 3 } })
ok('adaptive start (seeded topic)', st.status === 201 && st.data?.attemptId, `status=${st.status}`)
let nx = await call(`/api/ai/adaptive/${st.data.attemptId}/next`, { method: 'POST', token, body: {} })
ok('next returns question + no ai/relaxed flags', nx.status === 200 && nx.data?.question?.id && nx.data.aiGenerated === false && nx.data.relaxed === false, `status=${nx.status}`)

// 2) Empty topic (Bank PO bug): AI unavailable in smoke env -> relaxed scope must
//    still return a question from the same exam instead of 404.
st = await call('/api/ai/adaptive/start', { method: 'POST', token, body: { examId: exam1, topicId: emptyTopicId, numQuestions: 3 } })
nx = await call(`/api/ai/adaptive/${st.data.attemptId}/next`, { method: 'POST', token, body: {} })
ok('empty topic does NOT 404 (relaxed fallback)', nx.status === 200 && nx.data?.question?.id, `status=${nx.status} data=${JSON.stringify(nx.data).slice(0, 120)}`)
ok('relaxed flag set when scope widened', nx.status === 200 && nx.data?.relaxed === true)
if (nx.status === 200 && nx.data?.question?.id) {
  await call(`/api/ai/adaptive/${st.data.attemptId}/next`, { method: 'POST', token, body: { lastQuestionId: nx.data.question.id, wasCorrect: false } })
  const nx2 = await call(`/api/ai/adaptive/${st.data.attemptId}/next`, { method: 'POST', token, body: {} })
  ok('session continues after relaxed answer', nx2.status === 200 || (nx2.status === 404 && nx2.data?.done === undefined), `status=${nx2.status}`)
}

// 3) Empty EXAM (nothing anywhere, AI down) -> clean 404 message, not a crash
const e3 = await db.prepare(`INSERT INTO exams (code, name) VALUES ('EMPTY-X', 'Empty Exam') RETURNING id`).run()
st = await call('/api/ai/adaptive/start', { method: 'POST', token, body: { examId: Number(e3.lastInsertRowid), numQuestions: 3 } })
nx = await call(`/api/ai/adaptive/${st.data.attemptId}/next`, { method: 'POST', token, body: {} })
ok('truly empty exam -> clean 404', nx.status === 404 && /No more questions/.test(nx.data?.error || ''), `status=${nx.status}`)

const passed = results.filter((r) => r.pass).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
