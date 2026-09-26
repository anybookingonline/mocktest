import { Router } from 'express'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { dueRevision, startRevisionMock, generateDoubtMock, runRevisionCron, recordTopicOutcome } from '../utils/revision.js'
import { solveDoubtWithAI, generateFlashcardsWithAI } from '../utils/aiTasks.js'
import { aiLimiter } from '../middleware/rateLimit.js'
import db from '../db.js'

// ---------------------------------------------------------------------------
// Spaced Revision (#7) + Doubt Revision (#4) routes.
// ---------------------------------------------------------------------------

const router = Router()

// GET /api/revision/cron?secret=... — daily cron (secret-protected; NO JWT —
// external cron runners call this). Decay stale boxes + Telegram nudges.
router.get('/cron', async (req, res) => {
  const secret = process.env.CRON_SECRET
  if (!secret) return res.status(403).json({ error: 'CRON_SECRET not configured' })
  if (String(req.query.secret || '') !== secret) return res.status(401).json({ error: 'Invalid secret' })
  const out = await runRevisionCron()
  res.json({ ok: true, ...out })
})

router.use(authRequired)

// GET /api/revision/due — today's "ye revise karo" list (forgetting curve)
router.get('/due', async (req, res) => {
  const due = await dueRevision(req.user.id, { limit: 12 })
  res.json({ due })
})

// POST /api/revision/start — one-click 10-Q mixed revision mock
router.post('/start', async (req, res) => {
  const out = await startRevisionMock(req.user.id)
  if (out.empty) return res.status(404).json({ error: 'Aaj kuch due nahi hai — practice karte raho! 🎉' })
  res.status(201).json(out)
})

// POST /api/revision/doubt-mock — generate 3 similar questions for a doubt (#4)
router.post('/doubt-mock', async (req, res) => {
  const doubtId = Number(req.body?.doubtId)
  if (!doubtId) return res.status(400).json({ error: 'doubtId required' })
  const out = await generateDoubtMock({ doubtId, userId: req.user.id })
  if (out.error) return res.status(400).json({ error: out.error })
  res.status(201).json(out)
})

// GET /api/revision/flashcards/:topicId — AI-generated recall cards for a topic
router.get('/flashcards/:topicId', aiLimiter(), async (req, res) => {
  const row = await db.prepare(`
    SELECT t.id, t.name AS topic_name, c.name AS chapter_name, s.name AS subject_name, s.exam_id
    FROM topics t JOIN chapters c ON c.id = t.chapter_id JOIN subjects s ON s.id = c.subject_id
    WHERE t.id = ?
  `).get(Number(req.params.topicId))
  if (!row) return res.status(404).json({ error: 'Topic not found' })
  try {
    const exam = row.exam_id ? await db.prepare('SELECT * FROM exams WHERE id = ?').get(row.exam_id) : null
    const cards = await generateFlashcardsWithAI({ topicName: row.topic_name, chapterName: row.chapter_name, subjectName: row.subject_name, exam })
    if (!cards.length) return res.status(502).json({ error: 'AI could not generate flashcards for this topic. Try again.' })
    res.json({ cards, topic: row.topic_name })
  } catch (e) {
    res.status(502).json({ error: 'AI request failed: ' + e.message })
  }
})

// POST /api/revision/flashcard-result — "Got it" / "Still learning" feeds the
// SAME Leitner box the test-based revision engine uses, so flashcard review
// and test practice both move a topic through the same forgetting-curve state.
router.post('/flashcard-result', async (req, res) => {
  const topicId = Number(req.body?.topicId)
  if (!topicId) return res.status(400).json({ error: 'topicId required' })
  await recordTopicOutcome(req.user.id, topicId, Boolean(req.body?.gotIt))
  res.json({ ok: true })
})

// POST /api/revision/admin/run-cron (admin manual trigger)
router.post('/admin/run-cron', adminOnly, async (_req, res) => {
  const out = await runRevisionCron()
  res.json({ ok: true, ...out })
})

export default router
