import db from '../db.js'
import { getConfig, setConfig } from './aiService.js'

// ---------------------------------------------------------------------------
// Paid add-ons — features that cost the platform money (AI calls, third-party
// APIs) are gated behind small one-time add-on purchases, on top of the base
// Data-Retention plan. Activation mirrors retention: a row in user_addons with
// an expiry (default 1 year). Everything reuses the existing payments flow.
// ---------------------------------------------------------------------------

export const ADDONS = {
  ai_power: {
    id: 'ai_power',
    name: 'AI Power Pack',
    icon: '⚡',
    description: 'Unlimited AI doubts, unlimited mock generation, priority AI queue — no daily caps.',
    perks: ['Unlimited AI doubts (app + Telegram)', 'Unlimited AI full-mock generation', 'Priority AI queue'],
    priceKey: 'addons.aiPowerPrice',
    defaultPrice: 99,
    daysKey: 'addons.aiPowerDays',
    defaultDays: 365
  },
  voice_doubts: {
    id: 'voice_doubts',
    name: 'Voice Doubts',
    icon: '🎙️',
    description: 'Bol kar doubt pucho — Hinglish speech-to-text (Whisper) unlimited.',
    perks: ['Unlimited voice doubts', 'Hindi + English + Hinglish'],
    priceKey: 'addons.voicePrice',
    defaultPrice: 49,
    daysKey: 'addons.voiceDays',
    defaultDays: 365
  },
  current_affairs: {
    id: 'current_affairs',
    name: 'Current Affairs Pro',
    icon: '📰',
    description: 'AI se roz ke current-affairs MCQs — exam-specific, fresh news par based. UPSC/Banking/SSC ke liye must.',
    perks: ['Daily AI-generated CA quiz (10 Qs)', 'Exam-specific (UPSC/Banking/SSC focus)', 'Monthly revision compilations'],
    priceKey: 'addons.caPrice',
    defaultPrice: 99,
    daysKey: 'addons.caDays',
    defaultDays: 365
  },
  focus_areas: {
    id: 'focus_areas',
    name: 'AI Focus Areas',
    icon: '🔥',
    description: 'PYQ data ka deep analysis — kaunsa topic baar-baar poocha jata hai, priority ranking ke saath.',
    perks: ['Topic-wise PYQ frequency ranking', 'Priority order for revision', 'Auto-refreshed weekly'],
    priceKey: 'addons.focusPrice',
    defaultPrice: 79,
    daysKey: 'addons.focusDays',
    defaultDays: 365
  }
}

// Combined plan catalog for the pricing page. Add-ons whose
// 'addons.<x>Enabled' flag is 'false' are hidden from students entirely.
export async function listPlans() {
  const [retentionPrice, retentionDays, freeHold] = await Promise.all([
    getConfig('monetization.price', '499'),
    getConfig('monetization.retentionDays', '365'),
    getConfig('monetization.freeHoldHours', '24')
  ])
  const enabledMap = { ai_power: 'addons.aiPowerEnabled', voice_doubts: 'addons.voiceEnabled', current_affairs: 'addons.caEnabled', focus_areas: 'addons.focusEnabled' }
  const addons = []
  for (const a of Object.values(ADDONS)) {
    const enabledKey = enabledMap[a.id]
    if (enabledKey && (await getConfig(enabledKey, 'true')) === 'false') continue
    const [price, days] = await Promise.all([getConfig(a.priceKey, String(a.defaultPrice)), getConfig(a.daysKey, String(a.defaultDays))])
    addons.push({ ...a, price: Number(price), days: Number(days), priceKey: undefined, daysKey: undefined })
  }
  return {
    plans: [{ id: 'retention_1y', name: '1-Year Data Retention', icon: '🗄️', description: 'Keep all your tests, results, doubts and bookmarks safe.', perks: ['Test history & results', 'Doubts & AI explanations', 'Bookmarks & analytics'], price: Number(retentionPrice), currency: await getConfig('monetization.currency', 'INR'), days: Number(retentionDays), freeHoldHours: Number(freeHold) }],
    addons
  }
}

export async function activateAddon(userId, addonId) {
  const a = ADDONS[addonId]
  if (!a) throw new Error('Unknown addon')
  const days = Number(await getConfig(a.daysKey, String(a.defaultDays))) || a.defaultDays
  const existing = await db.prepare('SELECT expires_at FROM user_addons WHERE user_id = ? AND addon_id = ?').get(userId, addonId)
  const base = existing && new Date(existing.expires_at.replace(' ', 'T') + 'Z') > new Date()
    ? new Date(existing.expires_at.replace(' ', 'T') + 'Z')
    : new Date()
  const until = new Date(base.getTime() + days * 86400000)
  const untilStr = until.toISOString().replace('T', ' ').slice(0, 19)
  await db.prepare(`INSERT INTO user_addons (user_id, addon_id, expires_at, created_at)
    VALUES (?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (user_id, addon_id) DO UPDATE SET expires_at = excluded.expires_at`).run(userId, addonId, untilStr)
  return untilStr
}

export async function getEntitlements(userId) {
  const rows = await db.prepare(`SELECT addon_id, expires_at FROM user_addons WHERE user_id = ?`).all(userId)
  const now = Date.now()
  const out = { aiPower: false, voiceDoubts: false, currentAffairs: false, focusAreas: false, retention: false, addons: [] }
  for (const r of rows) {
    const active = new Date(r.expires_at.replace(' ', 'T') + 'Z').getTime() > now
    if (!active) continue
    if (r.addon_id === 'ai_power') out.aiPower = true
    if (r.addon_id === 'voice_doubts') out.voiceDoubts = true
    if (r.addon_id === 'current_affairs') out.currentAffairs = true
    if (r.addon_id === 'focus_areas') out.focusAreas = true
    out.addons.push({ id: r.addon_id, until: r.expires_at })
  }
  const ret = await db.prepare('SELECT retain_until FROM user_retention WHERE user_id = ?').get(userId)
  out.retention = Boolean(ret && new Date(ret.retain_until.replace(' ', 'T') + 'Z').getTime() > now)
  return out
}

export async function hasAddon(userId, addonId) {
  const e = await getEntitlements(userId)
  if (addonId === 'ai_power') return e.aiPower
  if (addonId === 'voice_doubts') return e.voiceDoubts
  if (addonId === 'current_affairs') return e.currentAffairs
  if (addonId === 'focus_areas') return e.focusAreas
  return e.addons.some((a) => a.id === addonId)
}

export async function addonAdminGrant(userId, addonId) {
  return activateAddon(userId, addonId)
}
