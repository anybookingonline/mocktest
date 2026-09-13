import db from '../db.js'
import { getConfig } from './aiService.js'
import { generateQuestionsWithAI, persistQuestions } from './aiTasks.js'

// ---------------------------------------------------------------------------
// Spaced Revision (#7) + Doubt-to-Mock (#4).
//
// #7: Leitner-style forgetting-curve boxes per (user, topic). Every answered
// question updates the topic's box (correct streaks promote, mistakes demote).
// A topic becomes "due" when it hasn't been reviewed within its box interval
// (1, 3, 7, 14, 30 days). Daily cron nudges via the Telegram bot (max 1/day).
//
// #4: every answered doubt auto-generates 3 similar practice questions and
// packs them into a "Doubt Revision" test — the closed feedback loop that
// keeps students practising right after a doubt is resolved.
// ---------------------------------------------------------------------------

export const BOX_INTERVALS = [1, 3, 7, 14, 30]
const MAX_BOX = 5

// ----------------------------- state updates --------------------------------

// Called from the attempts answer endpoint and the adaptive engine on every
// answered question with a topic. Cheap upsert; failures are non-fatal.
export async function recordTopicOutcome(userId, topicId, wasCorrect) {
  if (!userId || !topicId) return
  try {
    const row = await db.prepare('SELECT box, streak FROM revision_state WHERE user_id = ? AND topic_id = ?').get(userId, topicId)
    let box = Number(row?.box) || 1
    let streak = Number(row?.streak) || 0
    if (wasCorrect) {
      streak += 1
      if (streak >= 2) { box = Math.min(MAX_BOX, box + 1); streak = 0 }
    } else {
      box = Math.max(1, box - 1)
      streak = 0
    }
    await db.prepare(`
      INSERT INTO revision_state (user_id, topic_id, box, last_reviewed_at, streak)
      VALUES (?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), ?)
      ON CONFLICT (user_id, topic_id) DO UPDATE SET
        box = excluded.box, streak = excluded.streak,
        last_reviewed_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS')
    `).run(userId, topicId, box, streak)
  } catch { /* revision tracking must never break answering */ }
}

// ----------------------------- due list -------------------------------------

export async function dueRevision(userId, { limit = 12 } = {}) {
  const rows = await db.prepare(`
    SELECT rs.topic_id, rs.box, rs.streak, rs.last_reviewed_at,
           t.name AS topic, c.name AS chapter, s.name AS subject,
           ts.attempts, ts.correct
    FROM revision_state rs
    JOIN topics t ON t.id = rs.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    LEFT JOIN topic_stats ts ON ts.user_id = rs.user_id AND ts.topic_id = rs.topic_id
    WHERE rs.user_id = ?
  `).all(Number(userId))
  // Filter + sort in JS: per-user row counts are tiny and this keeps the SQL
  // portable across Postgres flavors.
  const now = Date.now()
  const due = rows.filter((r) => {
    if (!r.last_reviewed_at) return true
    const last = new Date(String(r.last_reviewed_at).replace(' ', 'T') + 'Z').getTime()
    return Number.isNaN(last) || now - last > (BOX_INTERVALS[(Number(r.box) || 1) - 1] || 1) * 86400000
  })
  due.sort((a, b) => (Number(a.box) - Number(b.box)) ||
    ((a.attempts ? Number(a.correct) / Number(a.attempts) : 0) - (b.attempts ? Number(b.correct) / Number(b.attempts) : 0)))
  return due.slice(0, limit).map((r) => ({
    ...r,
    accuracy: r.attempts > 0 ? Math.round((Number(r.correct) / Number(r.attempts)) * 100) : 0
  }))
}

