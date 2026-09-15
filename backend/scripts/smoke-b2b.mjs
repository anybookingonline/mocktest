// B2B security audit suite — privilege separation, data isolation, invite
// lifecycle. Boots the real Express app on pg-mem (same harness as
// smoke-phase4). Never prints secret values.
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
  console.log('[smoke-b2b] schema ready')

  // ---------------- seed: exam tree for institute-wide weak-topics ----------
  const ex = await dbReal.prepare(`INSERT INTO exams (code, name) VALUES ('B2B', 'B2B Exam') RETURNING id`).run()
  const examId = Number(ex.lastInsertRowid)
  const su = await dbReal.prepare(`INSERT INTO subjects (exam_id, name) VALUES (?, 'Maths') RETURNING id`).run(examId)
  const ch = await dbReal.prepare(`INSERT INTO chapters (subject_id, exam_id, name) VALUES (?, ?, 'Algebra') RETURNING id`).run(Number(su.lastInsertRowid), examId)
  const tp = await dbReal.prepare(`INSERT INTO topics (chapter_id, exam_id, name) VALUES (?, ?, 'Quadratics') RETURNING id`).run(Number(ch.lastInsertRowid), examId)

  // ---------------- 1. platform admin boots the whole flow ------------------
  const reg = await call('/api/auth/register', { method: 'POST', body: ADMIN })
  if (reg.status !== 201) { console.error('[smoke-b2b] admin register failed', reg.status, JSON.stringify(reg.data).slice(0, 300)); process.exit(1) }
  await dbReal.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(reg.data.user.id)
  const adminTok = reg.data.token
  ok('platform admin registered (no institute)', Boolean(adminTok) && reg.data.user?.institute_id == null)

  // ---------------- 2. institute lifecycle -----------------------------------
  const inst = await call('/api/institutes/admin/institutes', { method: 'POST', token: adminTok, body: { name: 'Sunrise Academy', kind: 'coaching', contactEmail: 'owner@sunrise.test' } })
  ok('create institute (trial, 30d)', inst.status === 201 && Boolean(inst.data?.instituteId) && /^[A-Z]+-/.test(inst.data.code || ''), `code=${inst.data?.code}`)
  const instId = inst.data.instituteId

  const upd = await call(`/api/institutes/admin/institutes/${instId}`, { method: 'PUT', token: adminTok, body: { name: 'Sunrise Academy Prime' } })
  ok('platform admin updates institute', upd.status === 200 && upd.data?.name === 'Sunrise Academy Prime', `status=${upd.status}`)

  // ---------------- 3. invite lifecycle -------------------------------------
  const inv = await call(`/api/institutes/admin/institutes/${instId}/invites`, { method: 'POST', token: adminTok, body: { label: 'Batch A', maxUses: 2 } })
  ok('invite created with cap', inv.status === 201 && /^SCH-/.test(inv.data.code || ''), `code=${inv.data.code}`)
  const code = inv.data.code

  const chk1 = await call(`/api/institutes/public/invite?code=${code}`)
  ok('public invite check valid', chk1.status === 200 && chk1.data.valid === true)

  const s1 = await call('/api/auth/register', { method: 'POST', body: { name: 'Cap One', email: `cap1-${stamp}@t.local`, password: 'StuPass1!', inviteCode: code } })
  const s2 = await call('/api/auth/register', { method: 'POST', body: { name: 'Cap Two', email: `cap2-${stamp}@t.local`, password: 'StuPass2!', inviteCode: code } })
  ok('invite cap: both students linked', s1.status === 201 && s1.data.user?.institute_id === instId && s2.status === 201 && s2.data.user?.institute_id === instId, `cap1=${s1.status} cap2=${s2.status}`)

  const s3 = await call('/api/auth/register', { method: 'POST', body: { name: 'Cap Three', email: `cap3-${stamp}@t.local`, password: 'StuPass3!', inviteCode: code } })
  ok('invite exhausted → rejected', s3.status === 400, `status=${s3.status}`)

  const chk2 = await call(`/api/institutes/public/invite?code=${code}`)
  ok('exhausted invite reports invalid', chk2.status === 200 && chk2.data.valid === false)

  const usedRow = await dbReal.prepare('SELECT used_count, max_uses FROM institute_invites WHERE code = ?').get(code)
  ok('invite used_count == 2 after cap', Number(usedRow?.used_count) === 2 && Number(usedRow?.max_uses) === 2, `used=${usedRow?.used_count}`)

  const inv2 = await call(`/api/institutes/admin/institutes/${instId}/invites`, { method: 'POST', token: adminTok, body: { label: 'Batch B' } })
  const tgl = await call(`/api/institutes/admin/institutes/${instId}/invites/${inv2.data.inviteId}/toggle`, { method: 'POST', token: adminTok, body: { active: false } })
  ok('platform admin pauses invite', tgl.status === 200, `status=${tgl.status}`)
  const chk3 = await call(`/api/institutes/public/invite?code=${inv2.data.code}`)
  ok('paused invite invalid for students', chk3.data.valid === false)

  // rival institute + invite (used for cross-tenant tests)
  const other = await call('/api/institutes/admin/institutes', { method: 'POST', token: adminTok, body: { name: 'Rival Coaching', kind: 'coaching' } })
  const otherInstId = other.data.instituteId
  const otherInv = await call(`/api/institutes/admin/institutes/${otherInstId}/invites`, { method: 'POST', token: adminTok, body: { label: 'Rival batch' } })
  ok('second institute + invite created', other.status === 201 && /^SCH-/.test(otherInv.data.code || ''), `code=${otherInv.data.code}`)

  // ---------------- 4. sub-admin lifecycle ----------------------------------
  const sub = await call(`/api/institutes/admin/institutes/${instId}/subadmin`, { method: 'POST', token: adminTok, body: { name: 'Sub Admin', email: `sub-${stamp}@t.local`, password: 'SubPass1!' } })
  ok('sub-admin created', sub.status === 201 && Boolean(sub.data?.userId), `status=${sub.status}`)
  const subLogin = await call('/api/auth/login', { method: 'POST', body: { email: `sub-${stamp}@t.local`, password: 'SubPass1!' } })
  const subTok = subLogin.data.token
  ok('sub-admin can log in', subLogin.status === 200 && Boolean(subTok))

  // ---------------- 5. PRIVILEGE ESCALATION GUARDS (core of this audit) -----
  const forb = async (name, path, { method = 'GET', body } = {}) => {
    const r = await call(path, { method, body, token: subTok })
    ok(name, r.status === 403, `got ${r.status}`)
    return r
  }
  await forb('sub-admin BLOCKED from platform users list', '/api/admin/users')
  await forb('sub-admin BLOCKED from platform stats', '/api/admin/stats')
  // provider-status is student-facing by design (Tests.jsx uses it) — verify it
  // exposes only booleans, never key material.
  const prov = await call('/api/ai/provider-status', { token: subTok })
  const leaks = prov.data && Object.keys(prov.data).some((k) => /key|secret|token/i.test(k))
  ok('AI provider-status exposes booleans only (no key material)', prov.status === 200 && !leaks, `keys=${Object.keys(prov.data || {}).join(',')}`)
  await forb('sub-admin BLOCKED from AI config write', '/api/ai/config', { method: 'POST', body: { 'ai.provider': 'deepseek' } })
  await forb('sub-admin BLOCKED from platform payments', '/api/payments/admin/status')
  await forb('sub-admin BLOCKED from settings write', '/api/admin/settings', { method: 'PUT', body: { 'platform.name': 'Hacked' } })
  await forb('sub-admin BLOCKED from exam creation', '/api/exams', { method: 'POST', body: { code: 'HAX', name: 'Hax' } })
  await forb('sub-admin BLOCKED from telegram setup', '/api/telegram/admin/setup', { method: 'POST', body: { botToken: 'x' } })
  const unauth = await call('/api/admin/users')
  ok('unauthenticated admin endpoints → 401', unauth.status === 401, `got ${unauth.status}`)

  // ---------------- 6. sub-admin self-serve scope ----------------------------
  const me1 = await call('/api/institutes/me', { token: subTok })
  ok('sub-admin sees own institute', me1.status === 200 && me1.data.institute?.id === instId, `inst=${me1.data.institute?.id}`)

  const rivalStudent = await call('/api/auth/register', { method: 'POST', body: { name: 'Rival Stu', email: `rival-${stamp}@t.local`, password: 'StuPassR!', inviteCode: otherInv.data.code } })
  ok('rival institute student registered', rivalStudent.status === 201 && rivalStudent.data.user?.institute_id === otherInstId)

  const stuList = await call('/api/institutes/me/students', { token: subTok })
  ok('student list hard-scoped (no rival students)', stuList.status === 200 && !stuList.data.students?.some((s) => s.email.startsWith('rival-')))

  const st1 = await call('/api/institutes/me/stats', { token: subTok })
  ok('institute stats scoped (sees own 2 students)', st1.status === 200 && st1.data.students >= 2 && st1.data.students < 4, `students=${st1.data?.students}`)

  const brand = await call('/api/institutes/me/branding', { method: 'PUT', token: subTok, body: { platform_name: 'Sunrise Test Prep', plan: 'lifetime', status: 'banned', custom_domain: 'aisepadho.com' } })
  ok('branding save ignores plan/status/domain', brand.status === 200 && brand.data?.plan !== 'lifetime' && brand.data?.status !== 'banned' && !brand.data?.custom_domain, `plan=${brand.data?.plan} domain=${brand.data?.custom_domain}`)

  const myInv = await call('/api/institutes/me/invites', { method: 'POST', token: subTok, body: { label: 'My batch' } })
  ok('sub-admin creates own invite', myInv.status === 201 && /^SCH-/.test(myInv.data.code || ''))

  const tglOther = await call(`/api/institutes/me/invites/${otherInv.data.inviteId}/toggle`, { method: 'POST', token: subTok, body: { active: false } })
  const rivalInvite = await dbReal.prepare('SELECT is_active FROM institute_invites WHERE id = ?').get(otherInv.data.inviteId)
  ok('cross-tenant invite toggle blocked (404 or still active)',
    tglOther.status === 404 || Number(rivalInvite?.is_active) === 1,
    `status=${tglOther.status} active=${rivalInvite?.is_active}`)

  // ---------------- 7. bulk CSV + student visibility -------------------------
  const csv = `Name,Email,Password\nBulk One,bulk1-${stamp}@t.local,BulkPass1!\nBulk Two,bulk2-${stamp}@t.local,BulkPass2!\nnot-a-user-row\nbad@onlyemail\n`
  const bulk = await call('/api/institutes/me/students/bulk', { method: 'POST', token: subTok, body: { csv } })
  ok('bulk CSV creates students, skips bad rows', bulk.status === 200 && bulk.data.created === 2 && Array.isArray(bulk.data.skipped), `created=${bulk.data.created}`)

  const afterBulk = await call('/api/institutes/me/students', { token: subTok })
  ok('bulk students visible to own sub-admin', afterBulk.status === 200 && afterBulk.data.students.some((s) => s.email.startsWith(`bulk1-`)))

  const list = await call('/api/institutes/admin/institutes', { token: adminTok })
  ok('platform admin lists all institutes', list.status === 200 && list.data.institutes?.length >= 2, `count=${list.data.institutes?.length}`)

  const dom = await call('/api/institutes/public/branding')
  ok('public branding endpoint responds', dom.status === 200 && Boolean(dom.data.platformName))

  // ---------------- 8. summary ------------------------------------------------
  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED CHECKS:')
    failed.forEach((f) => console.log(' -', f.name))
    process.exit(1)
  }
} catch (e) {
  console.error('[smoke-b2b] fatal:', e.message)
  process.exit(1)
}
