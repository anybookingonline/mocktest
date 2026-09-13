import db from '../db.js'
import crypto from 'crypto'
import bcrypt from 'bcryptjs'

// ---------------------------------------------------------------------------
// Coaching / School white-label (B2B SaaS).
//
// An institute (coaching or school) gets:
//   - its own branding (name, tagline, colors, logo, optional custom domain)
//   - invite codes: students register with the code and land in the institute
//   - a sub-admin role: admins with institute_id manage ONLY their students
//   - bulk CSV student creation for classrooms
//   - a per-institute analytics view (students, tests, avg score, activity)
//
// The platform admin creates institutes and invite codes; everything else is
// self-serve for the institute's sub-admin. Rebranding is served through a
// tiny public branding endpoint that resolves by custom domain or invite code.
// ---------------------------------------------------------------------------

function instituteCode(name) {
  const base = String(name || 'inst').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'INST'
  return `${base}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
}

export async function listInstitutes() {
  return db.prepare(`
    SELECT i.*,
      (SELECT COUNT(*) FROM users u WHERE u.institute_id = i.id AND u.role = 'student') students,
      (SELECT COUNT(*) FROM institute_invites v WHERE v.institute_id = i.id AND v.is_active = 1) invites
    FROM institutes i ORDER BY i.id DESC`).all()
}

export async function createInstitute({ name, contactEmail, planDays = 30 }) {
  const clean = String(name || '').trim()
  if (!clean) return { error: 'Institute name required' }
  const code = instituteCode(clean)
  const until = new Date(Date.now() + (Number(planDays) || 30) * 86400000).toISOString().replace('T', ' ').slice(0, 19)
  const r = await db.prepare(`INSERT INTO institutes (name, code, contact_email, plan, plan_until, status, created_at)
    VALUES (?, ?, ?, 'trial', ?, 'active', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`)
    .run(clean, code, contactEmail || null, until)
  return { instituteId: Number(r.lastInsertRowid), code }
}

export async function updateInstitute(id, patch = {}) {
  const allowed = ['name', 'contact_email', 'plan', 'plan_until', 'platform_name', 'tagline',
    'primary_color', 'accent_color', 'logo_url', 'custom_domain', 'status']
  const sets = []
  const vals = []
  for (const [k, v] of Object.entries(patch)) {
    if (allowed.includes(k) && v !== undefined && v !== null && v !== '') {
      sets.push(`${k} = ?`)
      vals.push(String(v))
    }
  }
  if (!sets.length) return { error: 'Nothing to update' }
  await db.prepare(`UPDATE institutes SET ${sets.join(', ')} WHERE id = ?`).run(...vals, Number(id))
  return getInstitute(id)
}

export async function getInstitute(id) {
  return db.prepare('SELECT * FROM institutes WHERE id = ?').get(Number(id))
}

// ----------------------------- invites --------------------------------------

export async function createInvite(instituteId, { label, maxUses = 0 } = {}) {
  const code = `SCH-${crypto.randomBytes(4).toString('hex').toUpperCase()}`
  const r = await db.prepare(`INSERT INTO institute_invites (institute_id, code, label, max_uses, is_active, created_at)
    VALUES (?, ?, ?, ?, 1, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`)
    .run(Number(instituteId), code, label || null, Number(maxUses) || 0)
  return { inviteId: Number(r.lastInsertRowid), code }
}

export async function listInvites(instituteId) {
  return db.prepare(`SELECT v.*, (SELECT COUNT(*) FROM users u WHERE u.institute_id = v.institute_id) students
    FROM institute_invites v WHERE v.institute_id = ? ORDER BY v.id DESC`).all(Number(instituteId))
}

export async function toggleInvite(inviteId, active) {
  await db.prepare('UPDATE institute_invites SET is_active = ? WHERE id = ?').run(active ? 1 : 0, Number(inviteId))
  return { ok: true }
}

// Validates an invite for the public register page (no auth).
export async function checkInvite(code) {
  const inv = await db.prepare('SELECT * FROM institute_invites WHERE code = ? AND is_active = 1').get(String(code || '').toUpperCase())
  if (!inv) return { valid: false }
  const inst = await getInstitute(inv.institute_id)
  if (!inst || inst.status !== 'active') return { valid: false }
  if (Number(inv.max_uses) > 0 && Number(inv.used_count) >= Number(inv.max_uses)) return { valid: false }
  return { valid: true, institute: { id: inst.id, name: inst.name, platformName: inst.platform_name || inst.name } }
}

// Consumes an invite during /api/auth/register (called from auth route).
export async function consumeInvite({ userId, code }) {
  const check = await checkInvite(code)
  if (!check.valid) return { ok: false, error: 'Invalid or exhausted invite code' }
  await db.prepare('UPDATE users SET institute_id = ? WHERE id = ?').run(check.institute.id, Number(userId))
  await db.prepare('UPDATE institute_invites SET used_count = used_count + 1 WHERE id = (SELECT id FROM institute_invites WHERE code = ?)').run(String(code).toUpperCase())
  return { ok: true, institute: check.institute }
}

// ----------------------------- sub-admins -----------------------------------

export async function addSubAdmin({ instituteId, name, email, password }) {
  const clean = String(email || '').toLowerCase().trim()
  if (!clean || !password) return { error: 'email + password required' }
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(clean)
  if (exists) return { error: 'Email already registered' }
  const hash = bcrypt.hashSync(String(password), 10)
  const r = await db.prepare(`INSERT INTO users (name, email, password_hash, role, institute_id)
    VALUES (?, ?, ?, 'admin', ?)`).run(name || 'Institute Admin', clean, hash, Number(instituteId))
  return { userId: Number(r.lastInsertRowid) }
}

export async function bulkCreateStudents({ instituteId, csv }) {
  // CSV rows: name,email,password  (header optional, comma/semicolon separated)
  const lines = String(csv || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  let created = 0
  const skipped = []
  for (const line of lines) {
    const parts = line.split(/[,;]/).map((p) => p.trim())
    if (parts.length < 3) continue
    const [name, email, password] = parts
    if (!name || !email || !password || /name/i.test(name)) continue
    const clean = email.toLowerCase()
    const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(clean)
    if (exists) { skipped.push(clean); continue }
    const hash = bcrypt.hashSync(password, 10)
    await db.prepare(`INSERT INTO users (name, email, password_hash, role, institute_id)
      VALUES (?, ?, ?, 'student', ?)`).run(name.slice(0, 80), clean, hash, Number(instituteId))
    created += 1
  }
  return { created, skipped }
}

export async function instituteStudents(instituteId) {
  const rows = await db.prepare(`SELECT u.id, u.name, u.email, u.created_at,
    (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id AND a.status='completed') tests_taken,
    (SELECT COALESCE(AVG(a.score),0) FROM attempts a WHERE a.user_id = u.id AND a.status='completed') avg_score,
    (SELECT COALESCE(AVG(a.accuracy),0) FROM attempts a WHERE a.user_id = u.id AND a.status='completed') avg_accuracy
    FROM users u WHERE u.institute_id = ? AND u.role = 'student' ORDER BY u.created_at DESC LIMIT 500`).all(Number(instituteId))
  // Round in JS — portable across Postgres flavors (AVG types vary).
  return rows.map((r) => ({ ...r, avg_score: Math.round(Number(r.avg_score) || 0), avg_accuracy: Math.round(Number(r.avg_accuracy) || 0) }))
}

export async function instituteStats(instituteId) {
  const s = (q, ...p) => db.prepare(q).get(...p)
  const students = await s(`SELECT COUNT(*) c FROM users WHERE institute_id = ? AND role='student'`, Number(instituteId))
  const active7 = await s(`SELECT COUNT(DISTINCT a.user_id) c FROM attempts a JOIN users u ON u.id = a.user_id
    WHERE u.institute_id = ? AND a.started_at::timestamptz > now() - interval '7 days'`, Number(instituteId))
  const tests = await s(`SELECT COUNT(*) c FROM attempts a JOIN users u ON u.id = a.user_id
    WHERE u.institute_id = ? AND a.status='completed'`, Number(instituteId))
  const avg = await s(`SELECT COALESCE(AVG(a.accuracy),0) c FROM attempts a JOIN users u ON u.id = a.user_id
    WHERE u.institute_id = ? AND a.status='completed'`, Number(instituteId))
  const weak = await db.prepare(`SELECT t.name topic, s.name subject,
    SUM(ts.attempts) attempts, SUM(ts.correct) correct
    FROM topic_stats ts
    JOIN users u ON u.id = ts.user_id
    JOIN topics t ON t.id = ts.topic_id
    JOIN chapters c ON c.id = t.chapter_id
    JOIN subjects s ON s.id = c.subject_id
    WHERE u.institute_id = ?
    GROUP BY t.id, t.name, s.name
    HAVING SUM(ts.attempts) >= 5`).all(Number(instituteId))
  return {
    students: Number(students?.c) || 0,
    activeLast7: Number(active7?.c) || 0,
    testsCompleted: Number(tests?.c) || 0,
    avgAccuracy: Math.round(Number(avg?.c) || 0),
    weakTopics: weak
      .map((w) => ({ ...w, accuracy: w.attempts ? Math.round((w.correct / w.attempts) * 100) : 0 }))
      .sort((a, b) => a.accuracy - b.accuracy)
      .slice(0, 8)
  }
}

// Scope guard: platform admins (no institute_id) see everything; sub-admins
// (role=admin + institute_id) are hard-scoped to their institute.
export function isInstituteAdmin(user) {
  return Boolean(user?.role === 'admin' && user?.institute_id)
}

// ----------------------------- public branding -------------------------------

// Resolve branding for a request: custom domain match first, else platform
// defaults. The register page (?sch=CODE) also passes the invite code.
export async function resolveBranding({ host = null, inviteCode = null }) {
  let inst = null
  if (inviteCode) {
    const check = await checkInvite(inviteCode)
    if (check.valid) inst = await getInstitute(check.institute.id)
  }
  if (!inst && host) {
    inst = await db.prepare(`SELECT * FROM institutes WHERE LOWER(custom_domain) = LOWER(?) AND status = 'active' LIMIT 1`)
      .get(String(host).split(':')[0]) || null
  }
  const platform = await db.prepare(`SELECT value FROM ai_configs WHERE key = 'platform.name'`).get()
  if (!inst) {
    return {
      institute: null,
      platformName: platform?.value || 'ExamAI',
      tagline: null,
      primaryColor: null,
      accentColor: null,
      logoUrl: null,
      inviteCode: inviteCode || null
    }
  }
  return {
    institute: { id: inst.id, name: inst.name, code: inst.code },
    platformName: inst.platform_name || inst.name,
    tagline: inst.tagline || null,
    primaryColor: inst.primary_color || null,
    accentColor: inst.accent_color || null,
    logoUrl: inst.logo_url || null,
    inviteCode: inviteCode || null
  }
}
