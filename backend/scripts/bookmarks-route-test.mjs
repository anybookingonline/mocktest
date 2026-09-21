// Route-order regression test (pg-mem, real Express app):
// /api/questions/bookmarks/list used to be shadowed by GET /:id — Express
// matched "bookmarks" as :id and Postgres 500'd casting it to INTEGER.
// Proves via real HTTP calls:
//   1. GET /api/questions/bookmarks/list -> 200 + the user's bookmarks
//   2. GET /api/questions/999999         -> 404 (not 500)
// No real database touched.
import { newDb } from 'pg-mem'
process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke'

const { default: dbReal, pool: poolReal } = await import('../src/db.js')

const mem = newDb({ autoCreateForeignKeyIndices: true })
const pad = (n) => String(n).padStart(2, '0')
const fmtTs = (v) => {
  const d = v instanceof Date ? v : new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
for (const t of ['timestamptz', 'timestamp']) {
  mem.public.registerFunction({ name: 'to_char', args: [t, 'text'], returns: 'text', implementation: fmtTs })
}
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
const results = []
const ok = (name, cond, extra = '') => {
  results.push(Boolean(cond))
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
  let data = {}
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

let email = null
try {
  await dbReal.initSchema()

  // Seed: one exam + two questions + bookmarks for a fresh user
  const exam = await dbReal.prepare(`INSERT INTO exams (name, code, icon, duration_minutes, total_questions, marks_per_question, negative_marks)
    VALUES ('RouteTest Exam', 'RTE', '🎯', 60, 10, 4, 1) RETURNING id`).run()
  const examId = exam.lastInsertRowid
  const q1 = await dbReal.prepare(`INSERT INTO questions (exam_id, question_text, options_json, correct_answer, content_hash)
    VALUES (?, 'Question one?', '[]', 'A', 'rt-hash-1') RETURNING id`).run(examId)
  const q2 = await dbReal.prepare(`INSERT INTO questions (exam_id, question_text, options_json, correct_answer, content_hash)
    VALUES (?, 'Question two?', '[]', 'B', 'rt-hash-2') RETURNING id`).run(examId)

  email = `rt-${Date.now()}@test.local`
  const reg = await call('/api/auth/register', { method: 'POST', body: { name: 'Route Test', email, password: 'RouteTest123!', target_exam: 'RouteTest Exam' } })
  ok('user registered', reg.status === 201 && Boolean(reg.data?.token), `status=${reg.status}`)
  const token = reg.data?.token
  const me = await call('/api/auth/me', { token })
  const uid = me.data?.user?.id

  await dbReal.prepare(`INSERT INTO bookmarks (user_id, question_id, created_at) VALUES (?, ?, '2026-09-20 10:00:00'), (?, ?, '2026-09-19 10:00:00')`)
    .run(uid, q2.lastInsertRowid, uid, q1.lastInsertRowid)

  // THE regression: this used to 500 (route shadowed by /:id)
  const list = await call('/api/questions/bookmarks/list', { token })
  ok('GET /questions/bookmarks/list returns 200', list.status === 200, `status=${list.status} err=${(list.data?.error || '-').slice(0, 60)}`)
  ok('list returns both bookmarks, newest first', list.data?.questions?.length === 2 && Number(list.data.questions[0].id) === Number(q2.lastInsertRowid),
    `got ${list.data?.questions?.length} questions, first=${list.data?.questions?.[0]?.id}`)

  // /:id with a nonexistent id must 404, never 500
  const missing = await call('/api/questions/999999', { token })
  ok('GET /questions/999999 returns 404', missing.status === 404, `status=${missing.status}`)
} catch (e) {
  console.error('TEST ERROR:', e.message)
  results.push(false)
} finally {
  if (email) await dbReal.prepare('DELETE FROM users WHERE email = ?').run(email).catch(() => {})
  process.exit(results.every(Boolean) ? 0 : 1)
}
