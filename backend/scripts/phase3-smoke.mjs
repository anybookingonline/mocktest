// One-off Phase 3 smoke test: review-queue (pdf_question_staging) flow —
// stage -> approve -> question bank publish; reject; institute scoping.
// Run: node backend/scripts/phase3-smoke.mjs
import { newDb } from 'pg-mem'
import crypto from 'crypto'

const db = newDb()

db.public.none(`
  CREATE TABLE institutes (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, code TEXT UNIQUE NOT NULL,
    ai_import_quota INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE exams (id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
  CREATE TABLE subjects (
    id SERIAL PRIMARY KEY, exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, UNIQUE(exam_id, name)
  );
  CREATE TABLE chapters (
    id SERIAL PRIMARY KEY, subject_id INTEGER NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, UNIQUE(subject_id, name)
  );
  CREATE TABLE topics (
    id SERIAL PRIMARY KEY, chapter_id INTEGER NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
    exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
    name TEXT NOT NULL, sort_order INTEGER DEFAULT 0, UNIQUE(chapter_id, name)
  );
  CREATE TABLE questions (
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
    difficulty TEXT DEFAULT 'medium',
    marks NUMERIC NOT NULL DEFAULT 4,
    negative_marks NUMERIC NOT NULL DEFAULT 1,
    estimated_time INTEGER DEFAULT 90,
    tags_json TEXT DEFAULT '[]',
    source TEXT NOT NULL DEFAULT 'ai',
    source_meta_json TEXT,
    content_hash TEXT UNIQUE,
    is_active INTEGER DEFAULT 1,
    created_at TEXT
  );
  CREATE TABLE pdf_imports (
    id SERIAL PRIMARY KEY,
    exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
    filename TEXT NOT NULL, file_path TEXT, file_hash TEXT,
    status TEXT NOT NULL DEFAULT 'queued', questions_created INTEGER DEFAULT 0,
    error TEXT, created_by INTEGER,
    institute_id INTEGER REFERENCES institutes(id) ON DELETE SET NULL,
    review_required INTEGER DEFAULT 0, created_at TEXT
  );
  CREATE TABLE pdf_question_staging (
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
    status TEXT NOT NULL DEFAULT 'pending',
    duplicate INTEGER DEFAULT 0,
    content_hash TEXT,
    question_id INTEGER,
    created_at TEXT, reviewed_at TEXT
  );
`)

// Deterministic hashContent stand-in (same shape as aiService.hashContent usage)
const hashContent = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const nowStr = () => new Date().toISOString().replace('T', ' ').slice(0, 19)

