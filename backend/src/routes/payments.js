import { Router } from 'express'
import crypto from 'crypto'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { authRequired, adminOnly, platformOnly } from '../middleware/auth.js'
import { loadMonetizationConfig, loadGatewayConfig, GATEWAYS, getRetentionStatus, activateRetention } from '../utils/retention.js'
import { listPlans as listAddonPlans, ADDONS, activateAddon } from '../utils/addons.js'
import { b2Configured, putFile } from '../utils/b2.js'
import { getConfig } from '../utils/aiService.js'
import { sendPaymentReceiptEmail } from '../utils/email.js'

const router = Router()

const PLAN_ID = 'retention_1y'
const API_URL = process.env.BACKEND_URL || 'https://aisepadho.com'
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://www.aisepadho.com'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads')
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true })

const proofUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => cb(null, `proof-${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname || '.png').toLowerCase()}`)
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype) || /\.(png|jpe?g|webp|gif)$/i.test(file.originalname)) cb(null, true)
    else cb(new Error('Only image files are allowed (PNG/JPG/WEBP/GIF)'))
  }
})

function toDateStr(d) {
  return d.toISOString().replace('T', ' ').slice(0, 19)
}

// GET /api/payments/plans - plan listing (retention + paid add-ons) with enabled gateways
router.get('/plans', async (req, res) => {
  const cfg = await loadMonetizationConfig()
  const catalog = await listAddonPlans()
  res.json({
    plans: [...catalog.plans.map((p) => ({ ...p, currency: cfg.currency })), ...catalog.addons.map((a) => ({ ...a, currency: cfg.currency, kind: 'addon' }))],
    addons: catalog.addons.map((a) => ({ ...a, currency: cfg.currency, kind: 'addon' })),
    provider: cfg.provider,
    gateways: cfg.gateways.map((g) => ({ id: g, label: GATEWAYS[g]?.label || g, icon: GATEWAYS[g]?.icon || '🔗' }))
  })
})

// GET /api/payments/my - current user retention + add-on entitlements
// ---------------------------------------------------------------------------
// Invoice + receipt plumbing. Assign a human-readable invoice number the first
// time a payment reaches status='success' (any of the 3 success paths), then
// fire the receipt email best-effort. Never throws into the payment flow.
// ---------------------------------------------------------------------------
async function finalizeSuccessfulPayment(pay) {
  try {
    let invoiceNo = pay.invoice_no
    if (!invoiceNo) {
      const year = new Date().getFullYear()
      const c = await db.prepare('SELECT COUNT(*) c FROM payments WHERE invoice_no IS NOT NULL').get()
      invoiceNo = `AP-${year}-${String(Number(c.c) + 1).padStart(6, '0')}`
      await db.prepare('UPDATE payments SET invoice_no = ? WHERE id = ?').run(invoiceNo, pay.id)
    }
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(pay.user_id)
    if (user?.email) sendPaymentReceiptEmail(user, { ...pay, invoice_no: invoiceNo }).catch(() => {})
    return invoiceNo
  } catch (e) {
    console.error('[payments] invoice/email finalize error:', e.message)
    return null
  }
}

