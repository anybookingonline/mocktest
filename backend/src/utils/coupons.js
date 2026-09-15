import db from '../db.js'
import { ADDONS } from './addons.js'
import { awardPoints } from './points.js'

// ---------------------------------------------------------------------------
// Coupons — campaign codes for the social-media rollout. A coupon grants
// either base data-retention days or a specific add-on for N days. Every code
// carries: max total uses, per-user limit, expiry, and a free-text `source`
// (e.g. "instagram", "telegram") so each campaign's signups are attributable.
// Redemption extends the existing user_retention / user_addons rows — the
// same storage the payments flow uses, so entitlements never fork.
// ---------------------------------------------------------------------------

export function normalizeCode(raw) {
  return String(raw || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '')
}

function toDateStr(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

function normalizeExpiry(expiresAt) {
  if (!expiresAt) return null
  const d = new Date(expiresAt)
  if (Number.isNaN(d.getTime())) throw Object.assign(new Error('Invalid expiry date.'), { status: 400 })
  return toDateStr(d)
}

export async function createCoupon({ code, kind = 'retention', days = 365, addonId = null, source = '', maxUses = 0, perUserLimit = 1, expiresAt = null }) {
  const clean = normalizeCode(code)
  if (!/^[A-Z0-9][A-Z0-9-]{2,31}$/.test(clean)) {
    throw Object.assign(new Error('Code must be 3–32 characters: letters, numbers, dash (no spaces).'), { status: 400 })
  }
  const k = kind === 'addon' ? 'addon' : 'retention'
  const d = Math.max(1, Math.min(3650, Number(days) || 365))
  let addon = null
  if (k === 'addon') {
    addon = ADDONS[String(addonId || '')]
    if (!addon) throw Object.assign(new Error('Add-on coupon needs a valid add-on id.'), { status: 400 })
  }
  const dup = await db.prepare('SELECT id FROM coupons WHERE code = ?').get(clean)
  if (dup) throw Object.assign(new Error('This code already exists.'), { status: 409 })
  const r = await db.prepare(`INSERT INTO coupons (code, kind, days, addon_id, source, max_uses, per_user_limit, expires_at, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`).run(
    clean, k, d, k === 'addon' ? addon.id : null, String(source || '').slice(0, 64),
    Math.max(0, Number(maxUses) || 0), Math.max(1, Number(perUserLimit) || 1), normalizeExpiry(expiresAt))
  return { id: Number(r.lastInsertRowid), code: clean, kind: k, days: d, addonId: addon ? addon.id : null }
}

export async function updateCoupon(id, patch = {}) {
  const cur = await db.prepare('SELECT * FROM coupons WHERE id = ?').get(id)
  if (!cur) throw Object.assign(new Error('Coupon not found.'), { status: 404 })
  const next = {
    is_active: patch.is_active === undefined ? cur.is_active : (patch.is_active ? 1 : 0),
    max_uses: patch.max_uses === undefined ? cur.max_uses : Math.max(0, Number(patch.max_uses) || 0),
    per_user_limit: patch.per_user_limit === undefined ? cur.per_user_limit : Math.max(1, Number(patch.per_user_limit) || 1),
    days: patch.days === undefined ? cur.days : Math.max(1, Math.min(3650, Number(patch.days) || cur.days)),
    expires_at: patch.expires_at === undefined ? cur.expires_at : normalizeExpiry(patch.expires_at)
  }
  await db.prepare(`UPDATE coupons SET is_active = ?, max_uses = ?, per_user_limit = ?, days = ?, expires_at = ? WHERE id = ?`)
    .run(next.is_active, next.max_uses, next.per_user_limit, next.days, next.expires_at, id)
  return db.prepare('SELECT * FROM coupons WHERE id = ?').get(id)
}

export async function deleteCoupon(id) {
  const r = await db.prepare('DELETE FROM coupons WHERE id = ?').run(id)
  if (!Number(r.changes)) throw Object.assign(new Error('Coupon not found.'), { status: 404 })
  return { ok: true }
}

// Admin list with live usage + per-source campaign totals.
// (Two plain queries merged in JS — portable across pg-mem tests & Postgres.)
export async function listCoupons() {
  const rows = await db.prepare('SELECT * FROM coupons ORDER BY id DESC').all()
  const counts = await db.prepare('SELECT coupon_id, COUNT(*) AS redemptions, COUNT(DISTINCT user_id) AS unique_users FROM coupon_redemptions GROUP BY coupon_id').all()
  const byId = new Map(counts.map((r) => [Number(r.coupon_id), r]))
  const bySource = {}
  for (const c of rows) {
    const u = byId.get(Number(c.id))
    c.redemptions = Number(u?.redemptions) || 0
    c.unique_users = Number(u?.unique_users) || 0
    const s = c.source || '(none)'
    bySource[s] = bySource[s] || { source: s, codes: 0, redemptions: 0, uniqueUsers: 0 }
    bySource[s].codes += 1
    bySource[s].redemptions += c.redemptions
    bySource[s].uniqueUsers += c.unique_users
  }
  return { coupons: rows, bySource: Object.values(bySource) }
}

// Public-facing validity preview (no side effects) — used by the "check" API.
export async function previewCoupon(rawCode) {
  const code = normalizeCode(rawCode)
  if (!code) return { valid: false, message: 'Enter a coupon code.' }
  const c = await db.prepare('SELECT * FROM coupons WHERE code = ?').get(code)
  if (!c) return { valid: false, message: 'Invalid coupon code.' }
  if (!c.is_active) return { valid: false, message: 'This coupon is deactivated.' }
  if (c.expires_at && new Date(c.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    return { valid: false, message: 'This coupon has expired.' }
  }
  if (c.max_uses > 0 && Number(c.used_count) >= Number(c.max_uses)) {
    return { valid: false, message: 'This coupon is fully used.' }
  }
  const label = c.kind === 'addon' && ADDONS[c.addon_id] ? `${ADDONS[c.addon_id].name} (${c.days} days)` : `${c.days} days of Data Retention`
  return { valid: true, code, kind: c.kind, addonId: c.addon_id, days: c.days, label }
}

// Student-side redemption: atomic cap bump + redemption log + entitlement.
export async function redeemCoupon(userId, rawCode) {
  const code = normalizeCode(rawCode)
  const c = await db.prepare('SELECT * FROM coupons WHERE code = ?').get(code)
  if (!c) throw Object.assign(new Error('Invalid coupon code.'), { status: 404 })
  if (!c.is_active) throw Object.assign(new Error('This coupon is deactivated.'), { status: 400 })
  if (c.expires_at && new Date(c.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()) {
    throw Object.assign(new Error('This coupon has expired.'), { status: 400 })
  }
  const perUser = Math.max(1, Number(c.per_user_limit) || 1)
  const mine = await db.prepare('SELECT COUNT(*) AS c FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?').get(c.id, userId)
  if (Number(mine.c) >= perUser) {
    throw Object.assign(new Error(perUser === 1 ? 'You have already used this coupon.' : `You can use this coupon only ${perUser} times.`), { status: 400 })
  }
  // Atomic total-cap guard: fails when used_count has reached max_uses.
  const bump = await db.prepare('UPDATE coupons SET used_count = used_count + 1 WHERE id = ? AND (max_uses = 0 OR used_count < max_uses)').run(c.id)
  if (!Number(bump.changes)) throw Object.assign(new Error('This coupon is fully used.'), { status: 400 })
  await db.prepare('INSERT INTO coupon_redemptions (coupon_id, user_id) VALUES (?, ?)').run(c.id, userId)

  let grant
  if (c.kind === 'addon') {
    const until = await extendAddon(userId, c.addon_id, Number(c.days))
    grant = { kind: 'addon', addon: c.addon_id, until }
  } else {
    const until = await extendRetention(userId, Number(c.days), `coupon:${code}`)
    grant = { kind: 'retention', until }
  }
  await awardPoints(userId, 'coupon_redeemed', { points: 10, meta: { code: c.code, source: c.source }, dedupe: `coupon_redeemed:${c.id}:${userId}` })
  return { ...grant, code: c.code, source: c.source }
}

// Same storage/extensions as the payments flow (retention.js / addons.js) but
// with the coupon's own day-count instead of the global config value.
async function extendRetention(userId, days, planTag) {
  const cur = await db.prepare('SELECT retain_until FROM user_retention WHERE user_id = ?').get(userId)
  const base = cur && new Date(cur.retain_until.replace(' ', 'T') + 'Z') > new Date()
    ? new Date(cur.retain_until.replace(' ', 'T') + 'Z')
    : new Date()
  const untilStr = toDateStr(new Date(base.getTime() + days * 86400000))
  await db.prepare(`INSERT INTO user_retention (user_id, retain_until, plan, created_at)
    VALUES (?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (user_id) DO UPDATE SET retain_until = excluded.retain_until, plan = excluded.plan`).run(userId, untilStr, planTag)
  return untilStr
}

async function extendAddon(userId, addonId, days) {
  const existing = await db.prepare('SELECT expires_at FROM user_addons WHERE user_id = ? AND addon_id = ?').get(userId, addonId)
  const base = existing && new Date(existing.expires_at.replace(' ', 'T') + 'Z') > new Date()
    ? new Date(existing.expires_at.replace(' ', 'T') + 'Z')
    : new Date()
  const untilStr = toDateStr(new Date(base.getTime() + days * 86400000))
  await db.prepare(`INSERT INTO user_addons (user_id, addon_id, expires_at, created_at)
    VALUES (?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (user_id, addon_id) DO UPDATE SET expires_at = excluded.expires_at`).run(userId, addonId, untilStr)
  return untilStr
}
