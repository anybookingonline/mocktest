import express from 'express'
import crypto from 'crypto'
import db from '../db.js'
import { authRequired } from '../middleware/auth.js'
import { pointsSummary, pointsLeaderboard } from '../utils/points.js'

const router = express.Router()

function parseJ(str, f = []) { try { return JSON.parse(str || '[]') } catch { return f } }

// GET /api/analytics/report/shared/:token - PUBLIC (no login) read-only
// Parent Report view. Registered before router.use(authRequired) below so it
// never requires a token. Only ever exposes progress stats — no email/phone.
router.get('/report/shared/:token', async (req, res) => {
  const share = await db.prepare('SELECT * FROM report_shares WHERE token = ?').get(String(req.params.token))
  if (!share) return res.status(404).json({ error: 'This report link is invalid or has been revoked.' })
  const user = await db.prepare('SELECT id, name, target_exam FROM users WHERE id = ?').get(share.user_id)
  if (!user) return res.status(404).json({ error: 'Report not found' })

  const completed = await db.prepare(`SELECT * FROM attempts WHERE user_id = ? AND status='completed' ORDER BY started_at DESC`).all(user.id)
  const totalTests = completed.length
  const avgAccuracy = totalTests ? Math.round((completed.reduce((a, x) => a + x.accuracy, 0) / totalTests) * 10) / 10 : 0
  const totalTime = completed.reduce((a, x) => a + x.duration_seconds, 0)
  const topicRows = await db.prepare(`SELECT ts.attempts, ts.correct, t.name topic_name, c.name chapter_name, s.name subject_name
    FROM topic_stats ts LEFT JOIN topics t ON t.id = ts.topic_id LEFT JOIN chapters c ON c.id = t.chapter_id LEFT JOIN subjects s ON s.id = c.subject_id
    WHERE ts.user_id = ? AND ts.attempts >= 2 ORDER BY (ts.correct * 1.0 / ts.attempts) ASC LIMIT 5`).all(user.id)
  res.json({
    name: user.name, targetExam: user.target_exam,
    totalTests, avgAccuracy, totalTime,
    recent: completed.slice(0, 10).map((a) => ({ title: a.title, score: a.score, accuracy: a.accuracy, started_at: a.started_at })),
    weakTopics: topicRows
  })
})

router.use(authRequired)

// POST /api/analytics/report/share - get-or-create this student's parent-report link
router.post('/report/share', async (req, res) => {
  const token = crypto.randomBytes(16).toString('hex')
  // ON CONFLICT DO NOTHING + re-select: a double-click racing two inserts
  // never hits the user_id UNIQUE constraint as an unhandled error.
  await db.prepare('INSERT INTO report_shares (user_id, token) VALUES (?, ?) ON CONFLICT (user_id) DO NOTHING').run(req.user.id, token)
  const row = await db.prepare('SELECT token FROM report_shares WHERE user_id = ?').get(req.user.id)
  res.json({ token: row.token })
})

// POST /api/analytics/report/share/revoke - kill the current link (a new
// /share call afterwards issues a fresh, different token)
router.post('/report/share/revoke', async (req, res) => {
  await db.prepare('DELETE FROM report_shares WHERE user_id = ?').run(req.user.id)
  res.json({ ok: true })
})

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