// GET /api/payments/my/invoice/:paymentId — print/PDF-ready invoice (HTML)
router.get('/my/invoice/:paymentId', authRequired, async (req, res) => {
  const pay = await db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(Number(req.params.paymentId), req.user.id)
  if (!pay) return res.status(404).json({ error: 'Payment not found' })
  if (pay.status !== 'success') return res.status(400).json({ error: 'Invoice only available for successful payments' })
  let invoiceNo = pay.invoice_no
  if (!invoiceNo) invoiceNo = await finalizeSuccessfulPayment(pay)
  const rows = await db.prepare(`SELECT name, email FROM users WHERE id = ?`).all(pay.user_id)
  const buyer = rows[0] || {}
  const d = new Date(pay.created_at || Date.now())
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
  const inr = (n, cur = 'INR') => cur === 'INR' ? `₹${Number(n || 0).toLocaleString('en-IN')}` : `${cur} ${n}`
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Invoice ${esc(invoiceNo)}</title></head>
  <body style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:32px auto;padding:0 16px;color:#0f172a;">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px;">
      <div><span style="font-size:24px;font-weight:800;">Aisepadho</span><div style="color:#64748b;font-size:12px;">Padho. Test do. Aage badho.</div></div>
      <div style="text-align:right;font-size:13px;color:#334155;"><b style="font-size:17px;">INVOICE</b><br>${esc(invoiceNo)}<br>${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</div>
    </div>
    <div style="font-size:13px;color:#334155;margin-bottom:20px;"><b>Billed to</b><br>${esc(buyer.name)}<br>${esc(buyer.email)}</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <tr style="background:#f1f5f9;"><th style="text-align:left;padding:10px 12px;">Description</th><th style="text-align:right;padding:10px 12px;">Amount</th></tr>
      <tr><td style="padding:12px;border-bottom:1px solid #e2e8f0;">${esc(String(pay.plan))} plan — Aisepadho subscription (1 year)</td><td style="text-align:right;padding:12px;border-bottom:1px solid #e2e8f0;font-weight:600;">${inr(pay.amount, pay.currency)}</td></tr>
    </table>
    <div style="text-align:right;margin-top:14px;font-size:15px;"><b>Total: ${inr(pay.amount, pay.currency)}</b></div>
    <div style="margin-top:28px;font-size:12px;color:#64748b;">
      Payment reference: ${esc(String(pay.provider_ref || pay.txn_ref || pay.id))} · Provider: ${esc(String(pay.provider))}<br>
      Ye ek computer-generated invoice hai. GST invoice ke liye support@aisepadho.com par contact karein.
    </div>
  </body></html>`)
})

// ---------------------------------------------------------------------------
// Refund Policy (see /refund-policy on the site): add-ons and the group-plan
// seat are ALWAYS non-refundable, no exceptions. The base plan is refundable
// within 15 days of payment. Coupon-granted access never creates a `payments`
// row at all (redeemCoupon() in coupons.js grants entitlement directly,
// ₹0 changes hands), so it's already outside this table — nothing to refund.
// ---------------------------------------------------------------------------
const REFUND_WINDOW_DAYS = 15

function refundEligibility(pay) {
  if (pay.status !== 'success') return { eligible: false, reason: 'Only completed payments are refundable.' }
  if (pay.refund_status && pay.refund_status !== 'none') return { eligible: false, reason: `Refund already ${pay.refund_status}.` }
  if (ADDONS[pay.plan] || isGroupPlan(pay.plan)) {
    return { eligible: false, reason: 'Add-on and group-plan purchases are non-refundable.' }
  }
  const paidAt = new Date(String(pay.created_at).replace(' ', 'T') + 'Z')
  const ageDays = (Date.now() - paidAt.getTime()) / 86400000
  if (ageDays > REFUND_WINDOW_DAYS) {
    return { eligible: false, reason: `Refund window (${REFUND_WINDOW_DAYS} days) has expired.` }
  }
  return { eligible: true, reason: null }
}

router.get('/my', authRequired, async (req, res) => {
  const ret = await getRetentionStatus(req.user.id)
  const { getEntitlements } = await import('../utils/addons.js')
  const entitlements = await getEntitlements(req.user.id)
  const history = await db.prepare(`SELECT id, provider, amount, currency, plan, status, invoice_no, created_at, refund_status, refund_note
    FROM payments WHERE user_id = ? ORDER BY id DESC LIMIT 20`).all(req.user.id)
  for (const h of history) {
    const e = refundEligibility(h)
    h.refund_eligible = e.eligible
    h.refund_ineligible_reason = e.eligible ? null : e.reason
  }
  res.json({ ...ret, ...entitlements, history })
})

// POST /api/payments/my/refund-request/:paymentId — student requests a refund
router.post('/my/refund-request/:paymentId', authRequired, async (req, res) => {
  const pay = await db.prepare('SELECT * FROM payments WHERE id = ? AND user_id = ?').get(Number(req.params.paymentId), req.user.id)
  if (!pay) return res.status(404).json({ error: 'Payment not found' })
  const { eligible, reason } = refundEligibility(pay)
  if (!eligible) return res.status(400).json({ error: reason })
  await db.prepare(`UPDATE payments SET refund_status = 'requested', refund_requested_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS'), refund_reason = ? WHERE id = ?`)
    .run(String(req.body?.reason || '').slice(0, 500), pay.id)
  res.json({ ok: true, message: 'Refund request submitted. Our team will review it and get back to you.' })
})

// POST /api/payments/create-order
router.post('/create-order', authRequired, async (req, res) => {
  const { plan = PLAN_ID, gateway } = req.body || {}
  const cfg = await loadMonetizationConfig()
  const provider = gateway || cfg.provider
  if (!cfg.gateways.includes(provider)) {
    return res.status(400).json({ error: `Payment gateway "${provider}" is not enabled. Ask admin to enable it.` })
  }

  // Add-on plans price themselves; the retention plan uses the global price
  const addonMeta = ADDONS[plan]
  const amount = addonMeta ? Number(await getConfig(addonMeta.priceKey, String(addonMeta.defaultPrice))) : Number(cfg.price)
  const gwCfg = await loadGatewayConfig(provider)

  if (provider === 'razorpay') {
    if (!gwCfg.keyId || !gwCfg.keySecret) return res.status(400).json({ error: 'Razorpay is not configured. Ask admin to set the Razorpay key pair.' })
    const order = await razorpayCreateOrder({ keyId: gwCfg.keyId, keySecret: gwCfg.keySecret, amount, currency: cfg.currency, receipt: `${plan}_${req.user.id}_${Date.now()}` })
    await insertPayment({ userId: req.user.id, provider, amount, currency: cfg.currency, plan, ref: order.id })
    return res.json({ provider, orderId: order.id, keyId: gwCfg.keyId, plan, amount, currency: cfg.currency, name: req.user.name, email: req.user.email })
  }

  if (provider === 'stripe') {
    if (!gwCfg.secretKey) return res.status(400).json({ error: 'Stripe is not configured. Ask admin to set the Stripe secret key.' })
    const session = await stripeCreateCheckout({ secret: gwCfg.secretKey, amount, currency: cfg.currency, userId: req.user.id, plan, productName: addonMeta ? `ExamAI ${addonMeta.name}` : 'ExamAI 1-Year Data Retention' })
    await insertPayment({ userId: req.user.id, provider, amount, currency: cfg.currency, plan, ref: session.id })
    return res.json({ provider, checkoutUrl: session.url, orderId: session.id, plan, amount, currency: cfg.currency })
  }

  if (provider === 'phonepe') {
    if (!gwCfg.merchantId || !gwCfg.saltKey) return res.status(400).json({ error: 'PhonePe is not configured. Ask admin to set Merchant ID and Salt Key.' })
    const pp = await phonepeCreatePayment({ cfg: gwCfg, amount, currency: cfg.currency, userId: req.user.id, plan })
    await insertPayment({ userId: req.user.id, provider, amount, currency: cfg.currency, plan, ref: pp.merchantTransactionId })
    return res.json({ provider, orderId: pp.merchantTransactionId, redirectUrl: pp.redirectUrl, plan, amount, currency: cfg.currency })
  }

  if (provider === 'qr') {
    if (!gwCfg.upiId && !gwCfg.qrImage) return res.status(400).json({ error: 'Custom QR is not configured. Ask admin to set the UPI ID or upload a QR image.' })
    const ref = `QR${Date.now()}${Math.floor(Math.random() * 1000)}`
    await insertPayment({ userId: req.user.id, provider, amount, currency: cfg.currency, plan, ref })
    return res.json({
      provider, orderId: ref, plan, amount, currency: cfg.currency,
      qr: { upiId: gwCfg.upiId || '', qrImage: gwCfg.qrImage || '', holderName: gwCfg.holderName || '', note: gwCfg.note || '' }
    })
  }

  return res.status(400).json({ error: `Unknown payment provider: ${provider}` })
})

// POST /api/payments/verify - gateway verification + activation
router.post('/verify', authRequired, async (req, res) => {
  const body = req.body || {}
  const { provider = 'razorpay' } = body

  if (provider === 'razorpay') {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = body
    if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
      return res.status(400).json({ error: 'Missing payment details' })
    }
    const gwCfg = await loadGatewayConfig('razorpay')
    if (!gwCfg.keySecret) return res.status(400).json({ error: 'Razorpay is not configured' })
    const expected = crypto.createHmac('sha256', gwCfg.keySecret)
      .update(`${razorpay_order_id}|${razorpay_payment_id}`)
      .digest('hex')
    if (expected !== razorpay_signature) return res.status(400).json({ error: 'Payment verification failed' })
    return completeAndRespond(res, req.user.id, 'razorpay', razorpay_order_id)
  }

  if (provider === 'phonepe') {
    const { orderId } = body
    if (!orderId) return res.status(400).json({ error: 'Missing orderId' })
    const gwCfg = await loadGatewayConfig('phonepe')
    if (!gwCfg.merchantId || !gwCfg.saltKey) return res.status(400).json({ error: 'PhonePe is not configured' })
    const st = await phonepeCheckStatus({ cfg: gwCfg, merchantTransactionId: orderId })
    if (st.completed) return completeAndRespond(res, req.user.id, 'phonepe', orderId)
    return res.json({ active: false, status: st.state || 'PENDING', message: st.message })
  }

  return res.status(400).json({ error: `No auto-verification for provider "${provider}"` })
})

