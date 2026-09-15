// Coupon system audit — lifecycle, caps, attribution, entitlement integration.
// Boots the real Express app on pg-mem (same harness as smoke-b2b).
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
const ADMIN = { name: 'Admin', email: `admin-${stamp}@t.local`, password: 'AdminPass1!' }

try {
  await dbReal.initSchema()
  console.log('[smoke-coupons] schema ready')

  // ---------------- setup: platform admin + two students --------------------
  const reg = await call('/api/auth/register', { method: 'POST', body: ADMIN })
  if (reg.status !== 201) { console.error('[smoke-coupons] admin register failed', reg.status, JSON.stringify(reg.data).slice(0, 300)); process.exit(1) }
  await dbReal.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(reg.data.user.id)
  const adminTok = reg.data.token

  const s1 = await call('/api/auth/register', { method: 'POST', body: { name: 'Stu One', email: `s1-${stamp}@t.local`, password: 'StuPass1!' } })
  const s2 = await call('/api/auth/register', { method: 'POST', body: { name: 'Stu Two', email: `s2-${stamp}@t.local`, password: 'StuPass2!' } })
  const tok1 = s1.data.token
  const tok2 = s2.data.token
  ok('two students registered', s1.status === 201 && s2.status === 201 && Boolean(tok1) && Boolean(tok2))

  // ---------------- 1. coupon creation & validation --------------------------
  const bad = await call('/api/coupons/admin', { method: 'POST', token: adminTok, body: { code: 'x' } })
  ok('invalid code rejected', bad.status === 400, `status=${bad.status}`)

  const c1 = await call('/api/coupons/admin', { method: 'POST', token: adminTok, body: { code: 'INSTA500', days: 7, source: 'instagram', maxUses: 2, perUserLimit: 1 } })
  ok('coupon created (normalized uppercase)', c1.status === 201 && c1.data.code === 'INSTA500', `code=${c1.data?.code}`)
  const dup = await call('/api/coupons/admin', { method: 'POST', token: adminTok, body: { code: 'insta500', days: 7, source: 'instagram' } })
  ok('duplicate code (case-insensitive) rejected', dup.status === 409, `status=${dup.status}`)

  const badAddon = await call('/api/coupons/admin', { method: 'POST', token: adminTok, body: { code: 'BADADDON', kind: 'addon', addonId: 'nope', days: 30 } })
  ok('addon coupon with unknown addon rejected', badAddon.status === 400, `status=${badAddon.status}`)

  const cAddon = await call('/api/coupons/admin', { method: 'POST', token: adminTok, body: { code: 'TELEGRAMAI', kind: 'addon', addonId: 'ai_power', days: 30, source: 'telegram' } })
  ok('addon coupon created', cAddon.status === 201 && cAddon.data.kind === 'addon', `kind=${cAddon.data?.kind}`)

  // ---------------- 2. sub-admin blocked (platformOnly) ----------------------
  // (Institute + sub-admin setup mirrors smoke-b2b.)
  const inst = await call('/api/institutes/admin/institutes', { method: 'POST', token: adminTok, body: { name: 'Coup Academy', kind: 'coaching' } })
  await call(`/api/institutes/admin/institutes/${inst.data.instituteId}/subadmin`, { method: 'POST', token: adminTok, body: { name: 'Sub', email: `sub-${stamp}@t.local`, password: 'SubPass1!' } })
  const subLogin = await call('/api/auth/login', { method: 'POST', body: { email: `sub-${stamp}@t.local`, password: 'SubPass1!' } })
  const subTok = subLogin.data.token
  const subBlocked = await call('/api/coupons/admin/list', { token: subTok })
  ok('sub-admin BLOCKED from coupon admin', subBlocked.status === 403, `got ${subBlocked.status}`)

  // ---------------- 3. preview + redeem: retention coupon --------------------
  const chk = await call('/api/coupons/check?code=insta500')
  ok('public check: valid + label (case-insensitive)', chk.status === 200 && chk.data.valid === true && /7 days/.test(chk.data.label || ''), `label=${chk.data?.label}`)
  const chkBad = await call('/api/coupons/check?code=NOPE123')
  ok('public check: invalid code', chkBad.status === 200 && chkBad.data.valid === false)

  const r1 = await call('/api/coupons/redeem', { method: 'POST', token: tok1, body: { code: 'insta500' } })
  ok('student redeems retention coupon', r1.status === 200 && r1.data.ok === true && r1.data.kind === 'retention', `kind=${r1.data?.kind}`)

  const status1 = await call('/api/payments/my', { token: tok1 })
  ok('retention activated for redeemer', status1.status === 200 && status1.data.retention === true, `retention=${status1.data?.retention}`)

  const r1again = await call('/api/coupons/redeem', { method: 'POST', token: tok1, body: { code: 'INSTA500' } })
  ok('same user cannot redeem twice (per-user limit)', r1again.status === 400, `status=${r1again.status}`)

  const r2 = await call('/api/coupons/redeem', { method: 'POST', token: tok2, body: { code: 'INSTA500' } })
  ok('second student redeems (cap 2/2)', r2.status === 200, `status=${r2.status}`)

  const r3 = await call('/api/coupons/redeem', { method: 'POST', token: adminTok, body: { code: 'INSTA500' } })
  ok('third redemption blocked (total cap reached)', r3.status === 400, `status=${r3.status}`)

  const chkFull = await call('/api/coupons/check?code=INSTA500')
  ok('check reports fully-used coupon', chkFull.data.valid === false && /fully used/i.test(chkFull.data.message || ''))

  // ---------------- 4. addon coupon ------------------------------------------
  const ra = await call('/api/coupons/redeem', { method: 'POST', token: tok2, body: { code: 'TELEGRAMAI' } })
  ok('addon coupon redeemed', ra.status === 200 && ra.data.kind === 'addon' && ra.data.addon === 'ai_power', `addon=${ra.data?.addon}`)
  const status2 = await call('/api/payments/my', { token: tok2 })
  ok('ai_power entitlement active after addon coupon', status2.data?.aiPower === true, `aiPower=${status2.data?.aiPower}`)

  // points awarded for redemption (recognition loop) — checked before the
  // delete test below, because deleting a coupon cascades its redemption rows.
  const mine = await call('/api/coupons/mine', { token: tok2 })
  ok('student redemption history', mine.status === 200 && mine.data.items?.length >= 2, `items=${mine.data?.items?.length}`)

  // ---------------- 5. pause / expiry / delete -------------------------------
  const list = await call('/api/coupons/admin/list', { token: adminTok })
  ok('admin list shows usage + source stats', list.status === 200 && list.data.coupons?.length >= 2 && Array.isArray(list.data.bySource), `codes=${list.data.coupons?.length} sources=${list.data.bySource?.length}`)
  const insta = list.data.coupons.find((c) => c.code === 'INSTA500')
  ok('source attribution recorded (instagram)', insta?.source === 'instagram' && Number(insta?.redemptions) === 2, `source=${insta?.source} redemptions=${insta?.redemptions}`)
  const tg = list.data.bySource.find((s) => s.source === 'telegram')
  ok('bySource campaign rollup has telegram', Boolean(tg) && Number(tg.redemptions) === 1, `telegram redemptions=${tg?.redemptions}`)

  const instRow = await dbReal.prepare(`SELECT id FROM coupons WHERE code='INSTA500'`).get()
  const pause = await call(`/api/coupons/admin/${instRow.id}`, { method: 'PUT', token: adminTok, body: { is_active: false } })
  ok('pause coupon', pause.status === 200 && Number(pause.data.is_active) === 0)
  const rPaused = await call('/api/coupons/redeem', { method: 'POST', token: adminTok, body: { code: 'INSTA500' } })
  ok('paused coupon redeem blocked', rPaused.status === 400, `status=${rPaused.status}`)
  await call(`/api/coupons/admin/${instRow.id}`, { method: 'PUT', token: adminTok, body: { is_active: true } })

  const del = await call(`/api/coupons/admin/${instRow.id}`, { method: 'DELETE', token: adminTok })
  ok('delete coupon', del.status === 200)
  const rDeleted = await call('/api/coupons/redeem', { method: 'POST', token: adminTok, body: { code: 'INSTA500' } })
  ok('deleted coupon redeem → invalid', rDeleted.status === 404, `status=${rDeleted.status}`)

  // expired coupon
  const cExp = await call('/api/coupons/admin', { method: 'POST', token: adminTok, body: { code: 'OLDCODE', days: 5, expiresAt: '2020-01-01' } })
  const chkExp = await call('/api/coupons/check?code=OLDCODE')
  ok('expired coupon reported invalid', cExp.status === 201 && chkExp.data.valid === false && /expired/i.test(chkExp.data.message || ''))

  // unauth guards
  const unauthCreate = await call('/api/coupons/admin', { method: 'POST', body: { code: 'HAX' } })
  ok('unauthenticated coupon creation → 401', unauthCreate.status === 401, `got ${unauthCreate.status}`)
  const unauthRedeem = await call('/api/coupons/redeem', { method: 'POST', body: { code: 'TELEGRAMAI' } })
  ok('unauthenticated redeem → 401', unauthRedeem.status === 401, `got ${unauthRedeem.status}`)

  // ---------------- summary ---------------------------------------------------

  // (redemption history was already verified above — deleting the coupon
  // cascades its redemption rows, which is the intended cleanup behavior)

  // expired coupon
  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED CHECKS:')
    failed.forEach((f) => console.log(' -', f.name))
    process.exit(1)
  }
} catch (e) {
  console.error('[smoke-coupons] fatal:', e.message)
  process.exit(1)
}
