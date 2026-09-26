import db from '../db.js'
import { aiChat, getConfig } from './aiService.js'

// ---------------------------------------------------------------------------
// AI Focus Areas (#3) — safe, legal "trending topics" ranking.
//
// Built ONLY from the platform's own legally-imported PYQ data: every question
// row already stores `year`, `shift` and `topic_id`. We aggregate how often
// each topic appeared in past papers (weighted toward recent years), then use
// one cheap AI call to write student-friendly focus notes. No "prediction"
// claims anywhere — the marketing language is "topics most frequently asked
// in past years". Cached per exam for 7 days.
// ---------------------------------------------------------------------------

const CACHE_DAYS = 7

export async function buildFocusAreas(examId) {
  // 1) Aggregate PYQ frequency per topic from our own question bank.
  const topics = await db.prepare(`
    SELECT t.id, t.name, t.chapter_id, c.name AS chapter_name, s.name AS subject_name,
           COUNT(q.id) AS total_qs,
           COUNT(DISTINCT q.year) AS years_seen,
           MAX(q.year) AS last_year,
           MIN(q.year) AS first_year
    FROM topics t
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    JOIN questions q ON q.topic_id = t.id AND q.source = 'pdf' AND q.is_active = 1
    WHERE t.exam_id = ?
    GROUP BY t.id, t.name, t.chapter_id, c.name, s.name
    HAVING COUNT(q.id) >= 2
    ORDER BY total_qs DESC
    LIMIT 60
  `).all(Number(examId))

  if (!topics.length) return { areas: [], isEmpty: true }

  // 2) Frequency score: total appearances + recency boost (recent years weigh more).
  const currentYear = new Date().getFullYear()
  const scored = topics.map((t) => {
    let recency = 0
    if (t.first_year && t.last_year) {
      const span = Math.max(1, t.last_year - t.first_year + 1)
      recency = t.years_seen / span // consistency across years
    }
    const recentBoost = t.last_year ? Math.max(0, 1 - (currentYear - Number(t.last_year)) / 6) : 0
    const score = Math.round(Number(t.total_qs) * 10 + recency * 40 + recentBoost * 30)
    return { ...t, score }
  }).sort((a, b) => b.score - a.score)

  const top = scored.slice(0, 12)

  // 3) One AI call for student-friendly notes (cheap, cached via ai_cache).
  let notes = {}
  try {
    const payload = top.map((t, i) => `${i + 1}. ${t.name} (${t.subject_name} / ${t.chapter_name}) — appeared in ${t.years_seen} different years, ${t.total_qs} questions, most recently ${t.last_year || 'recent'}`)
    const res = await aiChat({
      system: 'You are an exam-prep strategist for Indian competitive exams. For each given topic, write one short line (max 18 words) telling the student WHY this topic matters in the exam, based only on the frequency data provided. Never claim a paper was leaked or that questions are predicted — use framing like "consistently asked" or "high-frequency topic". Reply ONLY JSON: { "notes": { "<topic name>": "one line" } }',
      messages: [{ role: 'user', content: payload.join('\n') }],
      json: true,
      action: 'focus_areas_notes',
      temperature: 0.4,
      maxTokens: 1500
    })
    notes = res.data?.notes || {}
  } catch { /* notes are optional — ranking itself is deterministic */ }

  const areas = top.map((t, i) => ({
    rank: i + 1,
    topicId: t.id,
    topic: t.name,
    chapter: t.chapter_name,
    subject: t.subject_name,
    appearances: Number(t.total_qs),
    yearsSeen: Number(t.years_seen),
    lastYear: t.last_year ? Number(t.last_year) : null,
    score: t.score,
    note: notes[t.name] || `${t.name} — consistently asked in past ${t.years_seen} years of papers.`
  }))

  return { areas, isEmpty: false, generatedAt: new Date().toISOString().replace('T', ' ').slice(0, 19) }
}

export async function getFocusAreas(examId, { force = false } = {}) {
  if (!force) {
    const hit = await db.prepare(`
      SELECT data_json FROM focus_areas_cache
      WHERE exam_id = ? AND generated_at::timestamptz > now() - interval '${CACHE_DAYS} days'
    `).get(Number(examId))
    if (hit) return { ...JSON.parse(hit.data_json), cached: true }
  }
  const fresh = await buildFocusAreas(examId)
  if (!fresh.isEmpty) {
    await db.prepare(`
      INSERT INTO focus_areas_cache (exam_id, data_json, generated_at)
      VALUES (?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
      ON CONFLICT (exam_id) DO UPDATE SET data_json = excluded.data_json, generated_at = excluded.generated_at
    `).run(Number(examId), JSON.stringify(fresh))
  }
  return fresh
}

export async function isFocusUnlocked(userId) {
  // Real AI-cost feature — requires its own addon (or a bundle that includes
  // it: ai_power/ai_max). Retention/voice-doubts alone no longer unlock this
  // for free — base plan stays minimal, per the addon-first pricing model.
  const { getEntitlements } = await import('./addons.js')
  const ent = await getEntitlements(userId)
  return Boolean(ent.focusAreas || ent.aiPower || ent.aiMax)
}
