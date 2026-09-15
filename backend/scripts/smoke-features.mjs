// Smoke test for the new feature-flag endpoints (voice doubts + Telegram bot).
// Boots the real app on in-memory Postgres (pg-mem), registers a user, then
// verifies: flags default off, telegram/link blocked when off, webhook responds.
import { newDb } from 'pg-mem'

process.env.DATABASE_URL ||= 'postgresql://smoke:smoke@127.0.0.1:1/smoke'

const mem = newDb({ autoCreateForeignKeyIndices: true })
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

const { default: app } = await import('../src/app.js')
await db.initSchema()

const results = []
const ok = (name, cond, extra = '') => { results.push(cond); console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`) }

const server = app.listen(0, '127.0.0.1')
await new Promise((r) => server.on('listening', r))
const base = `http://127.0.0.1:${server.address().port}`
const call = async (p, o = {}) => {
  const res = await fetch(base + p, {
    method: o.method || 'GET',
    headers: { ...(o.body ? { 'Content-Type': 'application/json' } : {}), ...(o.token ? { Authorization: `Bearer ${o.token}` } : {}) },
    body: o.body ? JSON.stringify(o.body) : undefined
  })
  let d = {}; try { d = await res.json() } catch { /* empty */ }
  return { s: res.status, d }
}

try {
  const reg = await call('/api/auth/register', { method: 'POST', body: { name: 'Feat', email: `feat-${Date.now()}@t.local`, password: 'Test1234!' } })
  const tok = reg.d.token
  ok('register for feature test', Boolean(tok))

  const f = await call('/api/ai/features', { token: tok })
  ok('GET /ai/features returns flags', f.s === 200 && typeof f.d.voiceDoubts === 'boolean', JSON.stringify(f.d))

  const tl = await call('/api/ai/telegram/link', { token: tok })
  ok('telegram/link blocked while disabled (403)', tl.s === 403, `status=${tl.s}`)

  const wh = await call('/api/telegram/webhook', { method: 'POST', body: { message: { text: '/start', chat: { id: 999 } } } })
  ok('telegram webhook unsigned → 401 (fail-closed anti-spoof)', wh.s === 401, `status=${wh.s}`)

  // Enable flags directly in DB, then re-check (simulates admin saving config)
  await db.prepare(`INSERT INTO ai_configs (key, value) VALUES ('features.telegramBot','true'),('telegram.botToken','123:fake'),('features.voiceDoubts','false')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run()
  const tl2 = await call('/api/ai/telegram/link', { token: tok })
  ok('telegram/link works once enabled (returns code)', tl2.s === 200 && /^[0-9A-F]{8}$/.test(tl2.d.code || ''), `status=${tl2.s} code=${tl2.d.code || '-'}`)

  const f2 = await call('/api/ai/features', { token: tok })
  ok('flag flips after admin enables + token set', f2.d.telegramBot === true && f2.d.voiceDoubts === false, JSON.stringify(f2.d))
} catch (e) {
  console.error('SMOKE ERROR:', e.message)
  results.push(false)
} finally {
  server.close()
  process.exit(results.every(Boolean) ? 0 : 1)
}