// GET /api/analytics/heatmap - full subject -> chapter -> topic accuracy grid
// (weakTopics/strongTopics in /overview only show the top-8/top-5 extremes;
// this returns everything the student has attempted so a heatmap can colour
// every cell, not just the worst few).
router.get('/heatmap', async (req, res) => {
  const uid = req.user.id
  const examId = req.query.examId ? Number(req.query.examId) : null
  const rows = await db.prepare(`
    SELECT ts.topic_id, ts.attempts, ts.correct, t.name topic_name, t.chapter_id,
           c.name chapter_name, c.subject_id, s.name subject_name, s.exam_id
    FROM topic_stats ts
    JOIN topics t ON t.id = ts.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    WHERE ts.user_id = ?${examId ? ' AND s.exam_id = ?' : ''}
  `).all(...(examId ? [uid, examId] : [uid]))

  const subjects = new Map()
  for (const r of rows) {
    if (!subjects.has(r.subject_id)) subjects.set(r.subject_id, { id: r.subject_id, name: r.subject_name, chapters: new Map(), attempts: 0, correct: 0 })
    const subj = subjects.get(r.subject_id)
    subj.attempts += r.attempts; subj.correct += r.correct
    if (!subj.chapters.has(r.chapter_id)) subj.chapters.set(r.chapter_id, { id: r.chapter_id, name: r.chapter_name, topics: [], attempts: 0, correct: 0 })
    const chap = subj.chapters.get(r.chapter_id)
    chap.attempts += r.attempts; chap.correct += r.correct
    chap.topics.push({ id: r.topic_id, name: r.topic_name, attempts: r.attempts, correct: r.correct, accuracy: r.attempts ? Math.round((r.correct / r.attempts) * 100) : null })
  }

  const acc = (a, c) => a ? Math.round((c / a) * 100) : null
  const out = [...subjects.values()].map((s) => ({
    id: s.id, name: s.name, attempts: s.attempts, accuracy: acc(s.attempts, s.correct),
    chapters: [...s.chapters.values()]
      .map((c) => ({ id: c.id, name: c.name, attempts: c.attempts, accuracy: acc(c.attempts, c.correct), topics: c.topics.sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100)) }))
      .sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100))
  })).sort((a, b) => (a.accuracy ?? 100) - (b.accuracy ?? 100))

  res.json({ subjects: out })
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

// GET /api/analytics/predict?examId= — a percentile-range ESTIMATE, not a
// claimed official exam rank. Deliberately framed as a range + explicit
// disclaimer (not a single confident number) — an accuracy-based guess isn't
// calibrated against real exam outcomes, and presenting it as a firm
// prediction would be misleading. Widens the range when the in-app sample
// for this exam is small (less confidence with fewer data points).
router.get('/predict', async (req, res) => {
  const examId = Number(req.query.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const uid = req.user.id
  const attempts = await db.prepare(`SELECT * FROM attempts WHERE user_id = ? AND exam_id = ? AND status = 'completed' ORDER BY started_at DESC LIMIT 10`).all(uid, examId)
  if (attempts.length < 3) {
    return res.json({ enough: false, message: 'Kam se kam 3 completed tests chahiye is exam ke liye ek estimate dikhane ke liye.' })
  }

  const avg = (arr) => arr.length ? arr.reduce((a, x) => a + Number(x.accuracy || 0), 0) / arr.length : null
  const recentAcc = avg(attempts.slice(0, 5))
  const olderAcc = avg(attempts.slice(5, 10))
  const delta = olderAcc != null ? recentAcc - olderAcc : 0

  // Same in-app percentile universe as /air (everyone who's attempted this exam).
  const rows = await db.prepare(`SELECT u.id user_id, MAX(a.score) best_score, AVG(a.accuracy) avg_accuracy
    FROM attempts a JOIN users u ON u.id = a.user_id WHERE a.exam_id = ? AND a.status = 'completed' GROUP BY u.id`).all(examId)
  rows.sort((a, b) => Number(b.best_score) - Number(a.best_score) || Number(b.avg_accuracy) - Number(a.avg_accuracy))
  const total = rows.length
  const myIdx = rows.findIndex((r) => Number(r.user_id) === uid)
  const percentile = total > 1 && myIdx >= 0 ? Math.max(1, Math.round(((total - myIdx) / total) * 100)) : null

  const band = total < 20 ? 20 : total < 100 ? 12 : 6
  res.json({
    enough: true,
    percentileRange: percentile != null ? [Math.max(1, percentile - band), Math.min(99, percentile + band)] : null,
    trend: delta > 3 ? 'improving' : delta < -3 ? 'declining' : 'steady',
    recentAccuracy: recentAcc != null ? Math.round(recentAcc * 10) / 10 : null,
    sampleSize: total,
    disclaimer: 'Yeh sirf Aisepadho par tumhare accuracy, speed aur trend se ek rough ESTIMATE hai — koi official exam rank ka prediction nahi hai. Jitne zyada tests doge, utna reliable hoga.'
  })
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
