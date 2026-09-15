// Marketing Studio + sales chat audit — generation endpoints, public chat
// fallback, admin guards, stats. pg-mem harness (no real AI key → fallbacks).
import { newDb } from 'pg-mem'

process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke'
process.env.CRON_SECRET = 'smoke-cron-secret'

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
  let data = {}
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

const stamp = Date.now()
try {
  await dbReal.initSchema()
  console.log('[smoke-marketing] schema ready')

  // platform admin
  const reg = await call('/api/auth/register', { method: 'POST', body: { name: 'Admin', email: `admin-${stamp}@t.local`, password: 'AdminPass1!' } })
  await dbReal.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(reg.data.user.id)
  const adminTok = reg.data.token

  // student (must be blocked from admin marketing routes)
  const stu = await call('/api/auth/register', { method: 'POST', body: { name: 'Stu', email: `stu-${stamp}@t.local`, password: 'StuPass1!' } })
  const stuTok = stu.data.token

  // ---------------- 1. guards ------------------------------------------------
  const unauth = await call('/api/marketing/stats')
  ok('unauth marketing stats → 401', unauth.status === 401, `got ${unauth.status}`)
  const stuBlocked = await call('/api/marketing/stats', { token: stuTok })
  ok('student blocked from marketing studio → 403', stuBlocked.status === 403, `got ${stuBlocked.status}`)
  const subBlocked = await call('/api/marketing/calendar', { method: 'POST', token: stuTok, body: { source: 'instagram' } })
  ok('non-platform-admin blocked from generation → 403', subBlocked.status === 403, `got ${subBlocked.status}`)

  // ---------------- 2. public sales chat (no AI key → rules fallback) --------
  const fees = await call('/api/marketing/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'Fees kitni hai?' }] } })
  ok('public chat answers fees (fallback)', fees.status === 200 && /499/.test(fees.data.reply || ''), `status=${fees.status}`)
  ok('public chat returns quick chips', Array.isArray(fees.data.quick) && fees.data.quick.length > 0)

  const school = await call('/api/marketing/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'Hamare school ke liye plan chahiye' }] } })
  ok('school intent detected → escalate flag', school.status === 200 && school.data.escalate === true && /school/i.test(school.data.reply || ''))

  const battle = await call('/api/marketing/chat', { method: 'POST', body: { messages: [{ role: 'user', content: '1v1 battle kaise khelte hain?' }] } })
  ok('battle question answered', battle.status === 200 && /battle/i.test(battle.data.reply || ''))

  const unknown = await call('/api/marketing/chat', { method: 'POST', body: { messages: [{ role: 'user', content: 'xqzj' }] } })
  ok('unknown question → friendly default', unknown.status === 200 && (unknown.data.reply || '').length > 20)

  const empty = await call('/api/marketing/chat', { method: 'POST', body: { messages: [] } })
  ok('empty messages → no crash', empty.status === 200 && Boolean(empty.data.reply))

  // ---------------- 3. admin stats -------------------------------------------
  const stats = await call('/api/marketing/stats', { token: adminTok })
  ok('marketing stats respond', stats.status === 200 && Number.isInteger(stats.data.totalUsers) && Number.isInteger(stats.data.chatCalls), `users=${stats.data?.totalUsers} chat=${stats.data?.chatCalls}`)
  ok('chat usage counted', Number(stats.data.chatCalls) >= 5, `chatCalls=${stats.data?.chatCalls}`)

  // ---------------- 4. asset validation --------------------------------------
  const badType = await call('/api/marketing/asset', { method: 'POST', token: adminTok, body: { type: 'hack', payload: {} } })
  ok('unknown asset type rejected', badType.status === 400, `got ${badType.status}`)

  // ---------------- summary ---------------------------------------------------
  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED CHECKS:')
    failed.forEach((f) => console.log(' -', f.name))
    process.exit(1)
  }
} catch (e) {
  console.error('[smoke-marketing] fatal:', e.message)
  process.exit(1)
}