async function completeAndRespond(res, userId, provider, ref) {
  const pay = await db.prepare('SELECT * FROM payments WHERE provider_ref = ? AND provider = ? AND status = ?').get(ref, provider, 'pending')
  if (!pay) return res.status(404).json({ error: 'Order not found' })
  if (pay.user_id !== userId) return res.status(403).json({ error: 'Order does not belong to this user' })
  await db.prepare(`UPDATE payments SET status = 'success' WHERE id = ?`).run(pay.id)
  finalizeSuccessfulPayment({ ...pay, status: 'success' }) // invoice + receipt email (best-effort)
  if (isGroupPlan(pay.plan)) {
    const out = await activateGroupPlan(pay)
    return res.json({ active: true, addon: 'group_discussions', group: out })
  }
  if (ADDONS[pay.plan]) {
    const until = await activateAddon(userId, pay.plan)
    return res.json({ active: true, retainUntil: until, addon: pay.plan })
  }
  const retainUntil = await activateRetention(userId, pay.plan)
  res.json({ active: true, retainUntil })
}

// POST /api/payments/qr/confirm - user reports a manual QR/UPI payment
router.post('/qr/confirm', authRequired, async (req, res) => {
  const { orderId, txnRef, payerName } = req.body || {}
  if (!orderId) return res.status(400).json({ error: 'orderId required' })
  const pay = await db.prepare('SELECT * FROM payments WHERE provider_ref = ? AND provider = ? AND user_id = ?').get(String(orderId), 'qr', req.user.id)
  if (!pay) return res.status(404).json({ error: 'Order not found' })
  if (pay.status !== 'pending') return res.status(400).json({ error: 'Order is not pending' })
  await db.prepare('UPDATE payments SET txn_ref = ?, payer_name = ? WHERE id = ?').run(String(txnRef || ''), String(payerName || ''), pay.id)
  res.json({ ok: true, message: 'Payment reported. Admin will verify and activate your retention shortly.' })
})

