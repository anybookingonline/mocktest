import db from '../db.js'
import { getConfig } from './aiService.js'
import { generateQuestionsWithAI, persistQuestions } from './aiTasks.js'
import { searchNewsContext, formatNewsBlock } from './exaSearch.js'

// ---------------------------------------------------------------------------
// Current Affairs Pro add-on.
//
// Daily AI-generated MCQ quiz from recent current affairs, scoped to the
// student's target exam (UPSC/Banking/SSC are the CA-heavy exams). The day's
// set is generated ONCE per exam and cached in a `tests` row with
// kind='current_affairs' — every subscriber that day shares the same set, so
// the AI cost is amortized across all CA Pro users (platform margin stays high).
//
// Gating: entitlement check happens in the route (current_affairs addon,
// or any paid plan). Engine stays entitlement-free so admin previews work.
// ---------------------------------------------------------------------------

const CA_SUBJECT = 'Current Affairs'

function monthName(d) {
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

// idempotent per (exam, day): find or build today's CA quiz
export async function getOrCreateDailyQuiz(exam) {
  const day = new Date().toISOString().slice(0, 10)
  const existing = await db.prepare(`SELECT id FROM tests WHERE kind = 'current_affairs' AND description = ? LIMIT 1`)
    .get(`ca:${exam.id}:${day}`)
  if (existing) {
    // CA quizzes are AI-generated (global) — an institute question can never
    // land in them, but the filter keeps the invariant airtight anyway.
    const rows = await db.prepare(`SELECT q.* FROM questions q JOIN test_questions tq ON tq.question_id = q.id
      WHERE tq.test_id = ? AND q.institute_id IS NULL ORDER BY tq.position`).all(existing.id)
    if (rows.length) return { testId: existing.id, questions: rows.map(normalizeQ), cached: true }
  }
  // AI generates ONE fresh set per exam per day. Topic steers the news domain;
  // persistQuestions dedups by content hash so repeats never double-store.
  const topic = `${CA_SUBJECT} for ${exam.name} aspirants — last 7 days`
  // Exa (optional): ground the quiz in real last-7-days news. Fail-open —
  // without a key or on error the AI still generates from its own knowledge.
  const newsBlock = formatNewsBlock(await searchNewsContext(topic))
  const newsHint = newsBlock
    ? `Ground these REAL recent news items (prefer making questions from them, keep facts verifiable):\n${newsBlock}\n\n`
    : ''
  const list = await generateQuestionsWithAI({ exam, count: 10, topic, seed: `ca-${exam.id}-${day}`, newsHint })
  if (!Array.isArray(list) || !list.length) throw new Error('AI could not generate the current-affairs quiz. Try again shortly.')
  await persistQuestions(list, { exam, source: 'ai', sourceMeta: { kind: 'current_affairs', day } })
  // fetch persisted rows (dedup may have dropped some; use whatever landed)
  const day2 = day
  const saved = await db.prepare(`SELECT q.* FROM questions q
    WHERE q.source_meta_json LIKE ? AND q.exam_id = ?
    ORDER BY q.id DESC LIMIT 10`).all(`%"kind":"current_affairs"%`, exam.id)
  const picked = saved.filter((q) => {
    try { return JSON.parse(q.source_meta_json || '{}').day === day2 } catch { return false }
  })
  const r = await db.prepare(`INSERT INTO tests (exam_id, title, description, kind, config_json, created_by)
    VALUES (?, ?, ?, 'current_affairs', '{}', NULL)`).run(
    exam.id, `Current Affairs — ${monthName(new Date(day2 + 'T00:00:00'))}`, `ca:${exam.id}:${day2}`)
  const testId = Number(r.lastInsertRowid)
  const ins = await db.prepare('INSERT INTO test_questions (test_id, question_id, position) VALUES (?, ?, ?)')
  for (let i = 0; i < Math.min(10, picked.length); i++) await ins.run(testId, picked[i].id, i + 1)
  return { testId, questions: picked.slice(0, 10).map(normalizeQ), cached: false }
}

function normalizeQ(q) {
  return {
    id: q.id, qtype: q.qtype, question_text: q.question_text,
    options: JSON.parse(q.options_json || '[]'), correct_answer: q.correct_answer,
    explanation: q.explanation, difficulty: q.difficulty || 'medium',
    marks: q.marks || 2, negative_marks: q.negative_marks ?? 0,
    estimated_time: q.estimated_time || 60, tags: JSON.parse(q.tags_json || '[]'),
    topic_id: q.topic_id, chapter_id: q.chapter_id, subject_id: q.subject_id
  }
}

// Admin dashboard stat: how many CA quizzes built (for AI cost visibility)
export async function caStats() {
  const total = await db.prepare(`SELECT COUNT(*) c FROM tests WHERE kind='current_affairs'`).get()
  const week = await db.prepare(`SELECT COUNT(*) c FROM tests WHERE kind='current_affairs'
    AND created_at::timestamptz > now() - interval '7 days'`).get()
  return { total: Number(total?.c) || 0, thisWeek: Number(week?.c) || 0 }
}
