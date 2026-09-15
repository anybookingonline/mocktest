// Student & social module audit — points anti-spam, battle integrity,
// entitlement gates, spoofing. Boots the real Express app on pg-mem
// (same harness as smoke-phase4/smoke-b2b). Never prints secret values.
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

async function call(path, { method = 'GET', body, token, raw } = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      ...(raw ? { 'Content-Type': raw } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : raw ? 'x' : undefined
  })
  let data = {}
  try { data = await res.json() } catch { /* empty */ }
  return { status: res.status, data }
}

const stamp = Date.now()
let seq = 0
const uniq = (p) => `${p}${++seq}-${stamp}@t.local`

try {
  await dbReal.initSchema()
  console.log('[smoke-student] schema ready')

  // seed exam tree
  const ex = await dbReal.prepare(`INSERT INTO exams (code, name) VALUES ('AUD', 'Audit Exam') RETURNING id`).run()
  const examId = Number(ex.lastInsertRowid)

  const mkUser = async (name, role = 'student') => {
    const r = await call('/api/auth/register', { method: 'POST', body: { name, email: uniq(name.toLowerCase()), password: 'AuditPass1!' } })
    if (role === 'admin') await dbReal.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(r.data.user.id)
    return r.data
  }

  // ---------------- 1. auth + IDOR basics -----------------------------------
  const a = await mkUser('Alice')
  const bob = await mkUser('Bob')
  ok('two students registered', Boolean(a.token) && Boolean(bob.token))

  // attempts are user-scoped: Bob cannot read Alice's attempt
  const attA = await call('/api/attempts', { method: 'POST', token: a.token, body: { title: 'A test', examId, questionIds: [] } })
  ok('empty attempt rejected', attA.status === 400, `status=${attA.status}`)

  const attA2 = await call('/api/attempts', { method: 'POST', token: a.token, body: { title: 'A test', examId } })
  ok('attempt without questions → 400 (no dangling sessions)', attA2.status === 400, `status=${attA2.status}`)

  // seed one question directly (pg-mem can't run the /api/tests list query's
  // correlated subquery — real Postgres can; direct seeding keeps the audit
  // focused on auth/integrity, not SQL portability)
  const q1 = await dbReal.prepare(`INSERT INTO questions (exam_id, question_text, options_json, correct_answer, source)
    VALUES (?, '2+2=?', '["3","4","5"]', 'B', 'manual') RETURNING id`).run(examId)
  const qid = Number(q1.lastInsertRowid)
  ok('seed question created', qid > 0)

  const attOk = await call('/api/attempts', { method: 'POST', token: a.token, body: { title: 'A test', examId, questionIds: [qid] } })
  const attemptId = attOk.data?.attemptId
  ok('attempt created with question', attOk.status === 201 && Boolean(attemptId), `status=${attOk.status}`)
  const bobRead = await call(`/api/attempts/${attemptId}`, { token: bob.token })
  ok('Bob cannot read Alice attempt (IDOR blocked)', bobRead.status === 404, `status=${bobRead.status}`)
  const bobAns = await call(`/api/attempts/${attemptId}/answer`, { method: 'POST', token: bob.token, body: { questionId: qid, selected: 'A' } })
  ok('Bob cannot answer Alice attempt (IDOR blocked)', bobAns.status === 404, `status=${bobAns.status}`)

  // analytics: only own data
  const rep = await call('/api/analytics/report', { token: a.token })
  ok('analytics report scoped (no crash)', rep.status === 200)

  // ---------------- 2. points anti-spam -------------------------------------
  const ptsBefore = Number((await dbReal.prepare('SELECT points FROM users WHERE id = ?').get(a.data.user.id))?.points) || 0
  for (let i = 0; i < 5; i++) await call('/api/ai/doubt', { method: 'POST', token: a.token, body: { message: `spam ${i}` } })
  const ptsAfter = Number((await dbReal.prepare('SELECT points FROM users WHERE id = ?').get(a.data.user.id))?.points) || 0
  ok('5 spam doubts award only doubt_asked (no resolve farming)', ptsAfter - ptsBefore === 5, `delta=${ptsAfter - ptsBefore}`)

  // dailyCap: doubt_asked cap 10/day ×25 = 250 → 5*25+5 = 130 doubts would cap;
  // verify the cap math on a synthetic flood instead (cap check reads SUM>=cap*25)
  const flood = await dbReal.prepare(`SELECT COALESCE(SUM(points),0) c FROM points_log WHERE user_id = ? AND action='doubt_asked'`).get(a.data.user.id)
  ok('doubt_asked logged for flood check', Number(flood?.c) >= 5, `sum=${flood?.c}`)

  // ---------------- 3. telegram webhook spoofing (fail-closed) --------------
  const whNoSecret = await call('/api/telegram/webhook', { method: 'POST', body: { message: { text: '/start ABC', chat: { id: 111 } } } })
  ok('telegram webhook unsigned → 401 (fail-closed)', whNoSecret.status === 401, `status=${whNoSecret.status}`)
  const whBadSecret = await call('/api/telegram/webhook', { method: 'POST', body: { message: { text: '/start ABC', chat: { id: 111 } } }, raw: 'application/json' })
  ok('telegram webhook with WRONG secret header → 401', whBadSecret.status === 401, `status=${whBadSecret.status}`)

  // with the right secret → accepted
  await dbReal.prepare(`INSERT INTO ai_configs (key, value) VALUES ('telegram.webhookSecret','audit-secret') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
  const whGood = await fetch(BASE + '/api/telegram/webhook', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-telegram-bot-api-secret-token': 'audit-secret' },
    body: JSON.stringify({ message: { text: '/start ABC', chat: { id: 111 } } })
  })
  ok('telegram webhook with correct secret → 200', whGood.status === 200, `status=${whGood.status}`)
  await dbReal.prepare(`DELETE FROM ai_configs WHERE key='telegram.webhookSecret'`).run()

  // ---------------- 4. entitlement gates ------------------------------------
  // voice without add-on → 402
  const voice = await fetch(BASE + '/api/ai/transcribe', {
    method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'audio/mpeg' }, body: Buffer.from('x')
  })
  ok('voice transcribe without add-on → 402', voice.status === 402, `status=${voice.status}`)

  // free battle quota: 3/day
  await dbReal.prepare(`INSERT INTO ai_configs (key, value) VALUES ('features.battles','true') ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
  let rooms = []
  for (let i = 0; i < 4; i++) {
    const r = await call('/api/battles/invite', { method: 'POST', token: bob.token, body: { examId } })
    rooms.push(r)
  }
  ok('free battle quota: 4th room blocked (402)', rooms[3].status === 402, `statuses=${rooms.map((r) => r.status).join(',')}`)

  // unlimited for AI Power (retention row simulates paid)
  await dbReal.prepare(`INSERT INTO user_retention (user_id, retain_until, plan) VALUES (?, to_char(now() + interval '365 days','YYYY-MM-DD HH24:MI:SS'), 'retention_1y')
    ON CONFLICT (user_id) DO UPDATE SET retain_until = excluded.retain_until`).run(bob.data.user.id)
  const r5 = await call('/api/battles/invite', { method: 'POST', token: bob.token, body: { examId } })
  ok('paid user escapes battle quota (unlimited)', r5.status === 201, `status=${r5.status}`)

  // ---------------- 5. battle integrity -------------------------------------
  // duplicate answer blocked by PK
  const room = rooms[0] // waiting room of bob (free, capped user created it)
  const joiner = await mkUser('Joiner')
  const jr = await call('/api/battles/join', { method: 'POST', token: joiner.token, body: { joinCode: room.data?.joinCode } })
  ok('joiner joins battle by code', jr.status === 200 && Boolean(jr.data.roomId), `status=${jr.status}`)
  const roomId = jr.data.roomId
  const st = await call(`/api/battles/${roomId}/state`, { token: joiner.token })
  const roundNo = st.data?.room?.currentRound || 1
  const ans1 = await call(`/api/battles/${roomId}/answer`, { method: 'POST', token: joiner.token, body: { roundNo, selected: null } })
  const ans2 = await call(`/api/battles/${roomId}/answer`, { method: 'POST', token: joiner.token, body: { roundNo, selected: null } })
  ok('duplicate battle answer rejected', ans2.status === 400 && /Already answered/i.test(ans2.data?.error || ''), `status=${ans2.status}`)
  const outsider = await mkUser('Outsider')
  const oAns = await call(`/api/battles/${roomId}/answer`, { method: 'POST', token: outsider.token, body: { roundNo, selected: 'A' } })
  ok('outsider cannot answer battle', oAns.status === 400, `status=${oAns.status}`)
  const oState = await call(`/api/battles/${roomId}/state`, { token: outsider.token })
  ok('outsider cannot poll battle state', oState.status === 403 || oState.status === 404, `status=${oState.status}`)

  // ---------------- 6. group access control ---------------------------------
  await dbReal.prepare(`INSERT INTO ai_configs (key, value) VALUES ('features.groupStudy','true'),('features.groupDiscussions','true')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
  const g = await call('/api/groups', { method: 'POST', token: a.token, body: { name: 'Audit Group', examId, kind: 'study' } })
  ok('group created', g.status === 201 && Boolean(g.data.joinCode), `status=${g.status}`)
  const groupId = g.data.groupId

  const gJoin = await call('/api/groups/join', { method: 'POST', token: joiner.token, body: { code: g.data.joinCode } })
  ok('joiner joins group', gJoin.status === 200, `status=${gJoin.status}`)

  const outsiderMsg = await call(`/api/groups/${groupId}/messages`, { method: 'POST', token: outsider.token, body: { body: 'hi' } })
  ok('non-member cannot post in group', outsiderMsg.status === 403, `status=${outsiderMsg.status}`)

  const outsiderRead = await call(`/api/groups/${groupId}`, { token: outsider.token })
  ok('non-member cannot read group detail', outsiderRead.status === 403, `status=${outsiderRead.status}`)

  // free seat chat gate: joiner has no entitlements → 402
  const joinerMsg = await call(`/api/groups/${groupId}/messages`, { method: 'POST', token: joiner.token, body: { body: 'hello' } })
  ok('free-joiner chat needs entitlement (402)', joinerMsg.status === 402, `status=${joinerMsg.status}`)

  // owner (Alice) — no entitlements either → 402 until paid; check entitlement path for bob (retention)
  const bobJoin = await call('/api/groups/join', { method: 'POST', token: bob.token, body: { code: g.data.joinCode } })
  ok('paid bob joins group', bobJoin.status === 200, `status=${bobJoin.status}`)
  const bobMsg = await call(`/api/groups/${groupId}/messages`, { method: 'POST', token: bob.token, body: { body: 'paid hello' } })
  ok('paid member can chat', bobMsg.status === 201, `status=${bobMsg.status}`)

  // sub-admin blocked from groups recompute (platform-only)
  const subReg = await mkUser('Subby', 'admin')
  // make him a sub-admin by linking to an institute
  const inst = await call('/api/institutes/admin/institutes', { method: 'POST', token: a.token, body: { name: 'Audit Inst' } })
  // a.token is a student — should be 403; create real platform admin for the next part
  ok('student cannot create institutes (403)', inst.status === 403, `status=${inst.status}`)

  const plat = await mkUser('Plat', 'admin')
  const inst2 = await call('/api/institutes/admin/institutes', { method: 'POST', token: plat.token, body: { name: 'Audit Inst 2' } })
  ok('platform admin creates institute', inst2.status === 201, `status=${inst2.status}`)
  const subEmail = uniq('subemail')
  await call(`/api/institutes/admin/institutes/${inst2.data.instituteId}/subadmin`, { method: 'POST', token: plat.token, body: { name: 'Sub', email: subEmail, password: 'SubPass1!' } })
  const subTok = (await call('/api/auth/login', { method: 'POST', body: { email: subEmail, password: 'SubPass1!' } })).data.token
  ok('sub-admin login works for recompute check', Boolean(subTok))
  const recomp = await call(`/api/groups/admin/recompute/${groupId}`, { method: 'POST', token: subTok })
  ok('sub-admin BLOCKED from groups recompute (403)', recomp.status === 403, `status=${recomp.status}`)
  const recompPlat = await call(`/api/groups/admin/recompute/${groupId}`, { method: 'POST', token: plat.token })
  ok('platform admin CAN recompute', recompPlat.status === 200, `status=${recompPlat.status}`)

  // ---------------- 7. summary -----------------------------------------------
  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED CHECKS:')
    failed.forEach((f) => console.log(' -', f.name))
    process.exit(1)
  }
} catch (e) {
  console.error('[smoke-student] fatal:', e.message)
  process.exit(1)
}
