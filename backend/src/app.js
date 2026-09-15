import express from 'express'
import cors from 'cors'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import db from './db.js'
import { cacheStatus } from './utils/redis.js'
import { b2Status } from './utils/b2.js'
import { gravityConfigured } from './utils/monetize.js'
import { rateLimit } from './middleware/rateLimit.js'

// Patch Express 4 to forward rejected promises from async handlers to the
// error middleware (instead of crashing the process).
const probeRouter = express.Router()
probeRouter.get('/__probe__', () => {})
const Layer = probeRouter.stack[0].constructor
const origHandle = Layer.prototype.handle_request
Layer.prototype.handle_request = function handle_request(req, res, next) {
  const fn = this.handle
  if (fn.length === 4) return origHandle.call(this, req, res, next)
  try {
    const out = fn(req, res, next)
    if (out && typeof out.catch === 'function') out.catch(next)
  } catch (e) {
    next(e)
  }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

import authRoutes from './routes/auth.js'
import examRoutes from './routes/exams.js'
import questionRoutes from './routes/questions.js'
import testRoutes from './routes/tests.js'
import attemptRoutes from './routes/attempts.js'
import aiRoutes from './routes/ai.js'
import importRoutes from './routes/import.js'
import analyticsRoutes from './routes/analytics.js'
import adminRoutes from './routes/admin.js'
import paymentRoutes from './routes/payments.js'
import telegramRoutes from './routes/telegram.js'
import groupRoutes from './routes/groups.js'
import focusRoutes from './routes/focus.js'
import revisionRoutes from './routes/revision.js'
import battleRoutes from './routes/battles.js'
import caRoutes from './routes/currentAffairs.js'
import instituteRoutes from './routes/institutes.js'
import couponRoutes from './routes/coupons.js'
import { purgeExpiredData } from './utils/retention.js'

const app = express()
app.set('trust proxy', 1)
app.use(cors())
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))
app.use('/api/payments/webhook', (req, res, next) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => { req.rawBody = Buffer.concat(chunks).toString('utf8'); next() })
})
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true }))

// ---------------------------------------------------------------------------
// Rate limiting
//   - Global API budget per IP (auth routes get their own stricter budget).
//   - Expensive endpoints (AI, uploads) carry per-route limits where mounted.
// Every limiter degrades to "allow" on Redis failure — it can never take the
// API down. Tune via RATE_* env vars (see env-example).
// ---------------------------------------------------------------------------
const skipRateLimit = String(process.env.RATE_DISABLED || '') === 'true'
if (!skipRateLimit) {
  app.use('/api', rateLimit({ key: 'global', windowSec: Number(process.env.RATE_WINDOW_SEC) || 60, max: Number(process.env.RATE_MAX_REQ) || 120 }))
}

app.get('/api/health', async (req, res) => {
  try {
    const row = await db.prepare('SELECT COUNT(*) c FROM questions').get()
    res.json({ ok: true, time: new Date().toISOString(), questions: row.c, cache: cacheStatus(), storage: await b2Status(), monetization: { ads: (await gravityConfigured()) ? 'gravity' : 'off' } })
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/exams', examRoutes)
app.use('/api/questions', questionRoutes)
app.use('/api/tests', testRoutes)
app.use('/api/attempts', attemptRoutes)
app.use('/api/ai', aiRoutes)
app.use('/api/import', importRoutes)
app.use('/api/analytics', analyticsRoutes)
app.use('/api/admin', adminRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/telegram', telegramRoutes)
app.use('/api/groups', groupRoutes)
app.use('/api/focus', focusRoutes)
app.use('/api/revision', revisionRoutes)
app.use('/api/battles', battleRoutes)
app.use('/api/ca', caRoutes)
app.use('/api/institutes', instituteRoutes)
app.use('/api/coupons', couponRoutes)

// Serve the built frontend (single-origin deployment: one service hosts API + UI)
const distDir = path.join(__dirname, '..', '..', 'dist')
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir))
  app.get(/^\/(?!api|uploads).*/, (req, res) => {
    res.sendFile(path.join(distDir, 'index.html'))
  })
}

app.use((err, req, res, next) => {
  console.error('[API ERROR]', err.message)
  const status = err.status || (/^Only |MulterError|LIMIT_/.test(String(err.message || err.code || '')) ? 400 : 500)
  res.status(status).json({ error: err.message || 'Internal server error' })
})

export default app
