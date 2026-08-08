import 'dotenv/config'
import pg from 'pg'
import { AsyncLocalStorage } from 'async_hooks'

// node-pg returns NUMERIC (OID 1700) as strings to avoid precision loss, but
// that breaks JS arithmetic (`a + x.score` concatenates). Parse as float.
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)))

// ---------------------------------------------------------------------------
// PostgreSQL data layer (Supabase-ready).
// Exposes a better-sqlite3-style API (prepare().get/all/run) over a pg Pool,
// auto-translating SQLite idioms so the rest of the codebase stays clean.
// ---------------------------------------------------------------------------

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.warn('[db] DATABASE_URL not set — Postgres connection disabled.')
}

const ssl = process.env.PGSSL === 'false'
  ? false
  : { rejectUnauthorized: false }

export const pool = new pg.Pool({
  connectionString,
  ssl,
  max: Number(process.env.PGPOOL_MAX || 10),
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 20000
})

pool.on('error', (err) => console.error('[db] idle client error', err.message))

const txContext = new AsyncLocalStorage()

// ------------------------------- SQL translation ---------------------------

const TABLES_WITH_ID = new Set([
  'users', 'exams', 'subjects', 'chapters', 'topics', 'questions', 'tests',
  'attempts', 'doubts', 'pdf_imports', 'ai_logs', 'notifications'
])

function translate(sql) {
  let s = sql
  // INSERT OR IGNORE / REPLACE INTO -> plain INSERT (callers add ON CONFLICT)
  s = s.replace(/INSERT\s+OR\s+IGNORE\s+INTO/i, 'INSERT INTO')
  s = s.replace(/\bREPLACE\s+INTO\b/gi, 'INSERT INTO')
  // date('now') -> current_date (must run before generic date(col))
  s = s.replace(/\bdate\s*\(\s*'now'\s*\)/gi, 'current_date')
  // datetime('now', '-30 days') etc.
  s = s.replace(
    /\bdatetime\s*\(\s*'now'\s*,\s*'(-?\d+)\s*(days?|months?|hours?|minutes?|seconds?)'\s*\)/gi,
    (m, n, unit) => {
      const num = parseInt(n, 10)
      if (num === 0) return 'now()'
      return num > 0
        ? `now() + interval '${num} ${unit}'`
        : `now() - interval '${Math.abs(num)} ${unit}'`
    }
  )
  s = s.replace(/\bdatetime\s*\(\s*'now'\s*\)/gi, 'now()')
  // date(col) -> col::date
  s = s.replace(/\bdate\s*\(\s*([A-Za-z_][A-Za-z0-9_.]*)\s*\)/gi, '$1::date')
  // Last-inserted id support for INSERT ... VALUES on tables that have an id column
  const mTable = /^\s*INSERT\s+INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(s)
  if (
    mTable && TABLES_WITH_ID.has(mTable[1].toLowerCase()) &&
    /VALUES/i.test(s) && !/RETURNING/i.test(s)
  ) {
    s = s.replace(/;\s*$/, '') + ' RETURNING id'
  }
  return s
}

// Convert `?` / `@name` placeholders to positional $1..$n with a values array.
function buildQuery(sql, args) {
  const isNamed = args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])
  const named = isNamed ? args[0] : null
  const positional = isNamed ? [] : (args.length === 1 && Array.isArray(args[0]) ? args[0] : args)

  const text = translate(sql)
  const values = []
  let out = ''
  let last = 0
  let n = 0
  let pi = 0
  const re = /\?|@([A-Za-z_][A-Za-z0-9_]*)/g
  let m
  while ((m = re.exec(text)) !== null) {
    out += text.slice(last, m.index)
    n += 1
    out += `$${n}`
    if (m[0] === '?') {
      values.push(named ? named[String(pi)] : positional[pi])
      pi += 1
    } else {
      values.push(named ? named[m[1]] : undefined)
    }
    last = m.index + m[0].length
  }
  out += text.slice(last)
  return { text: out, values }
}

// ------------------------------- public API --------------------------------

function execPrepared(sql, args) {
  const { text, values } = buildQuery(sql, args)
  const client = txContext.getStore()?.client || pool
  return client.query({ text, values })
}

export function prepare(sql) {
  return {
    get: (...args) => execPrepared(sql, args).then((r) => r.rows[0] ?? undefined),
    all: (...args) => execPrepared(sql, args).then((r) => r.rows),
    run: (...args) => execPrepared(sql, args).then((r) => ({
      changes: r.rowCount ?? 0,
      lastInsertRowid: r.rows?.[0]?.id
    }))
  }
}

export async function exec(sql) {
  return pool.query(sql)
}

export async function transaction(fn) {
  const client = await pool.connect()
  return txContext.run({ client }, async () => {
    try {
      await client.query('BEGIN')
      const result = await fn()
      await client.query('COMMIT')
      return result
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {})
      throw e
    } finally {
      client.release()
    }
  })
}

export function isConnected() {
  return Boolean(connectionString)
}

