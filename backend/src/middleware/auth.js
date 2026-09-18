import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import db from '../db.js'

// Security: never ship a predictable fallback signing secret. If JWT_SECRET
// is not configured we generate a random one at boot — tokens remain
// unforgable, at the cost of logouts across restarts (acceptable + loud warn).
const JWT_SECRET = process.env.JWT_SECRET || (() => {
  const generated = crypto.randomBytes(48).toString('hex')
  console.warn('[SECURITY] JWT_SECRET env var not set — using a random per-boot secret. Users will be logged out on restart. Set JWT_SECRET for stable sessions.')
  return generated
})()

export function signToken(user) {
  return jwt.sign({ id: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' })
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET)
}

export async function authRequired(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!token) return res.status(401).json({ error: 'Authentication required' })
  try {
    const payload = verifyToken(token)
    const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(payload.id)
    if (!user) return res.status(401).json({ error: 'User not found' })
    req.user = user
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

export function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' })
  }
  next()
}

// Platform-admin guard: role=admin AND no institute linked. Institute
// sub-admins also carry role='admin' (they manage their own institute), so
// every PLATFORM-wide route (users, settings, AI keys, exams, payments…)
// must use this instead of plain adminOnly — otherwise a coaching owner
// could enumerate/delete all users of the whole platform.
export function platformOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin' || req.user.institute_id) {
    return res.status(403).json({ error: 'Platform admin access required' })
  }
  next()
}
