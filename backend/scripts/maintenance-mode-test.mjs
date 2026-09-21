// Maintenance mode regression test (pg-mem, real Express app — no real DB):
//   1. Default state: /api/meta/status says enabled:false, student APIs work
//   2. Admin flips maintenance ON via PUT /api/admin/settings
//   3. /api/meta/status flips to enabled:true with message+eta
//   4. Student-facing API (GET /api/exams) now 503s with MAINTENANCE_MODE code
//   5. Unauthenticated /api/auth/me stays open (SPA role resolution)
//   6. /api/health stays open (Coolify uptime checks)
//   7. Admin session still passes the gate (admin bypass)
//   8. Flip OFF restores normal service immediately
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

const bcrypt = (await import('bcryptjs')).default
await db.prepare(`INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)`)
  .run('Admin', 'maint-admin@test.local', bcrypt.hashSync('Testpass1!', 10), 'admin')
await db.prepare(`INSERT INTO exams (code, name) VALUES (?, ?)`).run('MNT', 'Maintenance Test Exam')

const server = app.listen(0)
const base = `http://127.0.0.1:${server.address().port}`

const results = []
const ok = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`) }

const login = await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'maint-admin@test.local', password: 'Testpass1!' })
})
const loginData = await login.json()
const token = loginData.token || loginData.data?.token
ok('admin login', login.status === 200 && !!token, `status=${login.status}`)
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` }

const call = async (method, path, body, headers = {}) => {
  const res = await fetch(base + path, { method, headers: { ...H, ...headers, ...(body && !headers['content-type'] ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}
const anon = async (method, path) => {
  const res = await fetch(base + path, { method })
  return { status: res.status, data: await res.json().catch(() => ({})) }
}

// 1. Default: maintenance off, exams API works
let st = await anon('GET', '/api/meta/status')
ok('default status disabled', st.status === 200 && st.data.enabled === false, JSON.stringify(st.data))
let exams = await anon('GET', '/api/exams')
ok('exams API works before maintenance', exams.status === 200, `status=${exams.status}`)

// 2. Flip ON via admin settings (boolean shape, like the UI toggle)
const put = await call('PUT', '/api/admin/settings', { 'maintenance.enabled': true, 'maintenance.message': 'Naye features aa rahe hain!', 'maintenance.eta': '18:30' })
ok('admin flips maintenance ON', put.status === 200 && put.data.saved === true, `status=${put.status}`)

// 3. Public status reflects it
st = await anon('GET', '/api/meta/status')
ok('status now enabled with message+eta', st.data.enabled === true && st.data.message === 'Naye features aa rahe hain!' && st.data.eta === '18:30', JSON.stringify(st.data))

// 4. Student API blocked with 503 + code (unauthenticated request — strictest case)
exams = await anon('GET', '/api/exams')
ok('student API 503 during maintenance', exams.status === 503 && exams.data.code === 'MAINTENANCE_MODE', `status=${exams.status} code=${exams.data.code}`)

// 5. /auth/me stays open (unauthenticated probe must 401, not 503 — proves the route is reachable)
const me = await anon('GET', '/api/auth/me')
ok('auth/me reachable (401 unauth, not 503)', me.status === 401, `status=${me.status}`)

// 6. Health stays open
const health = await anon('GET', '/api/health')
ok('health reachable during maintenance', health.status === 200 && health.data.ok === true, `status=${health.status}`)

// 7. Admin bypasses the gate
const adminExams = await call('GET', '/api/exams', null, { authorization: `Bearer ${token}` })
ok('admin bypasses gate', adminExams.status === 200, `status=${adminExams.status}`)

// 8. Flip OFF restores service
await call('PUT', '/api/admin/settings', { 'maintenance.enabled': false })
st = await anon('GET', '/api/meta/status')
exams = await anon('GET', '/api/exams')
ok('flip OFF restores service', st.data.enabled === false && exams.status === 200, `status=${st.data.enabled}/${exams.status}`)

// Bonus: string 'true'/'1' shapes also normalize ON (defensive)
await call('PUT', '/api/admin/settings', { 'maintenance.enabled': '1' })
st = await anon('GET', '/api/meta/status')
ok("string '1' also enables", st.data.enabled === true, `enabled=${st.data.enabled}`)
await call('PUT', '/api/admin/settings', { 'maintenance.enabled': false })

server.close()
const pass = results.filter(Boolean).length
console.log(`\n${pass}/${results.length} checks passed`)
process.exit(pass === results.length ? 0 : 1)
