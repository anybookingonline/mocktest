import express from 'express'
import bcrypt from 'bcryptjs'
import db from '../db.js'
import { signToken, authRequired } from '../middleware/auth.js'

const router = express.Router()

function publicUser(u) {
  return { id: u.id, name: u.name, email: u.email, role: u.role, avatar: u.avatar, exam_id: u.exam_id, target_exam: u.target_exam }
}

router.post('/register', async (req, res) => {
  const { name, email, password, target_exam } = req.body || {}
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required' })
  if (String(password).length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' })
  const exists = await db.prepare('SELECT id FROM users WHERE email = ?').get(String(email).toLowerCase())
  if (exists) return res.status(409).json({ error: 'Email already registered' })
  const hash = bcrypt.hashSync(String(password), 10)
  const r = await db.prepare('INSERT INTO users (name, email, password_hash, role, target_exam) VALUES (?, ?, ?, ?, ?)')
    .run(name, String(email).toLowerCase(), hash, 'student', target_exam || null)
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid)
  res.status(201).json({ token: signToken(user), user: publicUser(user) })
})

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {}
  const user = await db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase())
  if (!user || !bcrypt.compareSync(String(password || ''), user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' })
  }
  res.json({ token: signToken(user), user: publicUser(user) })
})

router.get('/me', authRequired, (req, res) => {
  res.json({ user: publicUser(req.user) })
})

router.put('/me', authRequired, async (req, res) => {
  const { name, target_exam, exam_id, avatar, password } = req.body || {}
  await db.prepare('UPDATE users SET name = COALESCE(?, name), target_exam = COALESCE(?, target_exam), exam_id = COALESCE(?, exam_id), avatar = COALESCE(?, avatar), updated_at = now() WHERE id = ?')
    .run(name || null, target_exam || null, exam_id ?? null, avatar || null, req.user.id)
  if (password) {
    const hash = bcrypt.hashSync(String(password), 10)
    await db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.user.id)
  }
  const user = await db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)
  res.json({ user: publicUser(user) })
})

router.get('/settings', authRequired, async (req, res) => {
  const s = await db.prepare('SELECT value FROM ai_configs WHERE key = ?').get('platform.name')
  res.json({ platformName: s?.value || 'ExamAI' })
})

export default router
