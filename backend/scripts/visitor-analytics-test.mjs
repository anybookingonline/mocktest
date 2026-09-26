// Visitor analytics regression test (pg-mem, real Express app — no real DB):
//   1. POST /api/analytics/track is public (204, no auth)
//   2. A hit is recorded with source/device/geo/ip/path
//   3. Duplicate ping (same session+path, within 30 min) is deduped
//   4. New session on a different path counts as a new visit group
//   5. Admin /api/admin/visitors returns summary (today/total), sources, countries, pagination
//   6. Non-admin cannot read /api/admin/visitors (403)
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
  .run('Admin', 'visits-admin@test.local', bcrypt.hashSync('Testpass1!', 10), 'admin')

const server = app.listen(0)
const base = `http://127.0.0.1:${server.address().port}`

const results = []
const ok = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`) }

const login = await fetch(base + '/api/auth/login', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email: 'visits-admin@test.local', password: 'Testpass1!' })
})
const token = (await login.json()).token
ok('admin login', login.status === 200 && !!token, `status=${login.status}`)
const H = { 'content-type': 'application/json', authorization: `Bearer ${token}` }

// 1. Public tracking endpoint (no auth), with Cloudflare geo headers
const t1 = await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: {
    'content-type': 'application/json',
    'cf-connecting-ip': '203.0.113.7',
    'cf-ipcountry': 'IN',
    'cf-ipcity': 'Kanpur',
    referer: 'https://www.google.com/search?q=jee+mock+test',
    'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
  },
  body: JSON.stringify({ visitorId: 'vis-abc123', sessionId: 'sess-001', path: '/' })
})
ok('track is public + 204', t1.status === 204, `status=${t1.status}`)

let row = (await db.prepare('SELECT * FROM visitor_hits LIMIT 1').all())[0]
ok('hit recorded with parsed source', row?.source === 'Google', `source=${row?.source}`)
ok('hit recorded with device', row?.device === 'mobile', `device=${row?.device}`)
ok('hit recorded with geo', row?.country_code === 'IN' && row?.city === 'Kanpur', `country=${row?.country_code}/${row?.city}`)
ok('hit recorded with ip+path', row?.ip === '203.0.113.7' && row?.path === '/', `ip=${row?.ip} path=${row?.path}`)

// 2. Duplicate ping (same session+path within dedupe window) — must not insert
await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: { 'content-type': 'application/json', referer: 'https://t.me/aisepadho' },
  body: JSON.stringify({ visitorId: 'vis-abc123', sessionId: 'sess-001', path: '/' })
})
let cnt = Number((await db.prepare('SELECT COUNT(*) c FROM visitor_hits').get()).c)
ok('duplicate session+path deduped', cnt === 1, `rows=${cnt}`)

// 2b. 24-HOUR VISITOR DEDUPE: same visitor returns in a NEW tab/session
// (e.g. browser restart) on the same page — must still not count again.
await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ visitorId: 'vis-abc123', sessionId: 'sess-brand-new', path: '/' })
})
cnt = Number((await db.prepare('SELECT COUNT(*) c FROM visitor_hits').get()).c)
ok('24h visitor dedupe (new tab, same page)', cnt === 1, `rows=${cnt}`)

// 2c. But a DIFFERENT visitor (different IP/browser) on the same page counts.
await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: { 'content-type': 'application/json', referer: 'https://t.me/aisepadho' },
  body: JSON.stringify({ visitorId: 'vis-other-42', sessionId: 'sess-009', path: '/' })
})
cnt = Number((await db.prepare('SELECT COUNT(*) c FROM visitor_hits').get()).c)
ok('different visitor same page counts', cnt === 2, `rows=${cnt}`)

// 3. Same visitor, different path + another visitor → new groups
await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ visitorId: 'vis-abc123', sessionId: 'sess-001', path: '/register' })
})
await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: { 'content-type': 'application/json', referer: 'https://www.instagram.com/p/xyz' },
  body: JSON.stringify({ visitorId: 'vis-xyz789', sessionId: 'sess-002', path: '/schools' })
})
cnt = Number((await db.prepare('SELECT COUNT(*) c FROM visitor_hits').get()).c)
ok('new visitor/path groups recorded', cnt === 4, `rows=${cnt}`)

// Same visitor returns later (new session) — unique visitor count must stay 2
await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ visitorId: 'vis-abc123', sessionId: 'sess-003', path: '/dashboard' })
})

// 4. Admin summary endpoint
const v = await fetch(base + '/api/admin/visitors?page=1&perPage=50', { headers: H })
const vd = await v.json()
ok('admin visitors 200', v.status === 200, `status=${v.status}`)
ok('summary counts', vd.summary?.total?.visitors === 3 && vd.summary?.today?.views === 5, JSON.stringify(vd.summary))
ok('top sources include Google', vd.topSources?.some((s) => s.source === 'Google'), JSON.stringify(vd.topSources?.map((s) => s.source)))
ok('top countries include IN', vd.topCountries?.some((c) => c.country === 'IN'), JSON.stringify(vd.topCountries))
ok('pagination present', vd.pagination?.page === 1 && typeof vd.pagination?.total === 'number', JSON.stringify(vd.pagination))
ok('detail rows present', Array.isArray(vd.hits) && vd.hits.length === 5, `rows=${vd.hits?.length}`)

// 5. Non-admin blocked (403 via platformOnly)
const stu = await fetch(base + '/api/auth/register', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ name: 'Stu', email: 'visits-stu@test.local', password: 'Testpass1!' })
})
const stuBody = await stu.json().catch(() => ({}))
const stuTok = stuBody.token || stuBody.data?.token
const stuH = stuTok ? { authorization: `Bearer ${stuTok}` } : {}
const blocked = await fetch(base + '/api/admin/visitors', { headers: stuH })
ok('non-admin blocked from visitors API', blocked.status === 401 || blocked.status === 403, `status=${blocked.status}`)

// 6. Pagination slice works (perPage=10 min-clamp, page 2 of 5 groups)
await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ visitorId: 'vis-abc123', sessionId: 'sess-004', path: '/rankings' })
})
await fetch(base + '/api/analytics/track', {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ visitorId: 'vis-abc123', sessionId: 'sess-005', path: '/history' })
})
const p2 = await fetch(base + '/api/admin/visitors?page=1&perPage=10', { headers: H })
const p2d = await p2.json()
// 5 base groups + /dashboard + /rankings + /history extras = 7 groups total
ok('pagination slice', p2.status === 200 && p2d.hits?.length === 7 && p2d.pagination?.pages === 1, `rows=${p2d.hits?.length} pages=${p2d.pagination?.pages}`)

server.close()
const pass = results.filter(Boolean).length
console.log(`\n${pass}/${results.length} PASS`)
process.exit(pass === results.length ? 0 : 1)