// Start a 10-question mixed revision test from due topics (hardest first).
export async function startRevisionMock(userId) {
  const due = await dueRevision(userId, { limit: 6 })
  if (!due.length) return { empty: true }
  const topicIds = due.map((t) => Number(t.topic_id))
  const marks = '?,'.repeat(topicIds.length).slice(0, -1)
  // Filtering in SQL + JS: keeps the query portable across Postgres flavors
  // (pg-mem mishandles JOIN + IS NOT NULL combinations).
  const qs = (await db.prepare(`
    SELECT q.id, q.exam_id, q.difficulty, t.name AS topic_name FROM questions q
    JOIN topics t ON t.id = q.topic_id
    WHERE q.topic_id IN (${marks}) AND q.is_active = 1
  `).all(...topicIds)).filter((q) => q.exam_id != null)
  if (!qs.length) return { empty: true }
  // Fisher-Yates shuffle for freshness, then hardest-difficulty-first pick.
  const diffRank = { hard: 0, medium: 1, easy: 2 }
  for (let i = qs.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[qs[i], qs[j]] = [qs[j], qs[i]]
  }
  qs.sort((a, b) => (diffRank[a.difficulty] ?? 2) - (diffRank[b.difficulty] ?? 2))
  const picked = qs.slice(0, 10)
  const title = `AI Revision — ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
  const r = await db.prepare(`
    INSERT INTO attempts (user_id, title, exam_id, kind, status, time_limit_seconds, questions_json)
    VALUES (?, ?, ?, 'revision', 'in_progress', 600, ?)
  `).run(userId, title, picked[0].exam_id, JSON.stringify(picked.map((q) => q.id)))
  return {
    attemptId: Number(r.lastInsertRowid),
    questionCount: picked.length,
    topics: [...new Set(picked.map((q) => q.topic_name))]
  }
}

// ----------------------------- Doubt-to-Mock (#4) ---------------------------

export async function generateDoubtMock({ doubtId, userId }) {
  const d = await db.prepare('SELECT * FROM doubts WHERE id = ? AND user_id = ?').get(Number(doubtId), Number(userId))
  if (!d) return { error: 'Doubt not found' }

  // Already generated once? Hand back the same test (no duplicate AI spend).
  const existing = await db.prepare(`SELECT id FROM tests WHERE description = ?`).get(`doubt:${doubtId}`)
  if (existing) {
    const cnt = await db.prepare('SELECT COUNT(*) c FROM test_questions WHERE test_id = ?').get(existing.id)
    return { testId: existing.id, questionCount: Number(cnt?.c) || 3, existing: true }
  }

  // Resolve context: question-linked doubts carry topic+exam; text doubts use
  // the student's profile exam.
  let exam = null
  let topic = null
  let mapping = null
  if (d.question_id) {
    const q = await db.prepare(`
      SELECT q.exam_id, t.id AS topic_id, t.name AS topic_name, c.id AS chapter_id, s.id AS subject_id
      FROM questions q
      LEFT JOIN topics t ON t.id = q.topic_id
      LEFT JOIN chapters c ON c.id = t.chapter_id
      LEFT JOIN subjects s ON s.id = c.subject_id
      WHERE q.id = ?
    `).get(d.question_id)
    if (q) {
      exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(q.exam_id)
      if (q.topic_id) {
        mapping = { subjectId: q.subject_id, chapterId: q.chapter_id, topicId: q.topic_id }
        topic = q.topic_name
      }
    }
  }
  if (!exam) {
    const u = await db.prepare('SELECT target_exam FROM users WHERE id = ?').get(Number(userId))
    if (u?.target_exam) {
      exam = await db.prepare('SELECT * FROM exams WHERE code ILIKE ? OR name ILIKE ? LIMIT 1')
        .get(`%${u.target_exam}%`, `%${u.target_exam}%`)
    }
  }
  if (!exam) return { error: 'Profile me apna exam select karo (ya question ke saath doubt pucho) — tab AI similar questions bana payega.' }

  const list = await generateQuestionsWithAI({
    exam, count: 3, topic: topic || String(d.message).slice(0, 140), seed: `doubt-${doubtId}`
  })
  if (!Array.isArray(list) || !list.length) return { error: 'AI could not generate practice questions for this doubt. Try again.' }

  await persistQuestions(list, { exam, source: 'ai', sourceMeta: { doubtId }, mapping })
  const rows = await db.prepare(`
    SELECT id FROM questions WHERE source_meta_json = ? AND exam_id = ? ORDER BY id DESC LIMIT 3
  `).all(JSON.stringify({ doubtId }), exam.id)
  const qids = rows.map((r) => r.id)
  if (!qids.length) return { error: 'Practice questions could not be saved. Try again.' }

  const title = `Doubt Revision — ${String(d.message || 'Doubt').slice(0, 42)}`
  const r = await db.prepare(`
    INSERT INTO tests (exam_id, title, description, kind, config_json, created_by)
    VALUES (?, ?, ?, 'revision', '{}', ?)
  `).run(exam.id, title, `doubt:${doubtId}`, userId)
  const testId = Number(r.lastInsertRowid)
  for (let i = 0; i < qids.length; i++) {
    await db.prepare('INSERT INTO test_questions (test_id, question_id, position) VALUES (?, ?, ?)')
      .run(testId, qids[i], i + 1)
  }
  return { testId, questionCount: qids.length }
}

// ----------------------------- daily cron -----------------------------------

async function sendTelegram(chatId, text) {
  const token = await getConfig('telegram.botToken')
  if (!token) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text })
    })
    return res.ok
  } catch { return false }
}

// GET /api/revision/cron (CRON_SECRET protected) — decay stale boxes + Telegram nudges.
export async function runRevisionCron() {
  // 1) Long-inactive topics slide back toward box 1 so they resurface.
  const decay = await db.prepare(`
    UPDATE revision_state SET box = GREATEST(1, box - 1), streak = 0
    WHERE last_reviewed_at IS NOT NULL
      AND last_reviewed_at::timestamptz < now() - interval '90 days'
  `).run()

  // 2) Telegram reminder — at most one nudge per user per day.
  let nudged = 0
  const botEnabled = (await getConfig('features.telegramBot', 'false')) === 'true' && Boolean(await getConfig('telegram.botToken'))
  if (botEnabled) {
    const links = await db.prepare('SELECT user_id, telegram_chat_id FROM telegram_links').all()
    for (const l of links) {
      const last = await db.prepare('SELECT MAX(last_nudged_at) t FROM revision_state WHERE user_id = ? AND last_nudged_at IS NOT NULL').get(l.user_id)
      if (last?.t && Date.now() - new Date(String(last.t).replace(' ', 'T') + 'Z').getTime() < 86400000) continue
      const due = await dueRevision(l.user_id, { limit: 3 })
      if (!due.length) continue
      const list = due.map((t) => t.topic).join(', ')
      const ok = await sendTelegram(l.telegram_chat_id, `📚 Revision time! Ye topics aaj revise karo: ${list}. App kholo → Revision.`)
      if (ok) {
        await db.prepare(`UPDATE revision_state SET last_nudged_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE user_id = ?`).run(l.user_id)
        nudged += 1
      }
    }
  }
  return { decayed: Number(decay.changes || 0), nudged }
}
