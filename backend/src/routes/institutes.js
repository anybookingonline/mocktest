import { Router } from 'express'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import {
  listInstitutes, createInstitute, updateInstitute, getInstitute,
  createInvite, listInvites, toggleInvite, checkInvite,
  addSubAdmin, bulkCreateStudents, instituteStudents, instituteStats, resolveBranding, notifyLinked
} from '../utils/institute.js'

// ---------------------------------------------------------------------------
// Coaching / School white-label (B2B).
//   Platform admin: /api/institutes/admin/*  (create institutes, invite codes,
//                    sub-admins, plan management)
//   Institute sub-admin (role=admin + institute_id): /api/institutes/me/*
//                    (their students, stats, CSV import, branding)
//   Public:         /api/institutes/public/*  (invite check, branding resolve)
// ---------------------------------------------------------------------------

const router = Router()

// ------------------------------ public --------------------------------------

// GET /api/institutes/public/invite?code=SCH-XXXX — register page validation
router.get('/public/invite', async (req, res) => {
  const out = await checkInvite(req.query.code)
  res.json(out)
})

// GET /api/institutes/public/branding — resolve platform name/colors for this
// request (custom domain, or ?sch= invite code on the shared domain).
// Also returns the platform's own branding (name/tagline/logo/support email)
// so the whole app — landing, login, tab title, favicon — rebrands from
// Admin → Settings without a redeploy. instituteId is included when resolved
// so signed-in users can be shown their institute's name.
router.get('/public/branding', async (req, res) => {
  const host = req.headers['x-forwarded-host'] || req.headers.host || null
  const out = await resolveBranding({ host, inviteCode: req.query.sch || null })
  const get = async (k) => (await db.prepare('SELECT value FROM ai_configs WHERE key = ?').get(k))?.value || null
  res.json({
    ...out,
    platformName: out.platformName || (await get('platform.name')) || 'Aisepadho',
    tagline: out.tagline || (await get('platform.tagline')) || 'Padho. Test do. Aage badho.',
    supportEmail: await get('platform.supportEmail'),
    logoUrl: out.logoUrl || (await get('platform.logoUrl')),
    domain: await get('platform.domain')
  })
})

// --------------------------- platform admin ---------------------------------

const platformAdmin = Router()
platformAdmin.use(authRequired, adminOnly)

// GET /api/institutes/admin/institutes
platformAdmin.get('/institutes', async (_req, res) => {
  res.json({ institutes: await listInstitutes() })
})

platformAdmin.post('/institutes', async (req, res) => {
  const out = await createInstitute({ name: req.body?.name, contactEmail: req.body?.contactEmail, planDays: req.body?.planDays, kind: req.body?.kind })
  if (out.error) return res.status(400).json(out)
  res.status(201).json(out)
})

platformAdmin.put('/institutes/:id', async (req, res) => {
  const out = await updateInstitute(req.params.id, req.body || {})
  if (out.error) return res.status(400).json(out)
  res.json(out)
})

platformAdmin.post('/institutes/:id/invites', async (req, res) => {
  const out = await createInvite(req.params.id, { label: req.body?.label, maxUses: req.body?.maxUses })
  res.status(201).json(out)
})

platformAdmin.get('/institutes/:id/invites', async (req, res) => {
  res.json({ invites: await listInvites(req.params.id) })
})

platformAdmin.post('/institutes/:id/invites/:inviteId/toggle', async (req, res) => {
  const inv = await db.prepare('SELECT is_active FROM institute_invites WHERE id = ? AND institute_id = ?').get(Number(req.params.inviteId), Number(req.params.id))
  if (!inv) return res.status(404).json({ error: 'Invite not found' })
  const next = req.body?.active != null ? (req.body.active ? 1 : 0) : (Number(inv.is_active) ? 0 : 1)
  res.json(await toggleInvite(req.params.inviteId, Boolean(next)))
})

