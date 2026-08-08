import db from '../db.js'
import { getConfig, setConfig } from './aiService.js'

export function getMonetizationConfig() {
  return {
    provider: 'razorpay', // default gateway when client doesn't pick one
    gateways: ['razorpay'], // enabled gateways
    price: 499,
    currency: 'INR',
    retentionDays: 365,
    freeHoldHours: 24
  }
}

export const GATEWAYS = {
  razorpay: { label: 'Razorpay (Card / UPI / NetBanking)', icon: '🟢' },
  stripe: { label: 'Stripe (International Cards)', icon: '💳' },
  phonepe: { label: 'PhonePe UPI', icon: '📱' },
  qr: { label: 'Custom QR (UPI scan & pay)', icon: '🔳' }
}

export async function loadMonetizationConfig() {
  const d = getMonetizationConfig()
  const keys = ['monetization.gateways', 'monetization.provider', 'monetization.price', 'monetization.currency',
    'monetization.retentionDays', 'monetization.freeHoldHours']
  for (const k of keys) {
    const v = await getConfig(k)
    if (v !== null && v !== undefined && v !== '') {
      const key = k.split('.').pop()
      if (key === 'price' || key === 'retentionDays' || key === 'freeHoldHours') d[key] = Number(v)
      else if (key === 'gateways') {
        try { d.gateways = JSON.parse(v); if (!Array.isArray(d.gateways)) d.gateways = ['razorpay'] } catch { d.gateways = ['razorpay'] }
      }
      else d[key] = v
    }
  }
  if (!Array.isArray(d.gateways) || !d.gateways.length) d.gateways = ['razorpay']
  if (!d.gateways.includes(d.provider)) d.provider = d.gateways[0]
  return d
}

export async function loadGatewayConfig(provider) {
  const base = { provider }
  const map = {
    razorpay: ['keyId', 'keySecret'],
    stripe: ['secretKey', 'webhookSecret'],
    phonepe: ['merchantId', 'saltKey', 'saltIndex', 'env', 'baseUrl'],
    qr: ['upiId', 'qrImage', 'holderName', 'note']
  }
  const keys = map[provider] || []
  for (const k of keys) base[k] = await getConfig(`${provider}.${k}`)
  return base
}

export async function getRetentionStatus(userId) {
  const row = await db.prepare('SELECT retain_until, plan FROM user_retention WHERE user_id = ?').get(userId)
  if (!row) return { active: false, retainUntil: null, plan: null }
  const active = new Date(row.retain_until.replace(' ', 'T') + 'Z').getTime() > Date.now()
  return { active, retainUntil: row.retain_until, plan: row.plan }
}

export async function activateRetention(userId, plan) {
  const cfg = await loadMonetizationConfig()
  const cur = await getRetentionStatus(userId)
  const base = cur.active && cur.retainUntil ? new Date(cur.retainUntil.replace(' ', 'T') + 'Z') : new Date()
  const until = new Date(base.getTime() + cfg.retentionDays * 86400000)
  const untilStr = until.toISOString().replace('T', ' ').slice(0, 19)
  await db.prepare(`INSERT INTO user_retention (user_id, retain_until, plan, created_at)
    VALUES (?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (user_id) DO UPDATE SET retain_until = excluded.retain_until, plan = excluded.plan`).run(userId, untilStr, plan)
  return untilStr
}

export async function purgeExpiredData() {
  const cfg = await loadMonetizationConfig()
  const hours = Number(cfg.freeHoldHours) || 24
  const cutoff = `now() - interval '${hours} hours'`
  const rows = await db.prepare(`
    SELECT DISTINCT user_id FROM (
      SELECT a.user_id FROM attempts a
        WHERE a.created_at::timestamptz < ${cutoff}
      UNION
      SELECT d.user_id FROM doubts d
        WHERE d.created_at::timestamptz < ${cutoff}
      UNION
      SELECT n.user_id FROM notifications n
        WHERE n.created_at::timestamptz < ${cutoff}
    ) x
    WHERE user_id IN (
      SELECT u.id FROM users u
      LEFT JOIN user_retention r ON r.user_id = u.id
      WHERE (r.user_id IS NULL OR r.retain_until::timestamptz < now())
    )
  `).all()
  const ids = rows.map((r) => r.user_id)
  if (!ids.length) return { purgedUsers: 0 }

  const placeholders = ids.map(() => '?').join(',')
  const stats = {}
  for (const [table, col] of [['attempts', 'user_id'], ['bookmarks', 'user_id'], ['doubts', 'user_id'],
    ['notifications', 'user_id'], ['topic_stats', 'user_id'], ['rankings_cache', 'user_id']]) {
    const r = await db.prepare(`DELETE FROM ${table} WHERE ${col} IN (${placeholders})`).run(...ids)
    stats[table] = Number(r.changes || 0)
  }
  const logs = await db.prepare(`DELETE FROM ai_logs WHERE created_by IN (${placeholders})`).run(...ids)
  stats.ai_logs = Number(logs.changes || 0)
  return { purgedUsers: ids.length, stats }
}
