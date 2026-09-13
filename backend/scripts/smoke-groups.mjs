// Group Study & Discussions smoke test: boots the real Express app against an
// in-memory Postgres (pg-mem) and exercises the full group monetization loop:
//   flags off -> 403 | flags on | create | join x2 | chat blocked (402) |
//   two members buy the group plan -> free seat auto-unlocks | free seat chats
// No DATABASE_URL needed; no secrets printed; temp users are created with
// smoke- emails and the whole DB is in-memory (nothing persists).
import { newDb } from 'pg-mem'

process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke'

const { default: dbReal, pool: poolReal } = await import('../src/db.js')

const mem = newDb({ autoCreateForeignKeyIndices: true, noAstCoverageCheck: true })

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
if (origPoolQuery) {
  poolReal.constructor.prototype.query = function (q, v) {
    return pool.query(q, v)
  }
}

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

async function register(email) {
  const r = await call('/api/auth/register', { method: 'POST', body: { name: email.split('@')[0], email, password: 'SmokeTest123!' } })
  if (!r.data?.token) throw new Error('register failed: ' + JSON.stringify(r.data))
  return r.data.token
}

try {
  await dbReal.initSchema()
  console.log('[smoke] in-memory Postgres schema ready')

  const t = Date.now()
  const tokenA = await register(`ga-${t}@test.local`)
  const tokenB = await register(`gb-${t}@test.local`)
  const tokenC = await register(`gc-${t}@test.local`)
  const tokenAdmin = await register(`adm-${t}@test.local`)
  await dbReal.prepare(`UPDATE users SET role='admin' WHERE email = ?`).run(`adm-${t}@test.local`)

  // 0. Flags off -> groups API must 403
  const off = await call('/api/groups', { token: tokenA })
  ok('groups API 403 when feature disabled', off.status === 403, `status=${off.status}`)

  // Admin enables Group Study + Discussions + QR gateway
  const setup = await call('/api/admin/settings', { method: 'PUT', token: tokenAdmin, body: {
    'features.groupStudy': 'true',
    'features.groupDiscussions': 'true',
    'monetization.gateways': JSON.stringify(['qr']),
    'monetization.provider': 'qr',
    'qr.upiId': 'smoke@upi'
  } })
  ok('admin settings PUT succeeds', setup.status === 200, `status=${setup.status}`)

  // 1. Listing shows deal config
  const list = await call('/api/groups', { token: tokenA })
  ok('groups list returns deal config', list.status === 200 && list.data?.deal?.freeAfterPaid >= 1 && Array.isArray(list.data?.groups), `deal=${JSON.stringify(list.data?.deal || {})}`)
  ok('groupStudy flag reaches features endpoint', (await call('/api/ai/features', { token: tokenA })).data?.groupStudy === true)

  // 2. Create a group
  const created = await call('/api/groups', { method: 'POST', token: tokenA, body: { name: 'Smoke Study Circle' } })
  const gid = created.data?.groupId
  ok('create group returns 201 + joinCode', created.status === 201 && Boolean(created.data?.joinCode), `status=${created.status}`)

  // 3. B and C join via code
  const j1 = await call('/api/groups/join', { method: 'POST', token: tokenB, body: { code: created.data.joinCode } })
  ok('member B joins', j1.status === 200 && !j1.data?.already)
  const j2 = await call('/api/groups/join', { method: 'POST', token: tokenC, body: { code: created.data.joinCode } })
  ok('member C joins', j2.status === 200 && !j2.data?.already)

  // 4. Chat blocked for unpaid member
  const blocked = await call(`/api/groups/${gid}/messages`, { method: 'POST', token: tokenB, body: { body: 'hello?' } })
  ok('chat blocked (402) without entitlement', blocked.status === 402, `status=${blocked.status}`)

  // 5. A buys the group plan (QR flow -> admin mark-paid)
  async function buyGroupPlan(token, email) {
    const o = await call('/api/payments/create-order', { method: 'POST', token, body: { plan: `group_discussions:${gid}`, gateway: 'qr' } })
    if (o.status !== 200) return { status: o.status, data: { step: 'create-order', body: o.data } }
    await call('/api/payments/qr/confirm', { method: 'POST', token, body: { orderId: o.data.orderId, txnRef: 'UTR' + Math.floor(Math.random() * 1e6), payerName: email.split('@')[0] } })
    const st = await call('/api/payments/admin/status', { token: tokenAdmin })
    if (st.status !== 200) return { status: 500, data: { step: 'admin-status', body: st.data } }
    const pay = (st.data?.payments || []).find((p) => p.plan === `group_discussions:${gid}` && p.email === email && p.status === 'pending')
    if (!pay) return { status: 500, data: { step: 'find-payment', gid, all: (st.data?.payments || []).map((p) => ({ plan: p.plan, email: p.email, status: p.status })) } }
    return call('/api/payments/admin/mark-paid', { method: 'POST', token: tokenAdmin, body: { paymentId: pay.id } })
  }
  const payA = await buyGroupPlan(tokenA, `ga-${t}@test.local`)
  ok('owner payment activates group plan', payA.status === 200 && payA.data?.addon === 'group_discussions', `status=${payA.status} body=${JSON.stringify(payA.data || {}).slice(0, 120)}`)

  // Only 1 paying member so far -> no free seat yet
  const d1 = await call(`/api/groups/${gid}`, { token: tokenA })
  ok('1 paying member -> no free seat yet', d1.status === 200 && d1.data.paidCount === 1 && d1.data.freeUnlocked === 0, `paid=${d1.data?.paidCount} free=${d1.data?.freeUnlocked}`)

  const payB = await buyGroupPlan(tokenB, `gb-${t}@test.local`)
  ok('second member payment activates', payB.status === 200, `status=${payB.status}`)

  // 6. Deal engine: 2 paid -> 1 free seat, auto-assigned to C
  const d2 = await call(`/api/groups/${gid}`, { token: tokenA })
  ok('deal engine unlocks 1 free seat (2 paid)', d2.status === 200 && d2.data.paidCount === 2 && d2.data.freeUnlocked === 1, `paid=${d2.data?.paidCount} free=${d2.data?.freeUnlocked}`)

  const myC = await call('/api/payments/my', { token: tokenC })
  const cHasSeat = (myC.data?.addons || []).some((a) => a.id === 'group_discussions')
  ok('free member C received group_discussions entitlement', cHasSeat, `addons=${JSON.stringify(myC.data?.addons || [])}`)

  // 7. Free seat can chat now
  const sent = await call(`/api/groups/${gid}/messages`, { method: 'POST', token: tokenC, body: { body: 'free seat works!' } })
  ok('free seat can post in chat', sent.status === 201, `status=${sent.status}`)
  const msgs = await call(`/api/groups/${gid}/messages?after=0`, { token: tokenA })
  ok('messages visible to members', msgs.status === 200 && msgs.data.messages.some((m) => m.body === 'free seat works!'))

  // 8. Feature flag off -> API locks again (and UI hides via /ai/features)
  await call('/api/admin/settings', { method: 'PUT', token: tokenAdmin, body: { 'features.groupStudy': 'false' } })
  const off2 = await call('/api/groups', { token: tokenA })
  ok('groups API 403 again after flag off', off2.status === 403, `status=${off2.status}`)

  console.log(`\n[smoke-groups] ${results.filter((r) => r.pass).length}/${results.length} passed`)
  process.exit(results.every((r) => r.pass) ? 0 : 1)
} catch (e) {
  console.error('[smoke-groups] CRASH:', e.message, e.stack?.split('\n')[1] || '')
  process.exit(1)
}