// POST /api/payments/qr/proof - upload payment screenshot (manual QR/UPI proof)
router.post('/qr/proof', authRequired, proofUpload.single('file'), async (req, res) => {
  const { orderId, txnRef, payerName } = req.body || {}
  if (!orderId) {
    if (req.file) fs.unlink(req.file.path, () => {})
    return res.status(400).json({ error: 'orderId required' })
  }
  const pay = await db.prepare('SELECT * FROM payments WHERE provider_ref = ? AND provider = ? AND user_id = ?').get(String(orderId), 'qr', req.user.id)
  if (!pay) {
    if (req.file) fs.unlink(req.file.path, () => {})
    return res.status(404).json({ error: 'Order not found' })
  }
  if (pay.status !== 'pending') {
    if (req.file) fs.unlink(req.file.path, () => {})
    return res.status(400).json({ error: 'Order is not pending' })
  }
  let proofPath = req.file ? `/uploads/${req.file.filename}` : pay.payment_proof
  // Archive the proof to B2 when configured and swap in the public URL
  if (req.file && await b2Configured()) {
    try {
      const url = await putFile(req.file.path, { prefix: 'payment-proofs', filename: req.file.filename, contentType: req.file.mimetype })
      if (url) proofPath = url
    } catch (e) { console.error('[b2] proof upload failed:', e.message) }
  }
  await db.prepare('UPDATE payments SET payment_proof = ?, txn_ref = ?, payer_name = ? WHERE id = ?')
    .run(proofPath, String(txnRef || pay.txn_ref || ''), String(payerName || pay.payer_name || ''), pay.id)
  res.json({ ok: true, message: 'Payment screenshot saved. Admin will verify and activate your retention shortly.' })
})