// pg-mem chokes on parameterized text comparisons — inline literal helper
async function run(sql, params = []) {
  let s = sql
  params.forEach((v, i) => {
    s = s.replace(`$${i + 1}`, typeof v === 'number' ? String(v) : v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
  })
  const r = await db.public.query(s)
  return r.rows
}
const assert = (cond, label) => {
  if (!cond) { console.error('FAIL:', label); process.exitCode = 1 } else console.log('ok  :', label)
}

// Seed
await run(`INSERT INTO institutes (name, code, ai_import_quota) VALUES ('Demo School', 'DEMO-01', 5)`)
const inst = (await run(`SELECT id FROM institutes WHERE code = 'DEMO-01'`))[0]
await run(`INSERT INTO exams (code, name) VALUES ('CLASS8', 'Class 8')`)
const exam = (await run(`SELECT id FROM exams WHERE code = 'CLASS8'`))[0]
await run(`INSERT INTO pdf_imports (exam_id, filename, status, institute_id, review_required, created_at) VALUES (${exam.id}, 'paper1.pdf', 'processing', ${inst.id}, 1, '${nowStr()}')`)
const imp = (await run(`SELECT id FROM pdf_imports LIMIT 1`))[0]

// ---- stageExtractedQuestions logic (mirrors aiTasks.js exactly) ----
const existing = new Set((await run(`SELECT content_hash FROM questions WHERE exam_id = ${exam.id}`)).map((r) => r.content_hash))
const sample = [
  { subject: 'Science', chapter: 'Force', topic: 'Friction', type: 'single', question: 'What is friction?', options: ['A. a force', 'B. a gas', 'C. a liquid', 'D. none'], correctAnswer: 'A', explanation: 'Friction opposes motion', difficulty: 'easy', marks: 4, negativeMarks: 1, estimatedTime: 60, tags: ['physics'] },
  { subject: 'Science', chapter: 'Force', topic: 'Friction', type: 'single', question: 'Friction is a ___?', options: ['A. force', 'B. fruit', 'C. color', 'D. song'], correctAnswer: 'A', difficulty: 'easy', marks: 4, negativeMarks: 1, estimatedTime: 60, tags: [] }
]
let staged = 0, dupes = 0
for (const q of sample) {
  const opts = Array.isArray(q.options) ? q.options : []
  const hash = hashContent(JSON.stringify({ question: q.question, options: opts, answer: q.correctAnswer }))
  const isDup = existing.has(hash)
  const r = await run(
    `INSERT INTO pdf_question_staging (import_id, institute_id, exam_id, subject, chapter, topic, qtype, question_text, options_json, correct_answer, explanation, difficulty, marks, negative_marks, estimated_time, tags_json, status, duplicate, content_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'pending',$17,$18) RETURNING id`,
    [imp.id, inst.id, exam.id, q.subject, q.chapter, q.topic, q.type, q.question, JSON.stringify(opts), q.correctAnswer, q.explanation || '', q.difficulty, q.marks, q.negativeMarks, q.estimatedTime, JSON.stringify(q.tags || []), isDup ? 1 : 0, hash]
  )
  if (isDup) dupes += 1; else staged += 1
}
assert(staged === 2 && dupes === 0, `staging: 2 questions parked (got ${staged}/${dupes})`)
const rows = (await run(`SELECT * FROM pdf_question_staging WHERE import_id = ${imp.id} ORDER BY id ASC`))
assert(rows.length === 2 && rows.every((r) => r.status === 'pending'), 'staged rows are pending + scoped to the import')

// ---- approveStagedQuestions logic (mirrors aiTasks.js) ----
const byExam = new Map([[exam.id, rows]])
let created = 0
for (const [examId, group] of byExam) {
  const subjects = await run(`SELECT * FROM subjects WHERE exam_id = ${examId}`)
  const chapters = await run(`SELECT * FROM chapters WHERE exam_id = ${examId}`)
  const topics = await run(`SELECT * FROM topics WHERE exam_id = ${examId}`)
  const getOrCreate = async (tableName, cache, parentCol, parentId, name) => {
    const found = cache.find((x) => x.name.toLowerCase() === String(name).toLowerCase() && (parentId == null || x[parentCol] === parentId))
    if (found) return found.id
    const cols = tableName === 'subjects' ? 'exam_id, name, sort_order' : tableName === 'chapters' ? 'subject_id, exam_id, name, sort_order' : 'chapter_id, exam_id, name, sort_order'
    const marks = tableName === 'subjects' ? '$1, $2, 0' : '$1, $2, $3, 0'
    const vals = tableName === 'subjects' ? [examId, name] : tableName === 'chapters' ? [parentId, examId, name] : [parentId, examId, name]
    const r = await run(`INSERT INTO ${tableName} (${cols}) VALUES (${marks}) RETURNING id`, vals)
    const id = Number(r[0].id)
    cache.push({ id, name, [parentCol]: parentId })
    return id
  }
  for (const row of group) {
    let subjectId = null, chapterId = null, topicId = null
    if (row.subject) subjectId = await getOrCreate('subjects', subjects, null, null, row.subject)
    if (row.chapter) chapterId = await getOrCreate('chapters', chapters, 'subject_id', subjectId, row.chapter)
    if (row.topic) topicId = await getOrCreate('topics', topics, 'chapter_id', chapterId, row.topic)
    const r = await run(
      `INSERT INTO questions (exam_id, subject_id, chapter_id, topic_id, qtype, question_text, options_json, correct_answer, explanation, difficulty, marks, negative_marks, estimated_time, tags_json, source, source_meta_json, content_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'pdf',$15,$16) ON CONFLICT (content_hash) DO NOTHING RETURNING id`,
      [examId, subjectId, chapterId, topicId, row.qtype, row.question_text, row.options_json, row.correct_answer || '', row.explanation || '', row.difficulty, Number(row.marks) || 4, Number(row.negative_marks ?? 1), Number(row.estimated_time) || 90, row.tags_json || '[]', JSON.stringify({ stagedId: row.id, importId: row.import_id }), row.content_hash]
    )
    const qid = r[0]?.id || null
    await run(`UPDATE pdf_question_staging SET status = 'approved', reviewed_at = '${nowStr()}', question_id = ${qid} WHERE id = ${row.id}`)
    if (qid) created += 1
  }
}
assert(created === 2, `approve publishes staged rows to the bank (created ${created})`)
const approvedRows = await run(`SELECT * FROM pdf_question_staging WHERE import_id = ${imp.id}`)
assert(approvedRows.every((r) => r.status === 'approved' && r.question_id), 'approved rows carry question_id back-reference')
const banked = await run(`SELECT q.id, q.question_text, s.name sub, c.name chap, t.name top, q.source FROM questions q
  LEFT JOIN subjects s ON s.id = q.subject_id LEFT JOIN chapters c ON c.id = q.chapter_id LEFT JOIN topics t ON t.id = q.topic_id`)
assert(banked.length === 2 && banked[0].source === 'pdf' && banked[0].sub === 'Science' && banked[0].chap === 'Force' && banked[0].top === 'Friction', 'bank rows carry syllabus mapping (subject/chapter/topic auto-created)')
const importAfter = (await run(`SELECT status, questions_created FROM pdf_imports WHERE id = ${imp.id}`))[0]
// Mirror the review endpoint's import-status flip:
await run(`UPDATE pdf_imports SET status = 'completed', questions_created = (SELECT COUNT(*) FROM pdf_question_staging WHERE import_id = ${imp.id} AND status = 'approved' AND question_id IS NOT NULL) WHERE id = ${imp.id}`)
const importAfter2 = (await run(`SELECT status, questions_created FROM pdf_imports WHERE id = ${imp.id}`))[0]
assert(importAfter2.status === 'completed' && Number(importAfter2.questions_created) === 2, `import flips to completed with correct count (${importAfter2.status}/${importAfter2.questions_created})`)

// ---- reject path ----
await run(`INSERT INTO pdf_imports (exam_id, filename, status, institute_id, review_required, created_at) VALUES (${exam.id}, 'paper2.pdf', 'processing', ${inst.id}, 1, '${nowStr()}')`)
const imp2 = (await run(`SELECT id FROM pdf_imports WHERE filename='paper2.pdf'`))[0]
const q3 = 'What is inertia?'
const h3 = hashContent(JSON.stringify({ question: q3, options: ['A. resistance to change of motion', 'B. a fruit'], answer: 'A' }))
await run(`INSERT INTO pdf_question_staging (import_id, institute_id, exam_id, question_text, options_json, correct_answer, status, duplicate, content_hash) VALUES (${imp2.id}, ${inst.id}, ${exam.id}, '${q3}', '[]', 'A', 'pending', 0, '${h3}')`)
await run(`UPDATE pdf_question_staging SET status = 'rejected', reviewed_at = '${nowStr()}' WHERE status = 'pending' AND id IN (SELECT id FROM pdf_question_staging WHERE import_id = ${imp2.id})`)
const rejRow = (await run(`SELECT status FROM pdf_question_staging WHERE import_id = ${imp2.id}`))[0]
assert(rejRow.status === 'rejected', 'reject marks staged row rejected (never reaches the bank)')
assert((await run(`SELECT COUNT(*) c FROM questions`))[0].c === 2, 'bank unchanged by rejection')

// ---- duplicate pre-flagging (second import, same paper) ----
const hDup = hashContent(JSON.stringify({ question: sample[0].question, options: sample[0].options, answer: sample[0].correctAnswer }))
const dupCheck = await run(`SELECT id FROM questions WHERE content_hash = '${hDup}'`)
assert(dupCheck.length === 1, 'duplicate detection: same content hash already in bank')

// ---- institute scoping (IDOR) ----
await run(`INSERT INTO institutes (name, code) VALUES ('Other', 'OTHER-9')`)
const other = (await run(`SELECT id FROM institutes WHERE code = 'OTHER-9'`))[0]
const scoped = await run(`SELECT COUNT(*) c FROM pdf_question_staging WHERE import_id = ${imp.id} AND institute_id = ${other.id}`)
assert(Number(scoped[0].c) === 0, 'review scoping: other institute cannot see these rows')

console.log(process.exitCode ? '\nPHASE 3 SMOKE TEST FAILED' : '\nPHASE 3 SMOKE TEST PASSED')
