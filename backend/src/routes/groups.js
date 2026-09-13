import { Router } from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { getGroupConfig, listMyGroups, createGroup, joinGroup, leaveGroup,
  isGroupMember, groupDetail, messagesSince, postGroupMessage, recomputeGroupEntitlements, canCreateGroup } from '../utils/groups.js'
import { awardPoints } from '../utils/points.js'

// ---------------------------------------------------------------------------
// Group Study & Discussions API. Feature-flagged from Admin → AI Config:
//   features.groupStudy / features.groupDiscussions. When off, all endpoints
//   return 403 and the nav item/page is hidden from students (dynamic UI).
// ---------------------------------------------------------------------------

const router = Router()
router.use(authRequired)

async function requireFlag(req, res, next) {
  const cfg = await getGroupConfig()
  if (!cfg.enabled) return res.status(403).json({ error: 'Group Study is currently disabled.' })
  next()
}

// GET /api/groups — my groups + deal config + flags (drives the page UI)
router.get('/', requireFlag, async (req, res) => {
  const [groups, cfg] = await Promise.all([listMyGroups(req.user.id), getGroupConfig()])
  res.json({
    groups,
    deal: { freeAfterPaid: cfg.freeAfterPaid, freeSlots: cfg.freeSlots, maxFree: cfg.maxFree, maxMembers: cfg.maxMembers },
    flags: { discussions: cfg.discussionsEnabled },
    canCreate: await canCreatePayload(req.user.id)
  })
})

async function canCreatePayload(userId) {
  const { canCreateGroup } = await import('../utils/groups.js')
  return canCreateGroup(userId)
}

// POST /api/groups — create a group (free tier limit per paid status)
router.post('/', requireFlag, async (req, res) => {
  const b = req.body || {}
  const name = String(b.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Group name required' })
  const { allowed, limit, paid } = await canCreateGroup(req.user.id)
  if (!allowed) return res.status(402).json({ error: `Limit reached (${limit} groups). ${paid ? 'Ye limit paid users ke liye bhi fix hai.' : 'Paid plan lo ya existing group delete karke try karo.'}`, upgrade: !paid })
  const kind = b.kind === 'discussion' ? 'discussion' : 'study'
  if (kind === 'discussion' && !(await getGroupConfig()).discussionsEnabled) {
    return res.status(403).json({ error: 'Group Discussions add-on is currently disabled.' })
  }
  const { groupId, code } = await createGroup({ ownerId: req.user.id, name, examId: b.examId || null, kind })
  await awardPoints(req.user.id, 'group_created', { dedupe: `group:${groupId}` })
  res.status(201).json({ groupId, joinCode: code })
})

// POST /api/groups/join
router.post('/join', requireFlag, async (req, res) => {
  const code = String(req.body?.code || '').trim().toUpperCase()
  if (!code) return res.status(400).json({ error: 'Join code required' })
  const out = await joinGroup({ userId: req.user.id, code })
  if (out.error) return res.status(out.error.includes('full') ? 409 : 404).json({ error: out.error })
  if (!out.already) await awardPoints(req.user.id, 'group_joined', { dedupe: `gj:${out.groupId}:${req.user.id}` })
  res.json({ ok: true, groupId: out.groupId, already: Boolean(out.already), deal: out.deal })
})

// GET /api/groups/:id — detail incl. members, deal progress, messages
router.get('/:id', requireFlag, async (req, res) => {
  const d = await groupDetail({ groupId: Number(req.params.id), userId: req.user.id })
  if (!d) return res.status(404).json({ error: 'Group not found' })
  if (d.forbidden) return res.status(403).json({ error: 'Not a member of this group' })
  res.json(d)
})

// GET /api/groups/:id/messages?after=<id> — poll for new messages
router.get('/:id/messages', requireFlag, async (req, res) => {
  const cfg = await getGroupConfig()
  if (!cfg.discussionsEnabled) return res.status(403).json({ error: 'Group Discussions is currently disabled.' })
  const groupId = Number(req.params.id)
  if (!(await isGroupMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member' })
  const msgs = await messagesSince(groupId, req.query.after)
  res.json({ messages: msgs })
})

// POST /api/groups/:id/messages — send (discussions add-on OR free seat OR paid)
router.post('/:id/messages', requireFlag, async (req, res) => {
  const cfg = await getGroupConfig()
  if (!cfg.discussionsEnabled) return res.status(403).json({ error: 'Group Discussions is currently disabled.' })
  const groupId = Number(req.params.id)
  if (!(await isGroupMember(groupId, req.user.id))) return res.status(403).json({ error: 'Not a member' })
  const ent = await import('../utils/addons.js').then((m) => m.getEntitlements(req.user.id))
  const hasChatAccess = ent.retention || ent.aiPower || ent.addons.some((a) => a.id === 'group_discussions')
  if (!hasChatAccess) {
    return res.status(402).json({ error: 'Discussion chat needs the Discussions add-on, a paid plan, or a free group seat.', upgrade: true })
  }
  const out = await postGroupMessage({ groupId, userId: req.user.id, body: req.body?.body })
  if (out.error) return res.status(400).json({ error: out.error })
  await awardPoints(req.user.id, 'group_message')
  res.status(201).json({ id: out.id })
})

// POST /api/groups/:id/leave
router.post('/:id/leave', requireFlag, async (req, res) => {
  const out = await leaveGroup({ userId: req.user.id, groupId: Number(req.params.id) })
  if (out.error) return res.status(400).json({ error: out.error })
  res.json(out)
})

// ------------------------------- admin -------------------------------------

// POST /api/groups/admin/recompute/:id — re-run the deal engine for a group
router.post('/admin/recompute/:id', authRequired, adminOnly, async (req, res) => {
  const out = await recomputeGroupEntitlements(Number(req.params.id))
  res.json({ ok: true, ...out })
})

export default router
