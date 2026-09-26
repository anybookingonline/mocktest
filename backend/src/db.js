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
  'attempts', 'doubts', 'pdf_imports', 'pdf_batches', 'ai_logs', 'notifications', 'telegram_links',
  'institutes', 'institute_invites', 'group_orders', 'group_messages',
  'battle_rooms', 'battle_rounds', 'points_log'
  // NOTE: composite-PK tables (group_members, battle_answers, focus_areas_cache,
  // revision_state) intentionally NOT listed — they have no `id` column, so
  // RETURNING id must not be added to their upserts.
])

function translate(sql) {
  let s = sql
  // Direct $n positional placeholders -> '?' style, so EVERY query path uses
  // one binding mechanism. Callers that hand-build "$1"/"$2" fragments (e.g.
  // questions.js list route) pass values as positional args in $n order; the
  // placeholder converter below renumbers them consistently so mixing both
  // styles in one codebase can never drop a bind value (post-Supabase 500s).
  const dollarArgs = []
  s = s.replace(/\$(\d+)\b/g, (m, num) => {
    dollarArgs.push(Number(num) - 1)
    return '?'
  })
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
  return { sql: s, dollarArgs }
}

// Convert `?` / `@name` placeholders to positional $1..$n with a values array.
// `dollarArgs` maps the query's original $n positions to positional-arg order
// (from translate(), so hand-built "$2 ... $1" fragments bind the right value).
function buildQuery(sql, args) {
  const isNamed = args.length === 1 && args[0] !== null && typeof args[0] === 'object' && !Array.isArray(args[0])
  const named = isNamed ? args[0] : null
  let positional = isNamed ? [] : (args.length === 1 && Array.isArray(args[0]) ? args[0] : args)

  const { sql: text, dollarArgs } = translate(sql)
  const values = []
  let out = ''
  let last = 0
  let n = 0
  let pi = 0
  // One linear scan: string literals ('…', with '' escape), -- comments and
  // /*…*/ blocks are matched as tokens and copied verbatim — a '?' or '@word'
  // inside them is data, not a placeholder. (Found the hard way: the email
  // literal 't2@test.local' had '@test' rewritten into NULL.)
  const re = /'(?:[^']|'')*'|--[^\n]*|\/\*[\s\S]*?\*\/|\?|@([A-Za-z_][A-Za-z0-9_]*)/g
  let m
  while ((m = re.exec(text)) !== null) {
    if (m[0][0] === "'" || m[0].startsWith('--') || m[0].startsWith('/*')) continue
    out += text.slice(last, m.index)
    n += 1
    out += `$${n}`
    if (m[0] === '?') {
      // Originally a $n placeholder: bind the n-th positional argument.
      // Otherwise a plain '?' — bind the next argument in sequence.
      const idx = dollarArgs.length ? dollarArgs[pi] : pi
      values.push(named ? named[String(idx)] : positional[idx])
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
  -- Institute content isolation (Phase 5): NULL = platform/curated global
  -- question; set = institute-private (visible ONLY to that institute).
  -- NOTE: defined as a bare column here (no FK). The FK is added by the ALTER
  -- below, AFTER the institutes table exists — a forward FK reference from
  -- questions (declared before institutes) would break fresh-DB initialization.
  institute_id INTEGER,
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
-- Socratic Tutor: a doubt can be a threaded hint conversation instead of one
-- direct answer. parent_doubt_id links a follow-up ("still stuck") back to
-- the original doubt so the AI sees the whole hint history; mode/hint_round
-- distinguish a socratic thread from a normal one-shot direct answer.
ALTER TABLE doubts ADD COLUMN IF NOT EXISTS parent_doubt_id INTEGER REFERENCES doubts(id) ON DELETE CASCADE;
ALTER TABLE doubts ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'direct';
ALTER TABLE doubts ADD COLUMN IF NOT EXISTS hint_round INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_doubts_parent ON doubts(parent_doubt_id);

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
-- Customer-facing invoice number (e.g. AP-2026-000123), assigned once when a
-- payment reaches status='success'. NULL = not yet successful/legacy row.
ALTER TABLE payments ADD COLUMN IF NOT EXISTS invoice_no TEXT;
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_no);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payer_name TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_proof TEXT;
-- Refund requests (Refund Policy: add-ons never refundable; the base/group
-- plan is refundable within 15 days of payment; coupon-granted access never
-- creates a payments row at all, so it's outside this table entirely).
-- refund_status: none | requested | approved | rejected | refunded
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_status TEXT NOT NULL DEFAULT 'none';
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_reason TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_requested_at TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_note TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS refund_processed_at TEXT;

CREATE TABLE IF NOT EXISTS ai_cache (
  cache_key TEXT PRIMARY KEY,
  action TEXT,
  provider TEXT,
  model TEXT,
  raw TEXT,
  data_json TEXT,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS telegram_links (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  telegram_chat_id TEXT NOT NULL,
  username TEXT,
  linked_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_tg_chat ON telegram_links(telegram_chat_id);

CREATE TABLE IF NOT EXISTS user_addons (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  addon_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (user_id, addon_id)
);

CREATE TABLE IF NOT EXISTS institutes (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  contact_email TEXT,
  logo_url TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL;
-- 1v1 Battles ELO rating (default 1200 for everyone; 0 = never battled)
ALTER TABLE users ADD COLUMN IF NOT EXISTS elo INTEGER DEFAULT 0;
-- FB-style recognition points (every action earns XP-like points)
ALTER TABLE users ADD COLUMN IF NOT EXISTS points INTEGER DEFAULT 0;

-- Append-only recognition log: why each point batch was awarded. powers the
-- "You earned +10" feed and weekly summaries without re-deriving events.
CREATE TABLE IF NOT EXISTS points_log (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  points INTEGER NOT NULL,
  action TEXT NOT NULL,
  meta_json TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_points_log_user ON points_log (user_id, created_at DESC);

-- Institute content isolation: questions imported by a school/coaching are
-- institute-private (institute_id set); platform/curated stay global (NULL).
-- This ALTER is the single source of truth for the column + index (fresh DBs
-- AND old DBs that predate isolation both get the column here). The FK is
-- added idempotently in initSchema() after this script (named constraint +
-- "already exists" tolerance) so restarts never pile up duplicate constraints.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS institute_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_questions_institute ON questions(institute_id);

-- White-label branding + B2B plan fields on institutes
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'coaching';
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'trial';
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS plan_until TEXT;
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS platform_name TEXT;
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS tagline TEXT;
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS primary_color TEXT;
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS accent_color TEXT;
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS custom_domain TEXT;
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
-- Per-institute daily AI quota (pilot loss guarantee): max AI doubts across ALL
-- students of the institute per day. 0 = unlimited (default for paid plans).
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_daily_quota INTEGER DEFAULT 0;
-- Per-institute MONTHLY PDF import quota: how many exam-paper PDFs the
-- institute's sub-admin may submit for AI extraction per calendar month.
-- 0 = sub-admin upload disabled (platform admin imports on their behalf).
-- ~₹5–15 AI cost per paper (Gemini Vision + DeepSeek structuring).
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS ai_import_quota INTEGER DEFAULT 0;
-- Institute-sourced imports are tagged so quota accounting + review ownership
-- stay scoped to the owning institute (platform imports keep NULL).
ALTER TABLE pdf_imports ADD COLUMN IF NOT EXISTS institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_pdf_imports_inst ON pdf_imports(institute_id);
-- 1 = extraction parked in the review queue (staging) instead of publishing
-- straight to the shared question bank (institute self-serve imports).
ALTER TABLE pdf_imports ADD COLUMN IF NOT EXISTS review_required INTEGER DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Gemini Batch Mode PDF imports (~50% cheaper than the normal synchronous
-- path, but async — Google's turnaround target is "up to 24h"). One row per
-- Gemini batch job; pdf_imports.status='batched' rows point at one via
-- batch_id + carry their own batch_key to match their result once the batch
-- finishes. A background poller (routes/import.js) checks pending rows
-- periodically and finishes them through the normal structure+persist path.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pdf_batches (
  id SERIAL PRIMARY KEY,
  batch_name TEXT NOT NULL UNIQUE,
  model TEXT,
  state TEXT NOT NULL DEFAULT 'BATCH_STATE_PENDING',
  created_by INTEGER,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  checked_at TEXT
);
ALTER TABLE pdf_imports ADD COLUMN IF NOT EXISTS batch_id INTEGER REFERENCES pdf_batches(id) ON DELETE SET NULL;
ALTER TABLE pdf_imports ADD COLUMN IF NOT EXISTS batch_key TEXT;
CREATE INDEX IF NOT EXISTS idx_pdf_imports_batch ON pdf_imports(batch_id);

-- ---------------------------------------------------------------------------
-- Email (transactional — Resend). Soft verification + password-reset tokens.
-- email_verified: 0 = unverified (students can still use the app fully),
-- 1 = clicked the verification link. Hard blocks hurt signup conversion.
-- email_tokens: one row per verification/reset request. Only the sha256 of the
-- token is stored (like B2/API keys) — the raw token lives only in the email.
--   purpose 'verify'         48h link
--   purpose 'password_reset' 15-min 6-digit code, single-use
-- ---------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified INTEGER DEFAULT 0;
CREATE TABLE IF NOT EXISTS email_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_at TEXT,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_email_tokens_lookup ON email_tokens(user_id, purpose, used_at);

-- ---------------------------------------------------------------------------
-- Institute API access (B2B integrations). Institutes that want to push data
-- programmatically (student rosters, papers) get a scoped API key:
--   api_key_hash  sha256 of the raw key (raw shown ONCE at creation)
--   api_key_prefix first 12 chars for identification in the admin UI
--   api_enabled   kill-switch without deleting the key
-- External calls authenticate with:  X-API-Key: <raw key>
-- ---------------------------------------------------------------------------
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS api_key_hash TEXT;
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS api_key_prefix TEXT;
ALTER TABLE institutes ADD COLUMN IF NOT EXISTS api_enabled INTEGER DEFAULT 0;

-- ---------------------------------------------------------------------------
-- Phase 3: extracted-questions review queue. Institute (sub-admin) PDF imports
-- land here first — AI extraction fills this table (status='pending'); only
-- rows the sub-admin explicitly approves are written into the shared questions
-- bank (question_id records the created row; duplicates are flagged up-front).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pdf_question_staging (
  id SERIAL PRIMARY KEY,
  import_id INTEGER NOT NULL REFERENCES pdf_imports(id) ON DELETE CASCADE,
  institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL,
  exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
  subject TEXT, chapter TEXT, topic TEXT,
  qtype TEXT DEFAULT 'single',
  question_text TEXT NOT NULL,
  options_json TEXT DEFAULT '[]',
  correct_answer TEXT,
  explanation TEXT,
  difficulty TEXT DEFAULT 'medium',
  marks NUMERIC DEFAULT 4,
  negative_marks NUMERIC DEFAULT 1,
  estimated_time INTEGER DEFAULT 90,
  tags_json TEXT DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  duplicate INTEGER DEFAULT 0,              -- same content already in the bank
  content_hash TEXT,
  question_id INTEGER,                      -- questions.id after approval
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  reviewed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_pqs_import ON pdf_question_staging(import_id);

-- Institute invite codes: students register with the code and are auto-linked
-- to the institute (sub-admin = users row with role='admin' + institute_id).
CREATE TABLE IF NOT EXISTS institute_invites (
  id SERIAL PRIMARY KEY,
  institute_id INTEGER NOT NULL REFERENCES institutes(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  label TEXT,
  max_uses INTEGER DEFAULT 0,
  used_count INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

-- ---------------------------------------------------------------------------
-- Group Study & Discussions — students form groups; every N paying members
-- unlock M free memberships (default: 2 paid -> 1 free, capped). The deal is
-- enforced server-side and recalculated whenever a payment completes.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS group_orders (
  id SERIAL PRIMARY KEY,
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'study',
  join_code TEXT UNIQUE NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INTEGER NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member',
  member_paid INTEGER DEFAULT 0,
  payment_id INTEGER,
  joined_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE IF NOT EXISTS group_messages (
  id SERIAL PRIMARY KEY,
  group_id INTEGER NOT NULL REFERENCES group_orders(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body TEXT NOT NULL,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_group_messages_g ON group_messages(group_id, id);

-- ---------------------------------------------------------------------------
-- AI Focus Areas (#3) — ranked "most frequently asked" topics per exam, built
-- purely from the platform's own legally-imported PYQ data (year/shift/topic).
-- Cached for 7 days; refreshable by admins.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS focus_areas_cache (
  exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
  data_json TEXT NOT NULL,
  generated_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (exam_id)
);

-- ---------------------------------------------------------------------------
-- 1v1 Quiz Battles (#6) — realtime-feel duels over HTTP polling (no websocket
-- server needed). Rooms have N timed rounds; each round is a shared question;
-- both players answer; correct + faster = more points. ELO lives on the room.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS battle_rooms (
  id SERIAL PRIMARY KEY,
  exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
  player1_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  player2_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'waiting',   -- waiting | active | finished | abandoned
  rounds INTEGER NOT NULL DEFAULT 5,
  current_round INTEGER NOT NULL DEFAULT 0,
  topic_id INTEGER,
  p1_score INTEGER NOT NULL DEFAULT 0,
  p2_score INTEGER NOT NULL DEFAULT 0,
  winner_id INTEGER,
  rating_delta INTEGER NOT NULL DEFAULT 0,
  join_code TEXT UNIQUE,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS battle_rounds (
  id SERIAL PRIMARY KEY,
  room_id INTEGER NOT NULL REFERENCES battle_rooms(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL,
  question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  round_started_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  round_ends_at TEXT NOT NULL,
  UNIQUE (room_id, round_no)
);

CREATE TABLE IF NOT EXISTS battle_answers (
  room_id INTEGER NOT NULL REFERENCES battle_rooms(id) ON DELETE CASCADE,
  round_no INTEGER NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  selected TEXT,
  is_correct INTEGER DEFAULT 0,
  answer_ms INTEGER,
  points INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS')),
  PRIMARY KEY (room_id, round_no, user_id)
);
CREATE INDEX IF NOT EXISTS idx_battle_answers_user ON battle_answers(user_id);

-- ---------------------------------------------------------------------------
-- Spaced Revision (#7) — forgetting-curve boxes per user+topic. The daily cron
-- moves due topics back a box when the user hasn't practiced them; students
-- see "aaj ye revise karo" from this table. Telegram nudges are rate-limited
-- via last_nudged_at (max once per topic per day).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS revision_state (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  topic_id INTEGER NOT NULL,
  box INTEGER NOT NULL DEFAULT 1,
  last_reviewed_at TEXT,
  last_nudged_at TEXT,
  streak INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, topic_id)
);

-- ---------------------------------------------------------------------------
-- Coupons — social-media rollout codes. Grant retention or add-on days with
-- per-code caps, per-user limits, expiry, and a source tag (instagram /
-- telegram / youtube) so each campaign's signups are attributable.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS coupons (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  kind TEXT NOT NULL DEFAULT 'retention',  -- retention | addon
  days INTEGER NOT NULL DEFAULT 365,
  addon_id TEXT,
  source TEXT DEFAULT '',
  max_uses INTEGER NOT NULL DEFAULT 0,     -- 0 = unlimited
  per_user_limit INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_coupons_source ON coupons(source);

CREATE TABLE IF NOT EXISTS coupon_redemptions (
  id SERIAL PRIMARY KEY,
  coupon_id INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT DEFAULT (to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
);
CREATE INDEX IF NOT EXISTS idx_coupon_redemptions_user ON coupon_redemptions(user_id);
`

export async function initSchema() {
  if (!connectionString) throw new Error('DATABASE_URL is required')
  const client = await pool.connect()
  try {
    await client.query(SCHEMA_SQL)
    // FK for questions.institute_id — added here (not inside SCHEMA_SQL) with a
    // fixed name and "already exists" tolerance: idempotent across restarts and
    // safe on both fresh DBs and DBs that predate the isolation column.
    try {
      await client.query(`ALTER TABLE questions ADD CONSTRAINT questions_institute_fk
        FOREIGN KEY (institute_id) REFERENCES institutes(id) ON DELETE CASCADE`)
    } catch (e) {
      if (!/already exists/i.test(String(e.message))) throw e
    }
    await client.query(`INSERT INTO schema_meta (key, value) VALUES ('version', '2.5.0') ON CONFLICT (key) DO UPDATE SET value = excluded.value`)
  } finally {
    client.release()
  }
}

export default { prepare, exec, transaction, initSchema, isConnected }