// POST /api/payments/webhook - Stripe / Razorpay / PhonePe webhook
router.post('/webhook', expressRaw(), async (req, res) => {
  const signature = req.headers['stripe-signature']
  if (signature) {
    const secret = await getConfig('stripe.webhookSecret')
    if (!secret) return res.status(400).json({ error: 'Stripe webhook not configured' })
    let event
    try {
      event = stripeVerifyWebhook({ payload: req.rawBody, signature, secret })
    } catch (e) {
      return res.status(400).json({ error: 'Invalid signature' })
    }
    if (event.type === 'checkout.session.completed') {
      await completePayment('stripe', event.data.object.id)
    }
    return res.json({ received: true })
  }

  const phonepeVerify = req.headers['x-verify']
  if (phonepeVerify && req.rawBody && isBase64(req.rawBody.trim())) {
    const gwCfg = await loadGatewayConfig('phonepe')
    if (gwCfg.saltKey) {
      const expected = crypto.createHmac('sha256', req.rawBody.trim() + '/pg/v3/pay' + gwCfg.saltKey).digest('hex') + '###' + (gwCfg.saltIndex || '1')
      if (expected === phonepeVerify) {
        try {
          const data = JSON.parse(Buffer.from(req.rawBody.trim(), 'base64').toString('utf8'))
          const txnId = data?.data?.merchantTransactionId
          const state = data?.data?.state || data?.data?.responseCode
          if (txnId && (state === 'COMPLETED' || state === 'PAYMENT_SUCCESS')) {
            await completePayment('phonepe', txnId)
          }
        } catch { /* ignore malformed callback */ }
      }
    }
    return res.json({ received: true })
  }

  const body = req.body || {}
  if (body.event === 'payment.captured' || body.event === 'order.paid') {
    const orderId = body.payload?.payment?.entity?.order_id || body.payload?.order?.entity?.id
    if (orderId) await completePayment('razorpay', orderId)
  }
  return res.json({ received: true })
})

async function insertPayment({ userId, provider, amount, currency, plan, ref }) {
  await db.prepare(`INSERT INTO payments (user_id, provider, amount, currency, plan, provider_ref, status)
    VALUES (?, ?, ?, ?, ?, ?, 'pending')`).run(userId, provider, amount, currency, plan, ref)
}

async function completePayment(provider, ref) {
  const pay = await db.prepare('SELECT * FROM payments WHERE provider_ref = ? AND provider = ? AND status = ?').get(ref, provider, 'pending')
  if (!pay) return
  await db.prepare(`UPDATE payments SET status = 'success' WHERE id = ?`).run(pay.id)
  finalizeSuccessfulPayment({ ...pay, status: 'success' }) // invoice + receipt email (best-effort)
  if (isGroupPlan(pay.plan)) await activateGroupPlan(pay)
  else if (ADDONS[pay.plan]) await activateAddon(pay.user_id, pay.plan)
  else await activateRetention(pay.user_id, pay.plan)
}

// Group discussions plan: "group_discussions:<groupId>". Paying marks the
// buyer as a paid member of that group and re-runs the free-seat deal engine.
function isGroupPlan(plan) {
  return /^group_discussions:\d+$/.test(String(plan || ''))
}

async function activateGroupPlan(pay) {
  const groupId = Number(String(pay.plan).split(':')[1])
  const g = await db.prepare('SELECT id FROM group_orders WHERE id = ?').get(groupId)
  if (!g) throw new Error('Group not found for this payment')
  // Group plan costs the same as the retention plan: the buyer gets their own
  // paid membership too (data retention), plus a paid seat in the group.
  await activateRetention(pay.user_id, 'retention_1y')
  const { markMemberPaid } = await import('../utils/groups.js')
  return markMemberPaid(groupId, pay.user_id, pay.id)
}

// GET /api/payments/admin/refunds - refund requests needing attention
router.get('/admin/refunds', authRequired, platformOnly, async (req, res) => {
  const rows = await db.prepare(`SELECT p.id, u.email, p.amount, p.currency, p.plan, p.provider, p.invoice_no,
      p.refund_status, p.refund_reason, p.refund_requested_at, p.refund_note, p.refund_processed_at, p.created_at
    FROM payments p JOIN users u ON u.id = p.user_id
    WHERE p.refund_status != 'none'
    ORDER BY p.refund_requested_at DESC LIMIT 100`).all()
  res.json({ refunds: rows })
})

