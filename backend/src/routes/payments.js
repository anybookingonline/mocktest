import { Router } from 'express'
import crypto from 'crypto'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from '../db.js'
import { authRequired, adminOnly } from '../middleware/auth.js'
import { loadMonetizationConfig, loadGatewayConfig, GATEWAYS, getRetentionStatus, activateRetention } from '../utils/retention.js'
import { getConfig } from '../utils/aiService.js'

const router = Router()

const PLAN_ID = 'retention_1y'
const API_URL = process.env.BACKEND_URL || 'http://localhost:3001'
const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

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

// GET /api/payments/plans - public plan listing with enabled gateways
router.get('/plans', async (req, res) => {
  const cfg = await loadMonetizationConfig()
  res.json({
    plans: [{
      id: PLAN_ID,
      name: '1-Year Data Retention',
      description: 'Keep all your tests, results, doubts and bookmarks for 1 year. Free accounts have their data auto-deleted after 24 hours.',
      price: cfg.price,
      currency: cfg.currency,
      retentionDays: cfg.retentionDays,
      freeHoldHours: cfg.freeHoldHours
    }],
    provider: cfg.provider,
    gateways: cfg.gateways.map((g) => ({ id: g, label: GATEWAYS[g]?.label || g, icon: GATEWAYS[g]?.icon || '🔗' }))
  })
})

// GET /api/payments/my - current user retention status
router.get('/my', authRequired, async (req, res) => {
  res.json(await getRetentionStatus(req.user.id))
})

// POST /api/payments/create-order
router.post('/create-order', authRequired, async (req, res) => {
  const { plan = PLAN_ID, gateway } = req.body || {}
  const cfg = await loadMonetizationConfig()
  const provider = gateway || cfg.provider
  if (!cfg.gateways.includes(provider)) {
    return res.status(400).json({ error: `Payment gateway "${provider}" is not enabled. Ask admin to enable it.` })
  }

  const amount = Number(cfg.price)
  const gwCfg = await loadGatewayConfig(provider)

  if (provider === 'razorpay') {
    if (!gwCfg.keyId || !gwCfg.keySecret) return res.status(400).json({ error: 'Razorpay is not configured. Ask admin to set the Razorpay key pair.' })
    const order = await razorpayCreateOrder({ keyId: gwCfg.keyId, keySecret: gwCfg.keySecret, amount, currency: cfg.currency, receipt: `ret_${req.user.id}_${Date.now()}` })
    await insertPayment({ userId: req.user.id, provider, amount, currency: cfg.currency, plan, ref: order.id })
    return res.json({ provider, orderId: order.id, keyId: gwCfg.keyId, plan, amount, currency: cfg.currency, name: req.user.name, email: req.user.email })
  }

  if (provider === 'stripe') {
    if (!gwCfg.secretKey) return res.status(400).json({ error: 'Stripe is not configured. Ask admin to set the Stripe secret key.' })
    const session = await stripeCreateCheckout({ secret: gwCfg.secretKey, amount, currency: cfg.currency, userId: req.user.id, plan })
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
  const proofPath = req.file ? `/uploads/${req.file.filename}` : pay.payment_proof
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
  await activateRetention(pay.user_id, pay.plan)
}

// GET /api/payments/admin/status - admin view of retention & payments
router.get('/admin/status', authRequired, adminOnly, async (req, res) => {
  const payments = await db.prepare(`SELECT p.id, u.email, p.amount, p.currency, p.plan, p.provider, p.txn_ref, p.payer_name, p.payment_proof, p.status, p.created_at
    FROM payments p JOIN users u ON u.id = p.user_id ORDER BY p.id DESC LIMIT 50`).all()
  const retentions = await db.prepare(`SELECT r.user_id, u.email, r.plan, r.retain_until, r.created_at
    FROM user_retention r JOIN users u ON u.id = r.user_id ORDER BY r.retain_until DESC LIMIT 50`).all()
  const pendingCount = payments.filter((p) => p.status === 'pending').length
  res.json({ payments, retentions, pendingCount })
})

// POST /api/payments/admin/mark-paid - confirm a manual QR/UPI payment
router.post('/admin/mark-paid', authRequired, adminOnly, async (req, res) => {
  const { paymentId } = req.body || {}
  if (!paymentId) return res.status(400).json({ error: 'paymentId required' })
  const pay = await db.prepare('SELECT * FROM payments WHERE id = ? AND status = ?').get(paymentId, 'pending')
  if (!pay) return res.status(404).json({ error: 'Pending payment not found' })
  await db.prepare(`UPDATE payments SET status = 'success' WHERE id = ?`).run(pay.id)
  const retainUntil = await activateRetention(pay.user_id, pay.plan)
  res.json({ ok: true, retainUntil })
})

// POST /api/payments/admin/activate - manual activation (offline billing)
router.post('/admin/activate', authRequired, adminOnly, async (req, res) => {
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

async function stripeCreateCheckout({ secret, amount, currency, userId, plan }) {
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
      'line_items[0][price_data][product_data][name]': 'ExamAI 1-Year Data Retention',
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
