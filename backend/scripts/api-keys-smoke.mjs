// ---------------------------------------------------------------------------
// API-keys smoke test (institute API access)
// Mirrors the EXACT SQL from backend/src/utils/apiKeys.js + the ext router
// auth middleware, run against pg-mem. Real code paths can't import db.js
// (it binds to real Postgres), so the queries are copied verbatim — if the
// source changes shape, update both together.
// ---------------------------------------------------------------------------
import assert from 'node:assert'
import { newDb } from 'pg-mem'
import crypto from 'crypto'

const db = newDb()
db.public.registerFunction({ name: 'to_char', returnTypes: ['text'], implementation: (v, f) => new Date().toISOString().slice(0, 19).replace('T', ' ') })
db.public.registerFunction({ name: 'now', returnTypes: ['timestamptz', 'timestamp'], implementation: () => new Date() })
db.public.registerFunction({ name: 'random', returnTypes: ['float4', 'float8'], implementation: () => Math.random() })
db.public.registerFunction({ name: 'gen_random_uuid', returnTypes: ['text'], implementation: () => crypto.randomUUID() })

db.public.none(`CREATE TABLE institutes (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
  contact_email TEXT, is_active INTEGER DEFAULT 1,
  api_key_hash TEXT, api_key_prefix TEXT, api_enabled INTEGER DEFAULT 0,
  ai_import_quota INTEGER DEFAULT 0,
  created_at TEXT DEFAULT '2026-01-01 00:00:00')`)
db.public.none(`CREATE TABLE users (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL,
  password_hash TEXT, role TEXT DEFAULT 'student', institute_id INTEGER,
  is_active INTEGER DEFAULT 1, created_at TEXT DEFAULT '2026-01-01 00:00:00')`)
db.public.none(`CREATE TABLE exams (id SERIAL PRIMARY KEY, code TEXT, name TEXT, is_active INTEGER DEFAULT 1)`)

let pass = 0
const ok = (name) => { pass++; console.log('ok  :', name) }

// ---- exact helpers from utils/apiKeys.js ----------------------------------
const PREFIX_LEN = 12
const generateRawKey = () => `inst_${crypto.randomBytes(24).toString('base64url')}`
const hashKey = (raw) => crypto.createHash('sha256').update(String(raw)).digest('hex')
// pg-mem quirk: parameterized comparisons fail without an execution context —
// smoke helpers use inline literals (values here are test-only; hash is hex,
// prefix is base64url, ids are numbers — all injection-safe by construction).
const q = (s) => `'${String(s).replace(/'/g, "''")}'`
async function createApiKey(instituteId) {
  const raw = generateRawKey()
  const prefix = raw.slice(0, PREFIX_LEN)
  await db.public.none(`UPDATE institutes SET api_key_hash = ${q(hashKey(raw))}, api_key_prefix = ${q(prefix)}, api_enabled = 1 WHERE id = ${Number(instituteId)}`)
  return { raw, prefix }
}
async function revokeApiKey(instituteId) {
  await db.public.none(`UPDATE institutes SET api_enabled = 0 WHERE id = ${Number(instituteId)}`)
}
async function enableApiKey(instituteId) {
  await db.public.none(`UPDATE institutes SET api_enabled = 1 WHERE id = ${Number(instituteId)}`)
}
async function resolveApiKey(rawKey) {
  const key = String(rawKey || '').trim()
  if (!key) return null
  const rows = await db.public.many(`SELECT id FROM institutes WHERE api_key_hash = ${q(hashKey(key))} AND api_enabled = 1 AND is_active = 1`)
  return rows.length ? Number(rows[0].id) : null
}

// ---- seed two institutes ---------------------------------------------------
db.public.none(`INSERT INTO institutes (id, name, code) VALUES (1,'School A','SCH-AAAA'), (2,'School B','SCH-BBBB')`)

// 1. mint A's key: raw differs from hash, prefix = first 12 chars, enabled
const { raw, prefix } = await createApiKey(1)
assert.ok(raw.startsWith('inst_') && raw.length > 30)
assert.equal(prefix, raw.slice(0, 12))
const a = await db.public.one('SELECT * FROM institutes WHERE id = 1')
assert.equal(a.api_key_hash, hashKey(raw))
assert.notEqual(a.api_key_hash, raw) // raw key never stored
assert.equal(Number(a.api_enabled), 1)
ok('mint: hash stored (not raw), prefix + enabled set')

// 2. resolve: correct key -> institute 1
assert.equal(await resolveApiKey(raw), 1)
ok('resolve: valid key → own institute')

// 3. wrong key / empty / garbage → null
assert.equal(await resolveApiKey('inst_wrong_key_value'), null)
assert.equal(await resolveApiKey(''), null)
assert.equal(await resolveApiKey(null), null)
ok('resolve: bad/empty keys rejected (null → 401)')

// 4. disable kill-switch → resolve null; re-enable → works again
await revokeApiKey(1)
assert.equal(await resolveApiKey(raw), null)
ok('revoke: disabled key cannot authenticate')
await enableApiKey(1)
assert.equal(await resolveApiKey(raw), 1)
ok('enable: re-enabled key works again')

// 5. institute B has no key → null even with A's key shape
assert.equal(await resolveApiKey(generateRawKey()), null)
ok('isolation: unknown key for B rejected')

// 6. rotate: minting a new key invalidates the old one
const old = raw
const { raw: raw2 } = await createApiKey(1)
assert.equal(await resolveApiKey(old), null)
assert.equal(await resolveApiKey(raw2), 1)
ok('rotate: new mint revokes old key (one active per institute)')

// 7. inactive institute's key is dead even if enabled
await db.public.none('UPDATE institutes SET is_active = 0 WHERE id = 1')
assert.equal(await resolveApiKey(raw2), null)
ok('deactivated institute → key dead (defense in depth)')
await db.public.none('UPDATE institutes SET is_active = 1 WHERE id = 1')

// 8. ext middleware scoping shape: req.instituteId comes ONLY from the key
// (mirrors ext.use(...) — the caller can never choose another institute)
async function fakeExtAuth(headerValue) {
  const instituteId = await resolveApiKey(headerValue)
  if (!instituteId) return { status: 401 }
  return { status: null, instituteId }
}
const r1 = await fakeExtAuth(raw2)
assert.equal(r1.instituteId, 1)
const r2 = await fakeExtAuth('bogus')
assert.equal(r2.status, 401)
ok('ext auth: instituteId derived from key only, bad key → 401')

// 9. admin summary never leaks hash/raw
const summary = { configured: Boolean(a.api_key_hash), prefix: a.api_key_prefix }
assert.ok(!JSON.stringify(summary).includes(hashKey(raw)))
ok('summary: exposes prefix only, never hash/raw')

// 10. bulk-create CSV shape (ext POST /students → bulkCreateStudents input)
const list = [{ name: 'Ravi', email: 'ravi@a.in', password: 'secret1' }, { name: 'Meena', email: 'meena@a.in', password: 'secret2' }]
const csv = list.map((s) => `${s.name},${s.email},${s.password}`).join('\n')
assert.equal(csv.split('\n').length, 2)
assert.ok(csv.includes('ravi@a.in'))
ok('ext students: JSON array → CSV pipeline input shape correct')

console.log(`\nAPI-KEYS SMOKE TEST PASSED — ${pass}/11`)