// POST /api/payments/admin/refunds/:paymentId - approve/reject/mark-refunded
// NOTE: this only updates our own records — it does NOT call the payment
// gateway's refund API. Admin still has to actually move the money back via
// the Razorpay/Stripe/PhonePe dashboard (or bank transfer for QR/UPI), then
// mark it here as 'refunded' for bookkeeping. Access/entitlement is left
// untouched — revoke it separately if the policy calls for that.
router.post('/admin/refunds/:paymentId', authRequired, platformOnly, async (req, res) => {
  const { action, note } = req.body || {}
  if (!['approve', 'reject', 'mark-refunded'].includes(action)) return res.status(400).json({ error: 'action must be approve, reject or mark-refunded' })
  const pay = await db.prepare('SELECT * FROM payments WHERE id = ?').get(Number(req.params.paymentId))
  if (!pay) return res.status(404).json({ error: 'Payment not found' })
  const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'refunded'
  await db.prepare(`UPDATE payments SET refund_status = ?, refund_note = ?, refund_processed_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`)
    .run(nextStatus, String(note || '').slice(0, 500), pay.id)
  res.json({ ok: true, refund_status: nextStatus })
})

// GET /api/payments/admin/status - admin view of retention & payments
router.get('/admin/status', authRequired, platformOnly, async (req, res) => {
  const payments = await db.prepare(`SELECT p.id, u.email, p.amount, p.currency, p.plan, p.provider, p.txn_ref, p.payer_name, p.payment_proof, p.status, p.created_at
    FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 50`).all()
  const retentions = await db.prepare(`SELECT r.user_id, u.email, r.plan, r.retain_until, r.created_at
    FROM user_retention r JOIN users u ON u.id = r.user_id ORDER BY r.retain_until DESC LIMIT 50`).all()
  const pendingCount = payments.filter((p) => p.status === 'pending').length
  res.json({ payments, retentions, pendingCount })
})

// POST /api/payments/admin/mark-paid - confirm a manual QR/UPI payment
router.post('/admin/mark-paid', authRequired, platformOnly, async (req, res) => {
  const { paymentId } = req.body || {}
  if (!paymentId) return res.status(400).json({ error: 'paymentId required' })
  const pay = await db.prepare('SELECT * FROM payments WHERE id = ? AND status = ?').get(paymentId, 'pending')
  if (!pay) return res.status(404).json({ error: 'Pending payment not found' })
  await db.prepare(`UPDATE payments SET status = 'success' WHERE id = ?`).run(pay.id)
  finalizeSuccessfulPayment({ ...pay, status: 'success' }) // invoice + receipt email (best-effort)
  if (isGroupPlan(pay.plan)) {
    const out = await activateGroupPlan(pay)
    return res.json({ ok: true, addon: 'group_discussions', group: out })
  }
  if (ADDONS[pay.plan]) {
    const addonUntil = await activateAddon(pay.user_id, pay.plan)
    return res.json({ ok: true, retainUntil: addonUntil, addon: pay.plan })
  }
  const retainUntil = await activateRetention(pay.user_id, pay.plan)
  res.json({ ok: true, retainUntil })
})

// POST /api/payments/admin/activate - manual activation (offline billing)
router.post('/admin/activate', authRequired, platformOnly, async (req, res) => {
  const { email, days } = req.body || {}
  if (!email) return res.status(400).json({ error: 'email required' })
  const user = await db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase())
  if (!user) return res.status(404).json({ error: 'User not found' })
  const cur = await getRetentionStatus(user.id)
  const base = cur.active && cur.retainUntil ? new Date(cur.retainUntil.replace(' ', 'T') + 'Z') : new Date()
  const until = new Date(base.getTime() + (Number(days) || 365) * 86400000)
  await db.prepare(`INSERT INTO user_retention (user_id, retain_until, plan, created_at)
    VALUES (?, ?, 'retention_1y', to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (user_id) DO UPDATE SET retain_until = excluded.retain_until`).run(user.id, toDateStr(until))
  res.json({ ok: true, retainUntil: toDateStr(until) })
})

// --------------------------- provider helpers ------------------------------

async function razorpayCreateOrder({ keyId, keySecret, amount, currency, receipt }) {
  const res = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Basic ' + Buffer.from(`${keyId}:${keySecret}`).toString('base64')
    },
    body: JSON.stringify({ amount: Math.round(amount * 100), currency, receipt })
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.description || `Razorpay error ${res.status}`)
  return data
}

