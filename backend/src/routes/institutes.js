import { Router } from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { uploadLimiter } from '../middleware/rateLimit.js'
import {
  listInstitutes, createInstitute, updateInstitute, getInstitute,
  createInvite, listInvites, toggleInvite, checkInvite,
  addSubAdmin, bulkCreateStudents, instituteStudents, instituteStats, resolveBranding, notifyLinked
} from '../utils/institute.js'
import { processPdf } from './import.js'
import { stageExtractedQuestions, approveStagedQuestions, rejectStagedQuestions } from '../utils/aiTasks.js'
import { hashContent } from '../utils/aiService.js'
import { b2Configured, putFile } from '../utils/b2.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

// Same constraints as the platform-admin import route (30 MB, PDF only).
const pdfUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `${Date.now()}-inst-${file.originalname.replace(/[^\w.\-]/g, '_')}`)
  }),
  limits: { fileSize: 30 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf' || /\.pdf$/i.test(file.originalname)) cb(null, true)
    else cb(new Error('Only PDF files are allowed'))
  }
})

// First day of the current month as a TEXT timestamp — created_at columns are
// stored as 'YYYY-MM-DD HH24:MI:SS' text, so lexicographic comparison works
// across both real Postgres and the pg-mem audit suites.
function monthStart() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01 00:00:00`
}

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
  // Optional pilot cost guardrail set at creation time (0 = unlimited)
  if (req.body?.aiDailyQuota != null && Number(req.body.aiDailyQuota) > 0) {
    await db.prepare('UPDATE institutes SET ai_daily_quota = ? WHERE id = ?').run(Number(req.body.aiDailyQuota), Number(out.instituteId))
  }
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

// PUT per-institute daily AI quota (0 = unlimited) — pilot loss guardrail
platformAdmin.put('/institutes/:id/ai-quota', async (req, res) => {
  const quota = Math.max(0, Number(req.body?.aiDailyQuota) || 0)
  await db.prepare('UPDATE institutes SET ai_daily_quota = ? WHERE id = ?').run(quota, Number(req.params.id))
  res.json({ ok: true, ai_daily_quota: quota })
})

// PUT per-institute MONTHLY PDF import quota (0 = sub-admin upload disabled).
// Each import costs ~₹5–15 of AI (Gemini Vision + DeepSeek), so this is the
// school self-serve content pipeline's cost guardrail.
platformAdmin.put('/institutes/:id/import-quota', async (req, res) => {
  const quota = Math.max(0, Math.round(Number(req.body?.aiImportQuota) || 0))
  await db.prepare('UPDATE institutes SET ai_import_quota = ? WHERE id = ?').run(quota, Number(req.params.id))
  res.json({ ok: true, ai_import_quota: quota })
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
  // ai_daily_quota is the platform's cost guardrail — only the platform admin
  // (PUT /admin/institutes/:id/ai-quota) may change it. Otherwise a sub-admin
  // could silently lift their own pilot quota to unlimited.
  delete patch.ai_daily_quota
  // Same for the monthly PDF import quota (platform pays the AI bill for
  // extraction — the school may not grant itself more of it).
  delete patch.ai_import_quota
  const out = await updateInstitute(req.instituteId, patch)
  if (out.error) return res.status(400).json(out)
  res.json(out)
})

// ---------------------------------------------------------------------------
// Institute self-serve PDF import — the school/coaching sub-admin uploads their
// OWN papers (Class 8 unit tests, term exams, coaching modules) straight into
// the platform. Same Gemini Vision + DeepSeek pipeline as the platform-admin
// import, but gated by:
//   1. Monthly import quota (institutes.ai_import_quota; 0 = disabled) — each
//      extraction costs ~₹5–15 of AI, so the school buys quota, not compute.
//   2. Global file-hash dedup — the same paper never processes twice and a
//      duplicate does NOT consume quota.
//   3. Institute scoping — imports are tagged institute_id and only that
//      institute (and the platform admin) can list them.
// ---------------------------------------------------------------------------

// GET /api/institutes/me/pdf-imports — usage + last 50 institute imports
me.get('/pdf-imports', async (req, res) => {
  const inst = await db.prepare('SELECT ai_import_quota FROM institutes WHERE id = ?').get(req.instituteId)
  const rows = await db.prepare(`SELECT id, filename, status, questions_created, error, review_required, created_at
    FROM pdf_imports WHERE institute_id = ? ORDER BY id DESC LIMIT 50`).all(req.instituteId)
  const used = await db.prepare(`SELECT COUNT(*) c FROM pdf_imports
    WHERE institute_id = ? AND created_at >= ?`).get(req.instituteId, monthStart())
  // Pending review counts per import (for the review banner on each row)
  const pending = await db.prepare(`SELECT import_id, COUNT(*) c FROM pdf_question_staging
    WHERE institute_id = ? AND status = 'pending' GROUP BY import_id`).all(req.instituteId)
  const pendingByImport = Object.fromEntries(pending.map((p) => [Number(p.import_id), Number(p.c)]))
  res.json({
    imports: rows,
    quota: Number(inst?.ai_import_quota) || 0,
    usedThisMonth: Number(used?.c) || 0,
    pendingByImport
  })
})

// ---------------------------------------------------------------------------
// Phase 3 — review queue endpoints. All hard-scoped to the caller's institute
// (IDOR-safe: every query filters institute_id).
// ---------------------------------------------------------------------------

// GET /api/institutes/me/pdf-imports/:id/questions — staged rows of one import
me.get('/pdf-imports/:id/questions', async (req, res) => {
  const importRow = await db.prepare('SELECT id, filename, exam_id FROM pdf_imports WHERE id = ? AND institute_id = ?')
    .get(Number(req.params.id), req.instituteId)
  if (!importRow) return res.status(404).json({ error: 'Import not found' })
  const rows = await db.prepare(`SELECT * FROM pdf_question_staging WHERE import_id = ? ORDER BY id ASC`)
    .all(Number(req.params.id))
  res.json({ import: importRow, questions: rows })
})

// POST /api/institutes/me/pdf-imports/:id/review — approve/reject staged rows
// body: { action: 'approve' | 'reject', ids: [...] } — ids empty = everything
// still pending in this import ("approve all" / "reject all").
me.post('/pdf-imports/:id/review', async (req, res) => {
  const importRow = await db.prepare('SELECT id FROM pdf_imports WHERE id = ? AND institute_id = ?')
    .get(Number(req.params.id), req.instituteId)
  if (!importRow) return res.status(404).json({ error: 'Import not found' })
  const action = String(req.body?.action || '')
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : []
  let out
  if (action === 'approve') {
    let targetIds = ids
    if (!targetIds.length) {
      targetIds = (await db.prepare(`SELECT id FROM pdf_question_staging WHERE import_id = ? AND status = 'pending' AND duplicate = 0`)
        .all(Number(req.params.id))).map((r) => r.id)
    }
    out = await approveStagedQuestions(targetIds)
    // Import ka status: complete jab kuch bhi pending na bache
    const pendingLeft = await db.prepare(`SELECT COUNT(*) c FROM pdf_question_staging WHERE import_id = ? AND status = 'pending'`)
      .get(Number(req.params.id))
    if (Number(pendingLeft?.c) === 0) {
      await db.prepare(`UPDATE pdf_imports SET status = 'completed', questions_created = (SELECT COUNT(*) FROM pdf_question_staging WHERE import_id = ? AND status = 'approved' AND question_id IS NOT NULL) WHERE id = ?`)
        .run(Number(req.params.id), Number(req.params.id))
    }
    res.json({ ...out, message: `${out.created} questions publish hue (exam bank me live) — ${out.approved} rows approved.` })
  } else if (action === 'reject') {
    let targetIds = ids
    if (!targetIds.length) {
      targetIds = (await db.prepare(`SELECT id FROM pdf_question_staging WHERE import_id = ? AND status = 'pending'`)
        .all(Number(req.params.id))).map((r) => r.id)
    }
    out = await rejectStagedQuestions(targetIds)
    res.json({ ...out, message: `${out.rejected} questions reject ho gaye.` })
  } else {
    return res.status(400).json({ error: "action must be 'approve' or 'reject'" })
  }
})

// POST /api/institutes/me/pdf-import — upload one paper (multipart 'file' + examId)
me.post('/pdf-import', uploadLimiter(), pdfUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'PDF file required' })
  const examId = Number(req.body?.examId)
  if (!examId) return res.status(400).json({ error: 'examId required' })
  const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(examId)
  if (!exam) return res.status(404).json({ error: 'Exam not found' })

  const inst = await db.prepare('SELECT ai_import_quota FROM institutes WHERE id = ?').get(req.instituteId)
  const quota = Number(inst?.ai_import_quota) || 0
  if (!quota) {
    fs.unlink(req.file.path, () => {})
    return res.status(403).json({ error: 'PDF upload aapke institute ke liye enabled nahi hai — platform admin se monthly import quota activate karwaye.' })
  }
  const used = await db.prepare('SELECT COUNT(*) c FROM pdf_imports WHERE institute_id = ? AND created_at >= ?')
    .get(req.instituteId, monthStart())
  if (Number(used?.c) >= quota) {
    fs.unlink(req.file.path, () => {})
    return res.status(429).json({ error: `Is mahine ka import quota (${quota} papers) poori tarah use ho chuka hai — agle mahine try karein ya platform admin se quota badhwaye.` })
  }

  const buffer = fs.readFileSync(req.file.path)
  const fileHash = hashContent(buffer)
  // Reuse: same paper never processed twice (quota NOT consumed on dup).
  // Scope: only THIS institute's own completed import counts — another
  // school's copy of the same PDF has institute-private questions, so School B
  // still gets its own upload -> extract -> review -> own questions flow.
  const dup = await db.prepare(`SELECT * FROM pdf_imports WHERE file_hash = ? AND institute_id = ? AND status = 'completed'`).get(fileHash, req.instituteId)
  if (dup) {
    fs.unlink(req.file.path, () => {})
    return res.json({ reused: true, importId: dup.id, questions_created: dup.questions_created, message: 'Ye paper pehle hi import ho chuka hai — stored question bank use hoga, AI cost nahi laga.' })
  }

  // Durable archive copy in B2 when configured (same as platform import)
  let storageUrl = null
  if (await b2Configured()) {
    try {
      storageUrl = await putFile(req.file.path, { prefix: 'pdfs', filename: req.file.originalname, contentType: 'application/pdf' })
    } catch (e) {
      console.error('[b2] institute PDF archive failed:', e.message) // non-fatal
    }
  }

  const rec = await db.prepare(`INSERT INTO pdf_imports (exam_id, filename, file_path, file_hash, status, created_by, institute_id, review_required)
    VALUES (?,?,?,?,?,?,?,1)`).run(examId, req.file.originalname, storageUrl || req.file.path, fileHash, 'processing', req.user.id, req.instituteId)
  const importId = rec.lastInsertRowid

  res.status(202).json({ importId, message: 'PDF accept ho gaya. Processing background me chal rahi hai (Gemini Vision + DeepSeek) — questions pehle aapke review queue me aayenge, approve karne par question bank me publish honge.' })

  // Same AI pipeline as the platform-admin import, but the output goes to the
  // review queue (staging) instead of straight into the shared question bank.
  processPdf(importId, examId, buffer, req.file.path, { stageOnly: true, instituteId: req.instituteId }).catch(async e => {
    await db.prepare(`UPDATE pdf_imports SET status='failed', error=? WHERE id=?`).run(String(e.message || e).slice(0, 2000), importId)
  })
})

router.use('/admin', platformAdmin)
router.use('/me', me)

export default router