// ------------------------------- schema ------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS ai_configs (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  avatar TEXT,
  exam_id INTEGER,
  target_exam TEXT,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS exams (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 180,
  total_questions INTEGER NOT NULL DEFAULT 100,
  marks_per_question NUMERIC NOT NULL DEFAULT 4,
  negative_marks NUMERIC NOT NULL DEFAULT 1,
  subjects_json TEXT DEFAULT '[]',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS subjects (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(exam_id, name)
);

CREATE TABLE IF NOT EXISTS chapters (
  id SERIAL PRIMARY KEY,
  subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(subject_id, name)
);

CREATE TABLE IF NOT EXISTS topics (
  id SERIAL PRIMARY KEY,
  chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  UNIQUE(chapter_id, name)
);

CREATE TABLE IF NOT EXISTS questions (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  subject_id INTEGER REFERENCES subjects(id) ON DELETE SET NULL,
  chapter_id INTEGER REFERENCES chapters(id) ON DELETE SET NULL,
  topic_id INTEGER REFERENCES topics(id) ON DELETE SET NULL,
  qtype TEXT NOT NULL DEFAULT 'single',
  question_text TEXT NOT NULL,
  options_json TEXT,
  correct_answer TEXT NOT NULL,
  explanation TEXT,
  solution_image_url TEXT,
  question_image_url TEXT,
  difficulty TEXT DEFAULT 'medium',
  marks NUMERIC NOT NULL DEFAULT 4,
  negative_marks NUMERIC NOT NULL DEFAULT 1,
  estimated_time INTEGER DEFAULT 90,
  year INTEGER,
  shift TEXT,
  tags_json TEXT DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'ai',
  source_meta_json TEXT,
  content_hash TEXT UNIQUE,
  is_active INTEGER DEFAULT 1,
  usage_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  updated_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);
CREATE INDEX IF NOT EXISTS idx_questions_subject ON questions(subject_id);
CREATE INDEX IF NOT EXISTS idx_questions_chapter ON questions(chapter_id);
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic_id);
CREATE INDEX IF NOT EXISTS idx_questions_source ON questions(source);
CREATE INDEX IF NOT EXISTS idx_questions_diff ON questions(difficulty);

CREATE TABLE IF NOT EXISTS tests (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL DEFAULT 'mock',
  config_json TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS test_questions (
  test_id INTEGER NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (test_id, question_id)
);

CREATE TABLE IF NOT EXISTS attempts (
  id SERIAL PRIMARY KEY,
  test_id INTEGER REFERENCES tests(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  exam_id INTEGER,
  kind TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress',
  started_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  completed_at TEXT,
  duration_seconds INTEGER DEFAULT 0,
  time_limit_seconds INTEGER,
  score NUMERIC DEFAULT 0,
  correct INTEGER DEFAULT 0,
  wrong INTEGER DEFAULT 0,
  skipped INTEGER DEFAULT 0,
  accuracy NUMERIC DEFAULT 0,
  questions_json TEXT DEFAULT '[]',
  answers_json TEXT DEFAULT '[]',
  timeline_json TEXT DEFAULT '[]',
  ai_explained_json TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_test ON attempts(test_id);

CREATE TABLE IF NOT EXISTS bookmarks (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (user_id, question_id)
);

CREATE TABLE IF NOT EXISTS doubts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id INTEGER REFERENCES questions(id) ON DELETE CASCADE,
  question_text TEXT,
  message TEXT NOT NULL,
  ai_response TEXT,
  model TEXT,
  status TEXT DEFAULT 'answered',
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS pdf_imports (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  file_path TEXT,
  file_hash TEXT,
  status TEXT NOT NULL DEFAULT 'queued',
  total_pages INTEGER DEFAULT 0,
  processed_pages INTEGER DEFAULT 0,
  questions_created INTEGER DEFAULT 0,
  error TEXT,
  created_by INTEGER,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS ai_logs (
  id SERIAL PRIMARY KEY,
  action TEXT,
  provider TEXT,
  model TEXT,
  prompt_len INTEGER,
  status TEXT,
  latency_ms INTEGER,
  created_by INTEGER,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT,
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS topic_stats (
  user_id INTEGER NOT NULL,
  topic_id INTEGER NOT NULL,
  attempts INTEGER DEFAULT 0,
  correct INTEGER DEFAULT 0,
  total_time_sec INTEGER DEFAULT 0,
  PRIMARY KEY (user_id, topic_id)
);

CREATE TABLE IF NOT EXISTS rankings_cache (
  exam_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  score NUMERIC,
  accuracy NUMERIC,
  rank INTEGER,
  updated_at TEXT,
  PRIMARY KEY (exam_id, user_id)
);

CREATE TABLE IF NOT EXISTS user_retention (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  retain_until TEXT NOT NULL,
  plan TEXT NOT NULL,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL,
  plan TEXT NOT NULL,
  provider_ref TEXT,
  txn_ref TEXT,
  payer_name TEXT,
  payment_proof TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE INDEX IF NOT EXISTS idx_payments_user ON payments(user_id);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS txn_ref TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_name TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_proof TEXT;

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  action TEXT,
  provider TEXT,
  model TEXT,
  raw TEXT,
  data_json TEXT,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
`

export async function initSchema() {
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const client = await pool.connect()
  try {
    await client.query(SCHEMA_SQL)
    await client.query(`INSERT INTO schema_meta (key, value) VALUES ('version', '2.3.0') ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
  } finally {
    client.release()
  }
}

export default { prepare, exec, transaction, initSchema, isConnected }