async function stripeCreateCheckout({ secret, amount, currency, userId, plan, productName = 'ExamAI 1-Year Data Retention' }) {
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Bearer ${secret}`
    },
    body: new URLSearchParams({
      'mode': 'payment',
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': String(currency).toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)),
      'line_items[0][price_data][product_data][name]': productName,
      'success_url': `${FRONTEND_URL}/retention?paid=success&gw=stripe`,
      'cancel_url': `${FRONTEND_URL}/retention?paid=cancelled&gw=stripe`,
      'client_reference_id': String(userId),
      'metadata[plan]': plan
    }).toString()
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.message || `Stripe error ${res.status}`)
  return data
}

function phonepeBaseUrl(cfg) {
  if (cfg.baseUrl) return cfg.baseUrl
  return cfg.env === 'UAT' ? 'https://mercury-t2.phonepe.com' : 'https://api.phonepe.com/apis/hermes'
}

async function phonepeCreatePayment({ cfg, amount, currency, userId, plan }) {
  const merchantTransactionId = `MT${Date.now()}${Math.floor(Math.random() * 1000000)}`.slice(0, 24)
  const payload = {
    merchantId: cfg.merchantId,
    merchantTransactionId,
    merchantUserId: String(userId),
    amount: Math.round(amount * 100),
    currency: currency === 'INR' ? 'INR' : currency,
    merchantOrderId: `ret_${userId}_${Date.now()}`,
    redirectUrl: `${FRONTEND_URL}/retention?paid=success&gw=phonepe&txn=${merchantTransactionId}`,
    redirectMode: 'GET',
    callbackUrl: `${API_URL}/api/payments/webhook`,
    paymentInstrument: { type: 'PAY_PAGE' }
  }
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64')
  const xVerify = crypto.createHmac('sha256', base64Payload + '/pg/v3/pay' + cfg.saltKey).digest('hex') + '###' + (cfg.saltIndex || '1')
  const res = await fetch(`${phonepeBaseUrl(cfg)}/pg/v3/pay`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-VERIFY': xVerify },
    body: JSON.stringify(payload)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok || !data.success) {
    throw new Error(data.message || `PhonePe error ${res.status}`)
  }
  const redirectUrl = data?.data?.instrumentResponse?.redirectInfo?.url
  if (!redirectUrl) throw new Error('PhonePe did not return a checkout URL')
  return { merchantTransactionId, redirectUrl }
}

async function phonepeCheckStatus({ cfg, merchantTransactionId }) {
  const baseUrl = phonepeBaseUrl(cfg)
  const xVerify = crypto.createHmac('sha256', '/pg/v3/status/' + cfg.merchantId + '/' + merchantTransactionId + cfg.saltKey).digest('hex') + '###' + (cfg.saltIndex || '1')
  const res = await fetch(`${baseUrl}/pg/v3/status/${cfg.merchantId}/${merchantTransactionId}`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', 'X-VERIFY': xVerify }
  })
  const data = await res.json().catch(() => ({}))
  const state = data?.data?.state || data?.code || ''
  const responseCode = data?.data?.responseCode || ''
  return {
    completed: state === 'COMPLETED' || responseCode === 'PAYMENT_SUCCESS',
    state,
    message: data?.message || ''
  }
}

function stripeVerifyWebhook({ payload, signature, secret }) {
  const expected = crypto.createHmac('sha256', secret).update(payload, 'utf8').digest('hex')
  const parts = signature.split(',').map((p) => p.trim())
  const ts = parts.find((p) => p.startsWith('t='))?.slice(2)
  const sig = parts.find((p) => p.startsWith('v1='))?.slice(3)
  if (!sig || !ts) throw new Error('missing signature parts')
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) throw new Error('timestamp too old')
  if (crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    return JSON.parse(payload)
  }
  throw new Error('signature mismatch')
}

function isBase64(str) {
  return /^[A-Za-z0-9+/=\s]+$/.test(str) && str.length > 0
}

function expressRaw() {
  return (req, res, next) => {
    let chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const buf = Buffer.concat(chunks)
      req.rawBody = buf.toString('utf8')
      req.body = {}
      try { req.body = JSON.parse(req.rawBody) } catch { /* not json */ }
      next()
    })
  }
}

export default router