platformAdmin.post('/institutes/:id/subadmin', async (req, res) => {
  const out = await addSubAdmin({ instituteId: req.params.id, name: req.body?.name, email: req.body?.email, password: req.body?.password })
  if (out.error) return res.status(400).json(out)
  // Best-effort Telegram DM — if the institute owner already linked the bot,
  // they get their login credentials right in chat (never stored in chat
  // history of students, only their own).
  notifyLinked(out.userId, `🏫 Aapko ${out.instituteName || 'institute'} ka admin access diya gaya hai.\nLogin: aapki app/website\nEmail: ${out.email}\nPassword: (jo admin ne set kiya)\n\nLogin ke baad password zaroor change karna.`).catch(() => {})
  res.status(201).json(out)
})

platformAdmin.get('/institutes/:id/students', async (req, res) => {
  res.json({ students: await instituteStudents(req.params.id) })
})

platformAdmin.get('/institutes/:id/stats', async (req, res) => {
  res.json(await instituteStats(req.params.id))
})

// --------------------------- institute sub-admin ----------------------------

const me = Router()
me.use(authRequired, adminOnly)

// Scope guard: sub-admins must belong to an institute. Platform admins
// (institute_id IS NULL) may also pass ?instituteId= to manage any institute.
me.use(async (req, res, next) => {
  if (req.user.institute_id) {
    req.instituteId = Number(req.user.institute_id)
    return next()
  }
  const requested = Number(req.query.instituteId || req.body?.instituteId || 0)
  if (requested) {
    req.instituteId = requested
    return next()
  }
  return res.status(400).json({ error: 'No institute linked to this admin. Platform admins can pass ?instituteId=.' })
})

// GET /api/institutes/me — institute profile + headline stats
me.get('/', async (req, res) => {
  const inst = await getInstitute(req.instituteId)
  if (!inst) return res.status(404).json({ error: 'Institute not found' })
  res.json({ institute: inst, stats: await instituteStats(req.instituteId) })
})

me.get('/stats', async (req, res) => {
  res.json(await instituteStats(req.instituteId))
})

me.get('/students', async (req, res) => {
  res.json({ students: await instituteStudents(req.instituteId) })
})

me.get('/invites', async (req, res) => {
  res.json({ invites: await listInvites(req.instituteId) })
})

me.post('/invites', async (req, res) => {
  const out = await createInvite(req.instituteId, { label: req.body?.label, maxUses: req.body?.maxUses })
  res.status(201).json(out)
})

// Pause/resume an invite (body: { active: true|false } or toggles when absent).
// Ownership check: the invite MUST belong to the caller's institute — prevents
// a sub-admin pausing a rival institute's registration code (IDOR).
me.post('/invites/:id/toggle', async (req, res) => {
  const inv = await db.prepare('SELECT is_active FROM institute_invites WHERE id = ? AND institute_id = ?').get(Number(req.params.id), Number(req.instituteId))
  if (!inv) return res.status(404).json({ error: 'Invite not found' })
  const next = req.body?.active != null ? (req.body.active ? 1 : 0) : (Number(inv.is_active) ? 0 : 1)
  res.json(await toggleInvite(req.params.id, Boolean(next)))
})

me.post('/students/bulk', async (req, res) => {
  const out = await bulkCreateStudents({ instituteId: req.instituteId, csv: req.body?.csv })
  res.json(out)
})

me.put('/branding', async (req, res) => {
  const patch = req.body || {}
  // Sub-admins may set branding only. plan/plan_until/status are business
  // fields; custom_domain is reserved for the PLATFORM admin — otherwise a
  // sub-admin could claim the platform's own domain and hijack the main
  // site's branding resolution.
  delete patch.plan
  delete patch.plan_until
  delete patch.status
  delete patch.custom_domain
  const out = await updateInstitute(req.instituteId, patch)
  if (out.error) return res.status(400).json(out)
  res.json(out)
})

router.use('/admin', platformAdmin)
router.use('/me', me)

export default router
