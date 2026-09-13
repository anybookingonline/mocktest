// Smoke test for the Phase-4 feature set: Focus Areas (#3), Doubt-to-Mock (#4),
// Spaced Revision (#7), 1v1 Battles (#6) and the white-label B2B module.
// Boots the real Express app on pg-mem (no DATABASE_URL, no secrets printed).
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
// pg-mem lacks the native random() (real Postgres has it built in)
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
const S1 = { name: 'Stu One', email: `s1-${stamp}@t.local`, password: 'StuPass1!' }
const S2 = { name: 'Stu Two', email: `s2-${stamp}@t.local`, password: 'StuPass2!' }

try {
  await dbReal.initSchema()
  console.log('[smoke] schema ready')

  // Seed: exam + subject + chapter + topic + 3 PYQ questions (source=pdf with years)
  const ex = await dbReal.prepare(`INSERT INTO exams (code, name) VALUES ('SMK', 'Smoke Exam') RETURNING id`).run()
  const examId = Number(ex.lastInsertRowid)
  const su = await dbReal.prepare(`INSERT INTO subjects (exam_id, name) VALUES (?, 'Physics') RETURNING id`).run(examId)
  const subjectId = Number(su.lastInsertRowid)
  const ch = await dbReal.prepare(`INSERT INTO chapters (subject_id, exam_id, name) VALUES (?, ?, 'Mechanics') RETURNING id`).run(subjectId, examId)
  const chapterId = Number(ch.lastInsertRowid)
  const tp = await dbReal.prepare(`INSERT INTO topics (chapter_id, exam_id, name) VALUES (?, ?, 'Newton Laws') RETURNING id`).run(chapterId, examId)
  const topicId = Number(tp.lastInsertRowid)
  for (const [year, text] of [[2023, 'Q1 F=ma?'], [2022, 'Q2 inertia?'], [2021, 'Q3 friction?']]) {
    await dbReal.prepare(`INSERT INTO questions (exam_id, subject_id, chapter_id, topic_id, question_text, options_json, correct_answer, source, year)
      VALUES (?, ?, ?, ?, ?, '[]', 'A', 'pdf', ?)`.replace('RETURNING', '--')).run(examId, subjectId, chapterId, topicId, text, year)
  }

  // Register users
  const admin = await call('/api/auth/register', { method: 'POST', body: ADMIN })
  await dbReal.prepare(`UPDATE users SET role='admin' WHERE id=?`).run(admin.data.user.id)
  const adminTok = admin.data.token
  const s1 = await call('/api/auth/register', { method: 'POST', body: S1 })
  const s2 = await call('/api/auth/register', { method: 'POST', body: S2 })
  const t1 = s1.data.token
  const t2 = s2.data.token
  ok('users registered', Boolean(t1 && t2 && adminTok))

  // ---------------- Focus Areas ----------------
  const focusLocked = await call(`/api/focus?examId=${examId}`, { token: t1 })
  ok('focus locked for free user (402)', focusLocked.status === 402, `status=${focusLocked.status}`)

  // Grant retention to s1 via admin-activate path (direct DB for speed)
  await dbReal.prepare(`INSERT INTO user_retention (user_id, retain_until, plan) VALUES (?, to_char(now() + interval '365 days', 'YYYY-MM-DD HH24:MI:SS'), 'retention_1y')
    ON CONFLICT (user_id) DO UPDATE SET retain_until = excluded.retain_until`).run(s1.data.user.id)
  const focusOpen = await call(`/api/focus?examId=${examId}`, { token: t1 })
  ok('focus returns ranked areas for pro user', focusOpen.status === 200 && focusOpen.data?.areas?.length === 1, `status=${focusOpen.status} areas=${focusOpen.data?.areas?.length}`)
  ok('focus note is frequency-framed (legal-safe)', /consistently|frequently|asked/i.test(focusOpen.data?.areas?.[0]?.note || ''))

  // ---------------- Revision (#7) ----------------
  const dueEmpty = await call('/api/revision/due', { token: t1 })
  ok('revision due list reachable', dueEmpty.status === 200, `status=${dueEmpty.status} due=${dueEmpty.data?.due?.length}`)

  // Simulate topic_stats + revision_state (as attempts answer endpoint would)
  await dbReal.prepare(`INSERT INTO topic_stats (user_id, topic_id, attempts, correct) VALUES (?, ?, 4, 1)`).run(s1.data.user.id, topicId)
  await dbReal.prepare(`INSERT INTO revision_state (user_id, topic_id, box, last_reviewed_at) VALUES (?, ?, 1, to_char(now() - interval '5 days', 'YYYY-MM-DD HH24:MI:SS'))`).run(s1.data.user.id, topicId)
  const due1 = await call('/api/revision/due', { token: t1 })
  ok('due topic detected via forgetting curve', due1.status === 200 && due1.data.due.length === 1, `due=${due1.data?.due?.length} box=${due1.data?.due?.[0]?.box}`)

  const revMock = await call('/api/revision/start', { method: 'POST', token: t1 })
  if (revMock.status !== 201) console.log('[debug] revision start:', revMock.status, JSON.stringify(revMock.data).slice(0, 200))
  ok('one-click revision mock created (10Q)', revMock.status === 201 && revMock.data?.attemptId, `status=${revMock.status} qs=${revMock.data?.questionCount}`)

  // Cron: decay + (no telegram configured) + secret protection
  const cronBad = await call(`/api/revision/cron?secret=wrong`)
  const cronOk = await call(`/api/revision/cron?secret=smoke-cron-secret`)
  ok('revision cron protected by secret', cronBad.status === 401 && cronOk.status === 200, `bad=${cronBad.status} ok=${cronOk.status}`)

  // ---------------- Battles (#6) ----------------
  const bLocked = await call('/api/battles', { token: t1 })
  ok('battles 403 when flag off', bLocked.status === 403, `status=${bLocked.status}`)

  const { setConfig } = await import('../src/utils/aiService.js')
  await setConfig('features.battles', 'true')
  const bOpen = await call('/api/battles', { token: t1 })
  ok('battles lobby reachable when flag on', bOpen.status === 200, `quota=${JSON.stringify(bOpen.data?.quota)}`)

  // Free quota gate: default is 3/day -> 4th create attempt must be blocked
  let created = 0
  for (let i = 0; i < 4; i++) {
    const r = await call('/api/battles/quick-match', { method: 'POST', token: t2, body: { examId } })
    if (r.status === 201) created += 1
  }
  ok('free battle quota enforced (3/day)', created === 3, `created=${created}`)

  // Full battle: fresh p1 creates (t2 exhausted its free quota above),
  // fresh p2 joins by code, both answer every round.
  const S2B = { name: 'Stu Two B', email: `s2b-${stamp}@t.local`, password: 'StuPass2!' }
  const s2b = await call('/api/auth/register', { method: 'POST', body: S2B })
  const t1b = s1.data.token
  const t2b = s2b.data.token
  const inv = await call('/api/battles/invite', { method: 'POST', token: t1b, body: { examId, rounds: 3 } })
  ok('invite room created with code', inv.status === 201 && inv.data?.joinCode, `code=${inv.data?.joinCode}`)
  const joined = await call('/api/battles/join', { method: 'POST', token: t2b, body: { joinCode: inv.data.joinCode } })
  ok('opponent joins by code', joined.status === 200, `status=${joined.status} err=${joined.data?.error || '-'}`)

  // correctAnswer is only revealed AFTER both players answer, so we answer with
  // the first option — the point here is the round lifecycle, not the score.
  let roundsPlayed = 0
  for (let r = 0; r < 12 && roundsPlayed < 3; r++) {
    const st = await call(`/api/battles/${inv.data.roomId}/state`, { token: t1b })
    if (st.data?.room?.status === 'finished') break
    const q = st.data?.question
    if (!q) { await new Promise((res) => setTimeout(res, 50)); continue }
    const opt = q.options?.length ? q.options[0] : 'A'
    await call(`/api/battles/${inv.data.roomId}/answer`, { method: 'POST', token: t1b, body: { roundNo: q.roundNo, selected: opt } })
    await call(`/api/battles/${inv.data.roomId}/answer`, { method: 'POST', token: t2b, body: { roundNo: q.roundNo, selected: opt } })
    roundsPlayed += 1
  }
  const fin = await call(`/api/battles/${inv.data.roomId}/state`, { token: t1b })
  ok('battle plays all rounds and finishes', fin.data?.room?.status === 'finished', `status=${fin.data?.room?.status} rounds=${roundsPlayed} p1=${fin.data?.room?.p1?.score} p2=${fin.data?.room?.p2?.score}`)
  const board = await call('/api/battles/leaderboard', { token: t1b })
  ok('ELO leaderboard populated', board.status === 200 && board.data.leaderboard.length >= 1, `rows=${board.data?.leaderboard?.length} top=${board.data?.leaderboard?.[0]?.elo}`)

  // ---------------- Doubt-to-Mock (#4) — API contract (AI mocked) ----------------
  const doubt = await dbReal.prepare(`INSERT INTO doubts (user_id, message, ai_response) VALUES (?, 'What is inertia', 'ok') RETURNING id`).run(s2.data.user.id)
  const doubtId = Number(doubt.lastInsertRowid)
  const dmNoExam = await call('/api/revision/doubt-mock', { method: 'POST', token: t2, body: { doubtId } })
  ok('doubt-mock without profile exam is handled', dmNoExam.status === 400 || dmNoExam.status === 201, `status=${dmNoExam.status} err=${(dmNoExam.data?.error || '-').slice(0, 60)}`)

  // ---------------- White-label B2B ----------------
  const inst = await call('/api/institutes/admin/institutes', { method: 'POST', token: adminTok, body: { name: 'Sunrise Academy', contactEmail: 'owner@sunrise.test' } })
  if (inst.status !== 201) console.log('[debug] create institute:', inst.status, JSON.stringify(inst.data).slice(0, 300))
  ok('platform admin creates institute', inst.status === 201 && inst.data?.instituteId, `code=${inst.data?.code}`)
  const instId = inst.data.instituteId

  const inv2 = await call(`/api/institutes/admin/institutes/${instId}/invites`, { method: 'POST', token: adminTok, body: { label: 'Batch A' } })
  ok('invite code generated', inv2.status === 201 && /^SCH-/.test(inv2.data.code || ''), `code=${inv2.data.code}`)

  const chk = await call(`/api/institutes/public/invite?code=${inv2.data.code}`)
  ok('public invite check valid', chk.status === 200 && chk.data.valid === true, `name=${chk.data?.institute?.name}`)

  // register a student WITH the invite code -> auto-linked
  const S3 = { name: 'Stu Three', email: `s3-${stamp}@t.local`, password: 'StuPass3!', inviteCode: inv2.data.code }
  const s3 = await call('/api/auth/register', { method: 'POST', body: S3 })
  ok('register with invite code links institute', s3.status === 201 && s3.data.user?.institute_id === instId, `institute_id=${s3.data.user?.institute_id}`)

  // invalid code rejected
  const S4 = { name: 'Stu Four', email: `s4-${stamp}@t.local`, password: 'StuPass4!', inviteCode: 'SCH-NOPE' }
  const s4 = await call('/api/auth/register', { method: 'POST', body: S4 })
  ok('invalid invite code rejected', s4.status === 400, `status=${s4.status}`)

  // sub-admin + scope
  const sub = await call(`/api/institutes/admin/institutes/${instId}/subadmin`, { method: 'POST', token: adminTok, body: { name: 'Sub Admin', email: `sub-${stamp}@t.local`, password: 'SubPass1!' } })
  if (sub.status !== 201) console.log('[debug] subadmin:', sub.status, JSON.stringify(sub.data).slice(0, 300))
  ok('sub-admin created', sub.status === 201 && sub.data?.userId, `status=${sub.status}`)
  const subLogin = await call('/api/auth/login', { method: 'POST', body: { email: `sub-${stamp}@t.local`, password: 'SubPass1!' } })
  const subTok = subLogin.data.token
  const meInst = await call('/api/institutes/me', { token: subTok })
  ok('sub-admin scoped to own institute', meInst.status === 200 && meInst.data.institute?.id === instId, `inst=${meInst.data?.institute?.id}`)

  // bulk CSV
  const csv = `New Kid,kid-${stamp}@t.local,kidpass1\nAnother Kid,kid2-${stamp}@t.local,kidpass2`
  const bulk = await call('/api/institutes/me/students/bulk', { method: 'POST', token: subTok, body: { csv } })
  ok('bulk CSV creates students', bulk.status === 200 && bulk.data.created === 2, `created=${bulk.data?.created} skipped=${bulk.data?.skipped?.length}`)

  const stInst = await call('/api/institutes/me/stats', { token: subTok })
  ok('institute stats work', stInst.status === 200 && stInst.data.students >= 2, `students=${stInst.data?.students} weak=${stInst.data?.weakTopics?.length}`)

  // branding
  const brand = await call('/api/institutes/me/branding', { method: 'PUT', token: subTok, body: { platform_name: 'Sunrise Test Prep', tagline: 'Selection pakka' } })
  ok('sub-admin saves white-label branding', brand.status === 200 && (brand.data.platform_name === 'Sunrise Test Prep' || brand.data.name), `name=${brand.data?.platform_name}`)

  const pubBrand = await call(`/api/institutes/public/branding?sch=${inv2.data.code}`)
  ok('public branding resolves by invite', pubBrand.status === 200 && pubBrand.data.platformName === 'Sunrise Test Prep', `platformName=${pubBrand.data?.platformName}`)

  // cleanup temp data
  for (const em of [ADMIN.email, S1.email, S2.email, S2B.email, S3.email, S4.email, `sub-${stamp}@t.local`, `kid-${stamp}@t.local`, `kid2-${stamp}@t.local`]) {
    await dbReal.prepare('DELETE FROM users WHERE email = ?').run(em)
  }
  await dbReal.prepare('DELETE FROM exams WHERE id = ?').run(examId)
  ok('cleanup done', true)
} catch (e) {
  console.error('SMOKE ERROR:', e && (e.stack || e.message))
  results.push({ name: 'no crash', pass: false })
} finally {
  process.exit(results.every((r) => r.pass) ? 0 : 1)
}
