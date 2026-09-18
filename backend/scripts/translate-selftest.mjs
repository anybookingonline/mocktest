// Standalone harness: verifies the SQLite->PG translation layer handles the
// questions.js list-route pattern ($n placeholders built at runtime, values
// passed positionally) without touching a real database.
//
// Instead of fighting pg-pool's internal connect lifecycle, we import db.js
// and drive it through `transaction()`, which uses pool.connect() DIRECTLY —
// the one code path our stub controls completely. Every query inside the
// transaction callback goes through the same translate()->buildQuery() ->
// client.query() pipeline the app uses in production.
//
// Run: node scripts/translate-selftest.mjs

import pg from 'pg'

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://stub:stub@127.0.0.1:5/stub'
const captured = []

const stubConnect = async () => ({
  query: (q) => {
    captured.push(q)
    return Promise.resolve({ rows: [{ c: 7, id: 1 }], rowCount: 1 })
  },
  release: () => {}
})

const db = await import('../src/db.js')
db.pool.connect = stubConnect

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log('  ok -', name)
  else { failed++; console.log('  FAIL -', name, extra) }
}

// Final text must carry sequential $1..$k placeholders (Postgres format) with
// exactly as many values — the ORIGINAL bug was literal '?' / non-sequential
// $n reaching pg (bind mismatch -> /api/questions 500).
function placeholders(text) {
  return (text.match(/\$\d+/g) || []).map((s) => Number(s.slice(1)))
}
function checkSequential(name, q, extra = '') {
  const ph = placeholders(q.text)
  const okShape = ph.every((n, i) => n === i + 1) && ph.length === q.values.length
  check(name, okShape, `${extra} text=${q.text} values=${JSON.stringify(q.values)}`)
}

const withTx = (fn) => db.transaction(fn)

// 1) questions.js list-route pattern: hand-built $n, values positional
await withTx(async () => {
  const { prepare } = db
  const where = []
  const params = [99] // institute visibility param first
  where.push('institute_id IS NULL OR institute_id = $1')
  where.push(`exam_id = $${params.length + 1}`); params.push(Number('5'))
  where.push(`difficulty = $${params.length + 1}`); params.push('hard')
  const w = 'WHERE ' + where.join(' AND ')
  const totalRow = await prepare(`SELECT COUNT(*) c FROM questions ${w}`).get(...params)
  const rows = await prepare(`SELECT * FROM questions ${w} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`).all(...params, 30, 0)
  const q1 = captured[captured.length - 2]
  const q2 = captured[captured.length - 1]
  checkSequential('count query: sequential $n + value count matches', q1)
  check('count binds in $n order', JSON.stringify(q1.values) === '[99,5,"hard"]', JSON.stringify(q1.values))
  checkSequential('list query: sequential $n + value count matches', q2)
  check('list binds limit/offset last', q2.values[3] === 30 && q2.values[4] === 0, JSON.stringify(q2.values))
  check('count returned', totalRow?.c === 7)
  check('list returned', rows.length === 1)
})

// 2) classic '?' style still works (sequential)
await withTx(async () => {
  const { prepare } = db
  await prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(3, 'admin')
  const q = captured[captured.length - 1]
  check('? style unchanged', q.text === 'SELECT * FROM users WHERE id = $1 AND role = $2' && q.values[0] === 3 && q.values[1] === 'admin', JSON.stringify(q))
})

// 3) mixed: $2 before $1 must bind by original $n order (regression guard)
await withTx(async () => {
  const { prepare } = db
  await prepare('SELECT * FROM t WHERE a = $2 AND b = $1').all('first', 'second')
  const q = captured[captured.length - 1]
  // a=$2 -> 'second', b=$1 -> 'first' — renumbered text must keep that mapping
  check('out-of-order $n binds by position', q.text.includes('a = $1 AND b = $2') && q.values[0] === 'second' && q.values[1] === 'first', JSON.stringify(q))
})

// 4) SQLite idioms still translate
await withTx(async () => {
  const { prepare } = db
  await prepare("UPDATE x SET updated_at = datetime('now') WHERE id = ?").run(9)
  const q = captured[captured.length - 1]
  check("datetime('now') -> now()", q.text.includes('now()') && !q.text.includes('datetime('), q.text)
})

if (failed) { console.log(`\n${failed} check(s) FAILED`); process.exit(1) }
console.log('\nAll translation self-tests passed.')
process.exit(0)
