// Full live smoke test: boots the real Express app against an in-memory
// Postgres (pg-mem), then exercises the complete auth + AI + rate-limit flow:
//   health -> register -> me -> wrong pw -> login -> duplicate -> ai/doubt ->
//   auth rate limiter (429) -> cleanup
// No DATABASE_URL needed; no secrets printed; temp user deleted at the end.
import { newDb } from 'pg-mem'

// db.js refuses to init without a connection string; the in-memory pool below
// handles every query, so a placeholder is enough for the guard to pass.
process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke'

const { default: dbReal, pool: poolReal } = await import('../src/db.js')

// ---------------------------------------------------------------------------
// Build an in-memory pg Pool and swap it into the db module before anything
// queries it. db.js exposes prepare()/exec()/initSchema bound to `pool`.
// ---------------------------------------------------------------------------
const mem = newDb({ autoCreateForeignKeyIndices: true })

// Register the Postgres natives the schema relies on that pg-mem lacks.
// The schema uses `to_char(now(), 'YYYY-MM-DD HH24:MI:SS')` for text timestamps.
const pad = (n) => String(n).padStart(2, '0')
const fmtTs = (v) => {
  const d = v instanceof Date ? v : new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}
for (const t of ['timestamptz', 'timestamp']) {
  mem.public.registerFunction({ name: 'to_char', args: [t, 'text'], returns: 'text', implementation: fmtTs })
}

const { Pool } = mem.adapters.createPg()

// pg-mem speaks Postgres; our query layer translates SQLite-isms already.
const pool = new Pool()

function swapPool(mod) {
  // db.js default export holds closures over `pool`; patch the Pool prototype
  // instances via reassigning the module-level binding is not possible —
  // instead we replace the query method on the real pool with a delegate.
  const realPool = poolReal
  realPool.query = (opts, vals) => pool.query(opts, vals)
  realPool.connect = async () => {
    const c = await pool.connect()
    const wrap = {
      query: (q, v) => c.query(q, v),
      release: () => c.release()
    }
    return wrap
  }
  return realPool
}

// Wait — db.js closes over its own `pool` variable inside prepare(); we must
// instead patch pg.Pool.prototype methods used by that instance. Simplest
// reliable hook: replace the client query path by monkey-patching Pool proto
// before any instance exists in this process (db.js already created one).
const origConnect = poolReal.constructor.prototype.connect
poolReal.constructor.prototype.connect = async function () {
  const client = await pool.connect()
  const origQuery = client.query.bind(client)
  client.query = (q, v) => origQuery(typeof q === 'string' ? { text: q, values: v } : q, v)
  return client
}

// Same for direct pool.query calls
const origPoolQuery = poolReal.constructor.prototype.query
if (origPoolQuery) {
  poolReal.constructor.prototype.query = function (q, v) {
    return pool.query(q, v)
  }
}

const app = (await import('../src/app.js')).default

const EMAIL = `smoke-${Date.now()}@test.local`
const PASSWORD = 'SmokeTest123!'
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

try {
  await dbReal.initSchema()
  console.log('[smoke] in-memory Postgres schema ready')

  // 0. health
  const health = await call('/api/health')
  ok('health endpoint', health.status === 200, `status=${health.status} storage=${health.data?.storage?.mode} cache=${health.data?.cache?.mode}`)

  // 1. register
  const reg = await call('/api/auth/register', { method: 'Post'.toLowerCase(), body: { name: 'Smoke Test', email: EMAIL, password: PASSWORD, target_exam: 'JEE Main' } })
  ok('register returns 201 + token', reg.status === 201 && reg.data?.token, `status=${reg.status} err=${reg.data?.error || '-'}`)
  const token = reg.data?.token

  // 2. me
  const me = await call('/api/auth/me', { token })
  ok('me returns the user', me.status === 200 && me.data?.user?.email === EMAIL, `email=${me.data?.user?.email || '-'}`)

  // 3. wrong password rejected
  const bad = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: 'wrong-password' } })
  ok('wrong password rejected (401)', bad.status === 401, `status=${bad.status}`)

  // 4. login
  const login = await call('/api/auth/login', { method: 'POST', body: { email: EMAIL, password: PASSWORD } })
  ok('login works', login.status === 200 && Boolean(login.data?.token), `status=${login.status}`)

  // 5. duplicate rejected
  const dup = await call('/api/auth/register', { method: 'POST', body: { name: 'Smoke Test', email: EMAIL, password: PASSWORD } })
  ok('duplicate email rejected (409)', dup.status === 409, `status=${dup.status}`)

  // 6. AI route wired (502 without keys is correct; 429 would mean limiter too tight)
  const ai = await call('/api/ai/doubt', { method: 'POST', token, body: { message: 'ping', questionText: 'What is 2+2?' } })
  ok('ai/doubt route responds', [200, 502].includes(ai.status), `status=${ai.status} err=${(ai.data?.error || '-').slice(0, 60)}`)

  // 7. auth rate limiter (15 / 15 min default)
  let got429 = false
  for (let i = 0; i < 20; i++) {
    const r = await call('/api/auth/login', { method: 'POST', body: { email: 'nobody@ratelimit.test', password: 'x' } })
    if (r.status === 429) { got429 = true; break }
  }
  ok('auth rate limiter returns 429', got429)

  // 8. cleanup temp user
  await dbReal.prepare('DELETE FROM users WHERE email = ?').run(EMAIL)
  const gone = await dbReal.prepare('SELECT id FROM users WHERE email = ?').get(EMAIL)
  ok('temp user cleaned up', !gone)
} catch (e) {
  console.error('SMOKE ERROR:', e.message)
  results.push({ name: 'no crash', pass: false, extra: e.message })
} finally {
  process.exit(results.every((r) => r.pass) ? 0 : 1)
}
