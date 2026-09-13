import express from 'express'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { pointsSummary, pointsLeaderboard } from '../utils/points.js'

const router = express.Router()
router.use(authRequired)

function parseJ(str, f = []) { try { return JSON.parse(str || '[]') } catch { return f } }

// GET /api/analytics/overview - student dashboard stats
router.get('/overview', async (req, res) => {
  const uid = req.user.id
  const completed = await db.prepare(`SELECT * FROM attempts WHERE user_id = ? AND status='completed'`).all(uid)
  const totalTests = completed.length
  const totalQuestions = completed.reduce((a, x) => a + x.correct + x.wrong + x.skipped, 0)
  const totalCorrect = completed.reduce((a, x) => a + x.correct, 0)
  const avgScore = totalTests ? Math.round((completed.reduce((a, x) => a + x.score, 0) / totalTests) * 100) / 100 : 0
  const avgAccuracy = totalTests ? Math.round((completed.reduce((a, x) => a + x.accuracy, 0) / totalTests) * 10) / 10 : 0
  const totalTime = completed.reduce((a, x) => a + x.duration_seconds, 0)

  // topic stats -> weak topics
  const topicRows = await db.prepare(`SELECT ts.topic_id, ts.attempts, ts.correct, ts.total_time_sec, t.name topic_name, c.name chapter_name, s.name subject_name
    FROM topic_stats ts
    LEFT JOIN topics t ON t.id = ts.topic_id
    LEFT JOIN chapters c ON c.id = t.chapter_id
    LEFT JOIN subjects s ON s.id = c.subject_id
    WHERE ts.user_id = ? AND ts.attempts >= 2 ORDER BY (ts.correct * 1.0 / ts.attempts) ASC`).all(uid)

  // per-day activity (last 30 days)
  const daily = await db.prepare(`SELECT date(started_at) AS "day", COUNT(*) tests, SUM(correct + wrong + skipped) questions
    FROM attempts WHERE user_id = ? AND status='completed' AND started_at::timestamptz >= now() - interval '30 days' GROUP BY "day" ORDER BY "day"`).all(uid)

  // subject accuracy (derived from per-topic stats)
  const subjectRows = await db.prepare(`
    SELECT s.id, s.name, SUM(ts.attempts) total, SUM(ts.correct) correct
    FROM topic_stats ts
    JOIN topics t ON t.id = ts.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    WHERE ts.user_id = ?
    GROUP BY s.id, s.name ORDER BY total DESC`).all(uid)

  const recent = await db.prepare(`SELECT * FROM attempts WHERE user_id = ? AND status='completed' ORDER BY started_at DESC LIMIT 10`).all(uid)

  res.json({
    totalTests, totalQuestions, totalCorrect, avgScore, avgAccuracy, totalTime,
    weakTopics: topicRows.slice(0, 8),
    strongTopics: [...topicRows].reverse().slice(0, 5),
    daily, subjects: subjectRows, recent
  })
})

// GET /api/analytics/recommendations - AI-powered personalized recommendations
router.get('/recommendations', async (req, res) => {
  const uid = req.user.id
  const weak = await db.prepare(`SELECT ts.topic_id, ts.attempts, ts.correct, t.name topic_name, c.name chapter_name, s.name subject_name
    FROM topic_stats ts LEFT JOIN topics t ON t.id=ts.topic_id LEFT JOIN chapters c ON c.id=t.chapter_id LEFT JOIN subjects s ON s.id=c.subject_id
    WHERE ts.user_id=? AND ts.attempts>=2 ORDER BY (ts.correct*1.0/ts.attempts) ASC LIMIT 5`).all(uid)
  const recent = await db.prepare(`SELECT * FROM attempts WHERE user_id=? AND status='completed' ORDER BY started_at DESC LIMIT 1`).get(uid)
  const recs = []
  for (const w of weak) {
    recs.push({ type: 'practice', title: `Revise ${w.topic_name}`, text: `Your accuracy in ${w.topic_name} is ${Math.round((w.correct / w.attempts) * 100)}%. Take a topic-wise test to improve.`, topicId: w.topic_id, chapterId: w.chapter_id })
  }
  if (recent) {
    if (recent.accuracy < 50) recs.push({ type: 'revision', title: 'Go back to basics', text: `Your last test accuracy was ${recent.accuracy}%. Try Revision Mode with easy questions first.` })
    else recs.push({ type: 'mock', title: 'Try a full mock test', text: 'You are ready for a full-length mock. Keep the speed steady and watch the pace dashboard.' })
  }
  const bookmarks = (await db.prepare('SELECT COUNT(*) c FROM bookmarks WHERE user_id=?').get(uid)).c
  if (bookmarks > 0) recs.push({ type: 'review', title: `Review ${bookmarks} bookmarked questions`, text: 'Solidify recall by re-solving your bookmarked questions.' })
  if (!recs.length) recs.push({ type: 'start', title: 'Take your first test', text: 'Start with a topic-wise test to build your baseline.' })
  res.json({ recommendations: recs })
})

