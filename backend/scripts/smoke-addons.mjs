// Smoke test for the paid add-on monetization loop:
//   buy addon (QR order) -> admin mark-paid -> entitlement active -> gating flips.
// Boots the real app on in-memory Postgres (pg-mem). Prints only pass/fail.
import { newDb } from 'pg-mem'

process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke'

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
const { default: db, pool: poolReal } = await import('../src/db.js')
poolReal.constructor.prototype.connect = async function () {
  const c = await pool.connect()
  const q = c.query.bind(c)
  c.query = (a, b) => q(typeof a === 'string' ? { text: a, values: b } : a, b)
  return c
}
poolReal.constructor.prototype.query = function (a, b) { return pool.query(a, b) }
db.query = (a, b) => pool.query(a, b)
await db.initSchema()

const { default: app } = await import('../src/app.js')
const http = await import('node:http')
const server = http.createServer(app)
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const base = `http://127.0.0.1:${server.address().port}`

const results = []
const ok = (name, cond, extra = '') => {
  results.push(cond)
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
}
const j = async (path, opts = {}, token) => {
  const res = await fetch(base + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(opts.headers || {}) }
  })
  let body = {}
  try { body = await res.json() } catch { /* ignore */ }
  return { status: res.status, body }
}

// Seed admin (ADMIN_PASSWORD is set in this script's own env below) + a student
process.env.ADMIN_PASSWORD ||= 'SmokeAdmin123!'
const { seed } = await import('../src/utils/seed.js')
await seed()

const email = `addon-${Date.now()}@test.local`
const reg = await j('/api/auth/register', { method: 'POST', body: JSON.stringify({ name: 'Addon Tester', email, password: 'TestPass123!' }) })
const studentToken = reg.body?.token
ok('student registered', reg.status === 201 && Boolean(studentToken), `status=${reg.status}`)

const adminLogin = await j('/api/auth/login', { method: 'POST', body: JSON.stringify({ email: 'admin@examai.app', password: process.env.ADMIN_PASSWORD }) })
const adminToken = adminLogin.body?.token
ok('admin login', adminLogin.status === 200 && Boolean(adminToken), `status=${adminLogin.status}`)

// Enable the QR gateway for this test (admin-tunable) + configure its UPI ID
await j('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ 'monetization.gateways': '["razorpay","qr"]', 'qr.upiId': 'smoketest@upi' }) }, adminToken)

// 1. Plans catalog exposes both add-ons with admin-adjustable prices
const plans = await j('/api/payments/plans')
const aiPack = (plans.body?.addons || []).find((a) => a.id === 'ai_power')
const voice = (plans.body?.addons || []).find((a) => a.id === 'voice_doubts')
ok('plans catalog lists AI Power Pack + Voice Doubts', Boolean(aiPack && voice), `status=${plans.status} prices=${aiPack?.price}/${voice?.price} body=${JSON.stringify(plans.body).slice(0, 120)}`)

// 2. Entitlements start empty -> transcribe is 402 (paid gate)
const feats0 = await j('/api/ai/features', {}, studentToken)
ok('features show no entitlements initially', feats0.body?.voiceUnlocked === false && feats0.body?.telegramUnlimited === false)

// 3. Create a QR order for the AI Power Pack
const order = await j('/api/payments/create-order', { method: 'POST', body: JSON.stringify({ plan: 'ai_power', gateway: 'qr' }) }, studentToken)
ok('QR order created for ai_power', order.status === 200 && Boolean(order.body?.orderId), `orderId=${order.body?.orderId}`)

// 4. Student reports payment; admin verifies via mark-paid
await j('/api/payments/qr/confirm', { method: 'POST', body: JSON.stringify({ orderId: order.body.orderId, txnRef: 'UTR123', payerName: 'Tester' }) }, studentToken)
const adminStatus = await j('/api/payments/admin/status', {}, adminToken)
const payId = adminStatus.body?.payments?.find((p) => p.plan === 'ai_power' && p.status === 'pending')?.id
const marked = await j('/api/payments/admin/mark-paid', { method: 'POST', body: JSON.stringify({ paymentId: payId }) }, adminToken)
ok('admin mark-paid activates addon', marked.status === 200 && marked.body?.addon === 'ai_power', `statusRows=${adminStatus.body?.payments?.length} payId=${payId} resp=${JSON.stringify(marked.body).slice(0, 100)}`)

// 5. Entitlements now show aiPower
const my = await j('/api/payments/my', {}, studentToken)
ok('/payments/my shows aiPower entitlement', my.body?.aiPower === true, JSON.stringify(my.body?.addons))

// 6. Admin raises the addon price -> catalog reflects it (admin-tunable pricing)
await j('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ 'addons.voicePrice': '79' }) }, adminToken)
const plans2 = await j('/api/payments/plans')
const voice2 = (plans2.body?.addons || []).find((a) => a.id === 'voice_doubts')
ok('admin-tunable addon price works (49 -> 79)', Number(voice2?.price) === 79, `price=${voice2?.price}`)

// 7. Voice gate: still locked for this user (no voice_doubts addon) -> 402
// (multipart with a tiny audio blob so the request reaches the entitlement check)
const voicePost = (token) => {
  const fd = new FormData()
  fd.append('file', new Blob([Buffer.alloc(3000, 1)], { type: 'audio/webm' }), 'doubt.webm')
  return fetch(base + '/api/ai/transcribe', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd })
}
const t0 = await voicePost(studentToken)
ok('voice transcribe blocked without addon (402)', t0.status === 402, `status=${t0.status}`)

// 8. Grant voice addon directly (admin) -> gate passes the entitlement check
await j('/api/payments/admin/activate', { method: 'POST', body: JSON.stringify({ email, days: 365 }) }, adminToken) // retention sanity (no-op for voice)
const { default: dbLive } = await import('../src/db.js')
await dbLive.prepare(`INSERT INTO user_addons (user_id, addon_id, expires_at, created_at)
  VALUES ((SELECT id FROM users WHERE email = ?), 'voice_doubts', to_char(now() + interval '365 days', 'YYYY-MM-DD HH24:MI:SS'), to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
  ON CONFLICT (user_id, addon_id) DO UPDATE SET expires_at = excluded.expires_at`).run(email)
const t1 = await voicePost(studentToken)
// With the addon, the request passes the paywall and fails later at Whisper (no key) = 502
ok('voice gate passes with addon (no longer 402)', t1.status !== 402, `status=${t1.status}`)

// 9. Cleanup temp user
const uid = (await dbLive.prepare('SELECT id FROM users WHERE email = ?').get(email))?.id
if (uid) {
  await dbLive.prepare('DELETE FROM user_addons WHERE user_id = ?').run(uid)
  await dbLive.prepare('DELETE FROM user_retention WHERE user_id = ?').run(uid)
  await dbLive.prepare('DELETE FROM payments WHERE user_id = ?').run(uid)
  await dbLive.prepare('DELETE FROM doubts WHERE user_id = ?').run(uid)
  await dbLive.prepare('DELETE FROM users WHERE id = ?').run(uid)
}
ok('temp user cleaned up', !(await dbLive.prepare('SELECT id FROM users WHERE email = ?').get(email)))

server.close()
const passed = results.filter(Boolean).length
console.log(`\n${passed}/${results.length} passed`)
process.exit(passed === results.length ? 0 : 1)
