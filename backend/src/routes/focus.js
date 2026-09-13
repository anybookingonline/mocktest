import { Router } from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { getFocusAreas, isFocusUnlocked } from '../utils/focus.js'
import { getConfig } from '../utils/aiService.js'

// ---------------------------------------------------------------------------
// AI Focus Areas (#3) — "topics most frequently asked in past years", ranked
// from the platform's own PYQ data (year/shift/topic). Pro-plan exclusive.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authRequired)

// GET /api/focus?examId=1 — ranked focus areas (cached 7d)
router.get('/', async (req, res) => {
  const examId = Number(req.query.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const unlocked = await isFocusUnlocked(req.user.id)
  if (!unlocked) {
    return res.status(402).json({ error: 'Focus Areas is a Pro feature — koi bhi paid plan (Retention / AI Power Pack) isko unlock karta hai.', upgrade: '/retention' })
  }
  try {
    const force = req.query.refresh === '1' && req.user.role === 'admin'
    const data = await getFocusAreas(examId, { force })
    res.json(data)
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /api/focus/status — which exams have PYQ data + cache freshness
router.get('/status', async (_req, res) => {
  const exams = await db.prepare(`SELECT e.id, e.name, COUNT(q.id) pyq_count FROM exams e
    LEFT JOIN questions q ON q.exam_id = e.id AND q.source = 'pdf' AND q.is_active = 1
    GROUP BY e.id, e.name HAVING COUNT(q.id) > 0 ORDER BY e.name`).all()
  res.json({ exams })
})

// POST /api/focus/refresh/:examId (admin) — force regenerate
router.post('/refresh/:examId', adminOnly, async (req, res) => {
  try {
    const data = await getFocusAreas(Number(req.params.examId), { force: true })
    res.json({ ok: true, count: data.areas?.length || 0 })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

export default router