// GET /api/analytics/rankings?examId=
router.get('/rankings', async (req, res) => {
  const examId = Number(req.query.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const rows = await db.prepare(`SELECT rc.rank, u.id user_id, u.name, u.avatar, rc.score, rc.accuracy
    FROM rankings_cache rc JOIN users u ON u.id = rc.user_id WHERE rc.exam_id = ? ORDER BY rc.rank ASC LIMIT 100`).all(examId)
  const me = await db.prepare(`SELECT rank, score, accuracy FROM rankings_cache WHERE exam_id = ? AND user_id = ?`).get(examId, req.user.id)
  res.json({ rankings: rows, me })
})

// GET /api/analytics/air?examId= — All-India-Rank view.
// Rank is percentile-band based on completed attempts across the platform,
// framed with total participants so "AIR #3 of 4,210" reads honestly.
router.get('/air', async (req, res) => {
  const examId = Number(req.query.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  // Everyone with >=1 completed attempt on this exam, best score per user.
  const rows = await db.prepare(`
    SELECT u.id user_id, u.name, MAX(a.score) best_score,
      ROUND(AVG(a.accuracy)::numeric, 1) avg_accuracy, COUNT(a.id) tests
    FROM attempts a JOIN users u ON u.id = a.user_id
    WHERE a.exam_id = ? AND a.status = 'completed'
    GROUP BY u.id, u.name ORDER BY best_score DESC, avg_accuracy DESC`).all(examId)
  const total = rows.length
  const rank = (i) => i + 1
  const board = rows.slice(0, 100).map((r, i) => ({
    ...r, rank: rank(i), tests: Number(r.tests),
    percentile: total > 1 ? Math.max(1, Math.round(((total - i) / total) * 100)) : 100
  }))
  const myIdx = rows.findIndex((r) => Number(r.user_id) === Number(req.user.id))
  const me = myIdx >= 0 ? {
    rank: rank(myIdx), total,
    percentile: total > 1 ? Math.max(1, Math.round(((total - myIdx) / total) * 100)) : 100,
    bestScore: rows[myIdx].best_score, avgAccuracy: rows[myIdx].avg_accuracy, tests: Number(rows[myIdx].tests)
  } : null
  res.json({ board, me, total })
})

// GET /api/analytics/report - full detailed report for a user
router.get('/report', async (req, res) => {
  const uid = req.user.id
  const attempts = await db.prepare(`SELECT * FROM attempts WHERE user_id=? AND status='completed' ORDER BY started_at`).all(uid)
  const trend = attempts.map(a => ({ date: a.started_at, score: a.score, accuracy: a.accuracy }))
  const byKind = {}
  for (const a of attempts) {
    byKind[a.kind] = byKind[a.kind] || { count: 0, score: 0, accuracy: 0 }
    byKind[a.kind].count++
    byKind[a.kind].score += a.score
    byKind[a.kind].accuracy += a.accuracy
  }
  const kinds = Object.entries(byKind).map(([k, v]) => ({ kind: k, ...v, avgScore: Math.round((v.score / v.count) * 100) / 100, avgAccuracy: Math.round((v.accuracy / v.count) * 10) / 10 }))
  const speedTrend = attempts.map(a => {
    const tl = parseJ(a.timeline_json)
    const speeds = tl.filter(x => x.speed).map(x => x.speed)
    const counts = tl.filter(x => x.correct !== undefined).length
    return { date: a.started_at, avgTimePerQ: speeds.length ? Math.round(speeds.reduce((x, y) => x + y, 0) / speeds.length) : 0, answered: counts }
  })
  res.json({ trend, kinds, speedTrend, totalAttempts: attempts.length })
})

// GET /api/analytics/points — recognition summary (level, weekly, recent feed)
router.get('/points', async (req, res) => {
  res.json(await pointsSummary(req.user.id))
})

// GET /api/analytics/points/leaderboard — recognition wall
router.get('/points/leaderboard', async (req, res) => {
  res.json(await pointsLeaderboard({ userId: req.user.id }))
})

export default router
