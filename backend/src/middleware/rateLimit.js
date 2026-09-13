import { cacheGet, cacheSet, cacheStatus } from '../utils/redis.js'

// ---------------------------------------------------------------------------
// Sliding-window rate limiter.
// Uses Upstash Redis when configured (so limits are shared across instances),
// otherwise falls back to an in-process window map. Every failure degrades to
// "allow" so the limiter can never take the API down.
//
// Usage (defaults shown):
//   router.post('/x', rateLimit(), handler)
//   router.post('/x', rateLimit({ windowSec: 60, max: 5, key: 'ai' }), handler)
//   rateLimit({ keyFn: (req) => req.body?.email })  // custom bucket key
// ---------------------------------------------------------------------------

const windows = new Map() // local fallback: bucket -> { count, resetAt }

// Periodically drop expired local buckets so the map cannot grow forever
setInterval(() => {
  const now = Date.now()
  for (const [k, w] of windows) if (w.resetAt < now) windows.delete(k)
}, 60 * 1000).unref()

function clientIp(req) {
  return (
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  )
}

async function hitLimited(bucket, windowSec, max) {
  const now = Date.now()
  try {
    if (cacheStatus().redis) {
      const raw = await cacheGet(bucket)
      const n = Number(raw) || 0
      if (n === 0) {
        await cacheSet(bucket, 1, windowSec)
        return { allowed: max > 0, count: 1, resetInSec: windowSec }
      }
      if (n >= max) {
        // Refresh TTL lightly so the bucket does not live forever after abuse
        return { allowed: false, count: n, resetInSec: windowSec }
      }
      await cacheSet(bucket, n + 1, windowSec)
      return { allowed: true, count: n + 1, resetInSec: windowSec }
    }
  } catch { /* fall through to in-memory */ }

  const w = windows.get(bucket)
  if (!w || w.resetAt < now) {
    windows.set(bucket, { count: 1, resetAt: now + windowSec * 1000 })
    return { allowed: max > 0, count: 1, resetInSec: windowSec }
  }
  if (w.count >= max) return { allowed: false, count: w.count, resetInSec: Math.ceil((w.resetAt - now) / 1000) }
  w.count += 1
  return { allowed: true, count: w.count, resetInSec: Math.ceil((w.resetAt - now) / 1000) }
}

export function rateLimit(opts = {}) {
  const {
    windowSec = Number(process.env.RATE_WINDOW_SEC) || 60,
    max = Number(process.env.RATE_MAX_REQ) || 120,
    key = 'global',
    keyFn = null,
    message = 'Too many requests — please slow down and try again shortly.'
  } = opts

  return async (req, res, next) => {
    try {
      const who = keyFn ? String(keyFn(req) || clientIp(req)) : clientIp(req)
      const bucket = `rl:${key}:${who}`
      const r = await hitLimited(bucket, windowSec, max)
      res.setHeader('X-RateLimit-Limit', String(max))
      res.setHeader('X-RateLimit-Reset', String(r.resetInSec))
      if (!r.allowed) {
        res.setHeader('Retry-After', String(r.resetInSec || windowSec))
        return res.status(429).json({ error: message, retryAfter: r.resetInSec })
      }
      next()
    } catch {
      next() // limiter must never break the API
    }
  }
}

// Convenience presets --------------------------------------------------------

// Strict limiter for login/register (brute-force protection)
export const authLimiter = (extra = {}) => rateLimit({
  key: 'auth',
  windowSec: Number(process.env.RATE_AUTH_WINDOW_SEC) || 15 * 60,
  max: Number(process.env.RATE_AUTH_MAX) || 15,
  message: 'Too many login attempts. Please wait 15 minutes and try again.',
  ...extra
})

// AI endpoints are expensive — protect the bill
export const aiLimiter = (extra = {}) => rateLimit({
  key: 'ai',
  windowSec: Number(process.env.RATE_AI_WINDOW_SEC) || 60,
  max: Number(process.env.RATE_AI_MAX) || 10,
  message: 'AI request limit reached. Please wait a minute before trying again.',
  ...extra
})

// PDF imports: a few per hour per admin is plenty
export const uploadLimiter = (extra = {}) => rateLimit({
  key: 'upload',
  windowSec: Number(process.env.RATE_UPLOAD_WINDOW_SEC) || 60 * 60,
  max: Number(process.env.RATE_UPLOAD_MAX) || 20,
  message: 'Upload limit reached. Please wait before uploading another file.',
  ...extra
})
