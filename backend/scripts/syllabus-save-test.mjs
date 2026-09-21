// Syllabus save regression test (pg-mem, real Express app):
// The admin UI once posted topic objects where strings were expected and
// seedSyllabus String()'d them into '[object Object]' rows. Proves via real
// HTTP that:
//   1. POST /api/exams/:id/syllabus with OBJECT topics stores clean names
//   2. Same with STRING topics still works (original UI shape)
//   3. Junk topics are skipped, no '[object Object]' rows ever written
//   4. Seed cleanup deletes pre-existing '[object Object]' topics
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
mem.public.registerFunction({ name: 'random', args: [], returns: 'float', implementation: () => Math.random() })
const { Pool } = mem.adapters.createPg()
const pool = new Pool()

poolReal.constructor.prototype.connect = async function () {
  const client = await pool.connect()
  const origQuery = client.query.bind(client)
  client.query = (q, v) => origQuery(typeof q === 'string' ? { text: q, values: v } : q, v)
  return client
}
poolReal.constructor.prototype.query = function (q, v) { return pool.query(q, v) }
dbReal.query = (q, v) => pool.query(q, v)

const app = (await import('../src/app.js')).default
const db = (await import('../src/db.js')).default
await db.initSchema()

// Insert an admin user directly, then get a token through the real login route
// (auth middleware signs/verifies with the same in-process secret).
const bcrypt = (await import('bcryptjs')).default
await db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`)
  .run('Admin', 'syllabus-admin@test.local', bcrypt.hashSync('Testpass1!', 10), 'admin')

const server = app.listen(0)
const base = `http://127.0.0.1:${server.address().port}`

const results = []
const ok = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`) }

const login = await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'syllabus-admin@test.local', password: 'Testpass1!' })
})
const loginData = await login.json()
const token = loginData.token || loginData.data?.token
ok('admin login via real route', login.status === 200 && !!token, `status=${login.status}`)
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` }

const call = async (method, path, body) => {
  const res = await fetch(base + path, { method, headers: H, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

const ce = await call('POST', '/api/exams', { code: 'SYLT', name: 'Syllabus Test Exam' })
ok('exam created (platform admin)', ce.status === 201, `status=${ce.status}`)
const examId = ce.data.exam.id

// 1. Object-shaped topics (the shape that used to break)
const r1 = await call('POST', `/api/exams/${examId}/syllabus`, {
  subjects: [{ name: 'Physics', chapters: [{ name: 'Mechanics', topics: [{ id: 1, name: 'Laws of Motion', questionCount: 3 }, 'Work Energy Power'] }] }]
})
ok('object-topic save returns ok', r1.status === 200 && r1.data.ok, `status=${r1.status}`)
let topics = await db.prepare('SELECT name FROM topics WHERE exam_id = ? ORDER BY sort_order').all(examId)
ok('object topics stored by name', topics.map((t) => t.name).join('|') === 'Laws of Motion|Work Energy Power', JSON.stringify(topics))

// 2. String topics (original UI shape) still fine
const r2 = await call('POST', `/api/exams/${examId}/syllabus`, {
  subjects: [{ name: 'Physics', chapters: [{ name: 'Mechanics', topics: ['Laws of Motion', 'Work Energy Power', 'Friction'] }] }]
})
ok('string-topic save ok', r2.status === 200, `status=${r2.status}`)
topics = await db.prepare('SELECT name FROM topics WHERE exam_id = ? ORDER BY sort_order').all(examId)
ok('string topics stored, count 3', topics.length === 3 && topics[2].name === 'Friction', JSON.stringify(topics))

// 3. Junk topics skipped, never '[object Object]'
await call('POST', `/api/exams/${examId}/syllabus`, {
  subjects: [{ name: 'Chemistry', chapters: [{ name: 'Organic', topics: [{ foo: 1 }, '', { name: 'Alkanes' }, null] }] }]
})
const bogusWritten = await db.prepare("SELECT COUNT(*) c FROM topics WHERE exam_id = ? AND name LIKE '[object%'").get()
ok("no '[object Object]' topics ever written", bogusWritten.c === 0, `count=${bogusWritten.c}`)
const alkanes = await db.prepare("SELECT id FROM topics WHERE name = 'Alkanes'").get()
ok('valid object topic among junk still stored', !!alkanes)

// 4. Seed cleanup removes pre-existing bogus rows (simulate old bug data)
await db.prepare("INSERT INTO topics (chapter_id, exam_id, name, sort_order) SELECT id, exam_id, '[object Object]', 99 FROM chapters WHERE exam_id = ? LIMIT 1").run(examId)
const before = await db.prepare("SELECT COUNT(*) c FROM topics WHERE name LIKE '[object%'").get()
const { seed } = await import('../src/utils/seed.js')
// pg-mem cannot re-run initSchema's IF NOT EXISTS DDL (AST limitation) — the
// schema is already applied above, so make the seed's internal init a no-op.
// Production Postgres has no such issue.
db.initSchema = async () => {}
await seed()
const after = await db.prepare("SELECT COUNT(*) c FROM topics WHERE name LIKE '[object%'").get()
ok('seed cleanup removes bogus topics', before.c >= 1 && after.c === 0, `before=${before.c} after=${after.c}`)

server.close()
process.exit(results.every(Boolean) ? 0 : 1)
