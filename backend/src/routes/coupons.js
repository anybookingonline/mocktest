import { Router } from 'express'
import db from '../db.js'
import { authRequired, platformOnly } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { createCoupon, updateCoupon, deleteCoupon, listCoupons, previewCoupon, redeemCoupon } from '../utils/coupons.js'
import { ADDONS } from '../utils/addons.js'

const router = Router()

// ---- Platform-admin management (sub-admins get 403 via platformOnly) ------
router.get('/admin/list', authRequired, platformOnly, async (req, res) => {
  res.json(await listCoupons())
})

router.post('/admin', authRequired, platformOnly, async (req, res) => {
  try {
    const c = await createCoupon(req.body || {})
    res.status(201).json(c)
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

router.put('/admin/:id', authRequired, platformOnly, async (req, res) => {
  try {
    res.json(await updateCoupon(Number(req.params.id), req.body || {}))
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

router.delete('/admin/:id', authRequired, platformOnly, async (req, res) => {
  try {
    res.json(await deleteCoupon(Number(req.params.id)))
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

// Add-on catalog for the coupon-builder dropdown (ids + names only).
router.get('/admin/addons', authRequired, platformOnly, async (req, res) => {
  res.json({ addons: Object.values(ADDONS).map((a) => ({ id: a.id, name: a.name })) })
})

// ---- Student side ----------------------------------------------------------
// Public validity preview — rate-limited (no auth) so codes can't be
// brute-forced cheaply; returns only a label, never internals.
router.get('/check', rateLimit({ key: 'coupon-check', windowSec: 60, max: 20, message: 'Too many coupon checks. Please wait a minute.' }), async (req, res) => {
  res.json(await previewCoupon(req.query.code))
})

// Redeem — authRequired (one account = one redemption identity) + strict
// limiter bucketed PER USER (authRequired runs first, so req.user is set).
// Per-user (not per-IP) so a hostel NAT can't lock everyone out together.
router.post('/redeem', authRequired, rateLimit({
  key: 'coupon-redeem', windowSec: 60, max: 8,
  keyFn: (req) => (req.user?.id ? `u${req.user.id}` : ''),
  message: 'Too many redemption attempts. Please wait a minute.'
}), async (req, res) => {
  try {
    const out = await redeemCoupon(req.user.id, (req.body || {}).code)
    res.json({ ok: true, ...out })
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message })
  }
})

// Campaign summary for the student's own redemptions ("pro unlocked" feed).
router.get('/mine', authRequired, async (req, res) => {
  const rows = await db.prepare(`SELECT c.code, c.kind, c.days, c.addon_id, c.source, r.created_at
    FROM coupon_redemptions r JOIN coupons c ON c.id = r.coupon_id
    WHERE r.user_id = ? ORDER BY r.id DESC LIMIT 50`).all(req.user.id)
  res.json({ items: rows })
})

export default router
