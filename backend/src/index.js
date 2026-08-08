import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import db from './db.js'

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
import { purgeExpiredData } from './utils/retention.js'

const app = express()
app.use(cors())
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')))
app.use('/api/payments/webhook', (req, res, next) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', () => { req.rawBody = Buffer.concat(chunks).toString('utf8'); next() })
})
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true }))

app.get('/api/health', async (req, res) => {
  try {
    const row = await db.prepare('SELECT COUNT(*) c FROM questions').get()
    res.json({ ok: true, time: new Date().toISOString(), questions: row.c })
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

app.use((err, req, res, next) => {
  console.error('[API ERROR]', err.message)
  const status = err.status || (/^Only |MulterError|LIMIT_/.test(String(err.message || err.code || '')) ? 400 : 500)
  res.status(status).json({ error: err.message || 'Internal server error' })
})

const PORT = process.env.PORT || 3001

async function main() {
  try {
    await db.initSchema()
    console.log('[db] Postgres schema ready')
  } catch (e) {
    console.error('[db] Schema init failed:', e.message)
    process.exit(1)
  }
  app.listen(PORT, () => {
    console.log(`ExamAI backend running on http://localhost:${PORT}`)
  })

  const runPurge = async () => {
    try {
      const res = await purgeExpiredData()
      if (res.purgedUsers > 0) console.log('[retention] purged', res.purgedUsers, 'user(s):', JSON.stringify(res.stats))
    } catch (e) {
      console.error('[retention] purge error:', e.message)
    }
  }
  runPurge()
  setInterval(runPurge, 60 * 60 * 1000)
}

main()
