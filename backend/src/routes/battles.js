import { Router } from 'express'
import { authRequired } from '../middleware/auth.js'
import { assertCanBattle, createRoom, joinRoom, quickMatch, submitAnswer, roomState, tickRoom, myBattles, leaderboard, battlesEnabled } from '../utils/battles.js'

// ---------------------------------------------------------------------------
// 1v1 Quiz Battles (#6). Feature-flagged (features.battles); realtime-feel
// lifecycle over polling: create/join -> rounds with 20s windows -> ELO.
// ---------------------------------------------------------------------------

const router = Router()
router.use(authRequired)

async function requireFlag(_req, res, next) {
  if (!(await battlesEnabled())) return res.status(403).json({ error: 'Battles are currently disabled.' })
  next()
}

// GET /api/battles — my battles + leaderboard + quota
router.get('/', requireFlag, async (req, res) => {
  const [mine, gate] = await Promise.all([myBattles(req.user.id), assertCanBattle(req.user.id)])
  res.json({ battles: mine, quota: { unlimited: Boolean(gate.unlimited), used: gate.used ?? null, limit: gate.limit ?? null } })
})

// GET /api/battles/leaderboard?examId=
router.get('/leaderboard', requireFlag, async (req, res) => {
  const rows = await leaderboard(req.query.examId ? Number(req.query.examId) : null)
  res.json({ leaderboard: rows })
})

// POST /api/battles/quick-match — join an open room or create one
router.post('/quick-match', requireFlag, async (req, res) => {
  const examId = Number(req.body?.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const out = await quickMatch({ userId: req.user.id, examId })
  if (out.error) return res.status(out.upgrade ? 402 : 400).json(out)
  res.status(201).json(out)
})

// POST /api/battles/invite — create an invite-code room for a friend
router.post('/invite', requireFlag, async (req, res) => {
  const examId = Number(req.body?.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const out = await createRoom({ userId: req.user.id, examId, rounds: req.body?.rounds, inviteOnly: true })
  if (out.error) return res.status(out.upgrade ? 402 : 400).json(out)
  res.status(201).json(out)
})

// POST /api/battles/join — join by code or room id
router.post('/join', requireFlag, async (req, res) => {
  const { roomId, joinCode } = req.body || {}
  if (!roomId && !joinCode) return res.status(400).json({ error: 'roomId or joinCode required' })
  const out = await joinRoom({ userId: req.user.id, roomId: roomId ? Number(roomId) : null, joinCode })
  if (out.error) return res.status(out.upgrade ? 402 : 400).json(out)
  res.json(out)
})

// GET /api/battles/:id/state — poll room state (drives the whole UI)
router.get('/:id/state', requireFlag, async (req, res) => {
  await tickRoom(Number(req.params.id)) // expire rounds / finish battles on poll
  const s = await roomState({ roomId: Number(req.params.id), userId: req.user.id })
  if (!s) return res.status(404).json({ error: 'Battle not found' })
  if (s.forbidden) return res.status(403).json({ error: 'Not a player in this battle' })
  res.json(s)
})

// POST /api/battles/:id/answer — answer the current round
router.post('/:id/answer', requireFlag, async (req, res) => {
  const roomId = Number(req.params.id)
  const roundNo = Number(req.body?.roundNo)
  if (!roundNo) return res.status(400).json({ error: 'roundNo required' })
  const out = await submitAnswer({ roomId, userId: req.user.id, roundNo, selected: req.body?.selected })
  if (out.error) return res.status(400).json(out)
  res.json(out)
})

export default router
