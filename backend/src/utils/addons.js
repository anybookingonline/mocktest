import db from '../db.js'
import { getConfig, setConfig } from './aiService.js'

// ---------------------------------------------------------------------------
// Paid add-ons — features that cost the platform money (AI calls, third-party
// APIs) are gated behind small one-time add-on purchases, on top of the base
// Data-Retention plan. Activation mirrors retention: a row in user_addons with
// an expiry (default 1 year). Everything reuses the existing payments flow.
// ---------------------------------------------------------------------------

// Every addon prices in two cycles: monthly (30 days) and yearly (365 days,
// same keys/defaults the platform already used before monthly existed, so
// nothing changes for anyone on the yearly price). Monthly duration is fixed
// at 30 days (not admin-editable) to keep the pricing UI simple.
export const ADDONS = {
  ai_power: {
    id: 'ai_power',
    name: 'AI Power Pack',
    icon: '⚡',
    // Never say "unlimited doubts" — AI usage is a real variable cost and
    // this is a capped soft-limit (monetization.paidDoubtsPerDay, default
    // 50), not truly unlimited. Mock generation has no explicit cap today,
    // so "unlimited" there is accurate as implemented.
    description: 'Up to 50 AI doubts/day + unlimited AI mock generation (fair-use policy), priority AI queue.',
    perks: ['Up to 50 AI doubts/day (app + Telegram, fair-use)', 'Unlimited AI full-mock generation', 'Priority AI queue'],
    enabledKey: 'addons.aiPowerEnabled',
    monthly: { priceKey: 'addons.aiPowerPriceMonthly', defaultPrice: 29, days: 30 },
    yearly: { priceKey: 'addons.aiPowerPrice', defaultPrice: 199, days: 365 }
  },
  ai_max: {
    id: 'ai_max',
    name: 'AI Max',
    icon: '💎',
    // Top tier: everything in AI Power + Voice + Smart Revision + Analytics
    // Pro + priority. Internally the same 50/day soft-cap applies.
    description: 'Up to 50 AI doubts/day + unlimited AI mocks (fair-use) + Voice Doubts + Smart Revision Pack + Analytics Pro included — poora AI teacher experience.',
    perks: ['Everything in AI Power Pack', '🎙️ Voice Doubts included', '🔁 Smart Revision Pack included', '📊 Analytics Pro included', 'Priority AI response queue'],
    enabledKey: 'addons.aiMaxEnabled',
    monthly: { priceKey: 'addons.aiMaxPriceMonthly', defaultPrice: 49, days: 30 },
    yearly: { priceKey: 'addons.aiMaxPrice', defaultPrice: 399, days: 365 }
  },
  voice_doubts: {
    id: 'voice_doubts',
    name: 'Voice Doubts',
    icon: '🎙️',
    description: 'Bol kar doubt pucho — Hinglish speech-to-text (Whisper), fair-use.',
    perks: ['Voice doubts, fair-use daily limit applies', 'Hindi + English + Hinglish'],
    enabledKey: 'addons.voiceEnabled',
    monthly: { priceKey: 'addons.voicePriceMonthly', defaultPrice: 15, days: 30 },
    yearly: { priceKey: 'addons.voicePrice', defaultPrice: 49, days: 365 }
  },
  current_affairs: {
    id: 'current_affairs',
    name: 'Current Affairs Pro',
    icon: '📰',
    description: 'AI se roz ke current-affairs MCQs — exam-specific, fresh news par based. UPSC/Banking/SSC ke liye must.',
    perks: ['Daily AI-generated CA quiz (10 Qs)', 'Exam-specific (UPSC/Banking/SSC focus)', 'Monthly revision compilations'],
    enabledKey: 'addons.caEnabled',
    monthly: { priceKey: 'addons.caPriceMonthly', defaultPrice: 19, days: 30 },
    yearly: { priceKey: 'addons.caPrice', defaultPrice: 99, days: 365 }
  },
  focus_areas: {
    id: 'focus_areas',
    name: 'AI Focus Areas',
    icon: '🔥',
    description: 'PYQ data ka deep analysis — kaunsa topic baar-baar poocha jata hai, priority ranking ke saath.',
    perks: ['Topic-wise PYQ frequency ranking', 'Priority order for revision', 'Auto-refreshed weekly'],
    enabledKey: 'addons.focusEnabled',
    monthly: { priceKey: 'addons.focusPriceMonthly', defaultPrice: 15, days: 30 },
    yearly: { priceKey: 'addons.focusPrice', defaultPrice: 79, days: 365 }
  },
  smart_revision: {
    id: 'smart_revision',
    name: 'Smart Revision Pack',
    icon: '🔁',
    description: 'AI Revision mocks (spaced-repetition), AI Flashcards aur AI Topic Summaries — sabse tez revision loop.',
    perks: ['AI-generated spaced-revision mock tests', 'AI flashcards per topic', 'AI topic summaries (concept + example + tip)'],
    enabledKey: 'addons.smartRevisionEnabled',
    monthly: { priceKey: 'addons.smartRevisionPriceMonthly', defaultPrice: 19, days: 30 },
    yearly: { priceKey: 'addons.smartRevisionPriceYearly', defaultPrice: 149, days: 365 }
  },
  analytics_pro: {
    id: 'analytics_pro',
    name: 'Analytics Pro',
    icon: '📊',
    description: 'Visual weak-area heatmap, percentile rank estimate aur parent-facing shareable progress report.',
    perks: ['Subject → chapter → topic weak-area heatmap', 'Percentile rank estimate + trend', '👪 Shareable parent report link (no login needed)'],
    enabledKey: 'addons.analyticsProEnabled',
    monthly: { priceKey: 'addons.analyticsProPriceMonthly', defaultPrice: 19, days: 30 },
    yearly: { priceKey: 'addons.analyticsProPriceYearly', defaultPrice: 149, days: 365 }
  }
}

function parseAddonPlan(planStr) {
  const s = String(planStr || '')
  const cycle = s.endsWith(':monthly') ? 'monthly' : 'yearly'
  const addonId = cycle === 'monthly' ? s.slice(0, -':monthly'.length) : s
  const addon = ADDONS[addonId]
  return addon ? { addonId, cycle, addon } : null
}

// Combined plan catalog for the pricing page. Add-ons whose `enabledKey`
// flag is 'false' are hidden from students entirely (and from every other
// surface — see isAddonEnabled/getFeatureAvailability below).
export async function listPlans() {
  const [retentionPrice, retentionDays, freeHold] = await Promise.all([
    getConfig('monetization.price', '499'),
    getConfig('monetization.retentionDays', '365'),
    getConfig('monetization.freeHoldHours', '24')
  ])
  const addons = []
  for (const a of Object.values(ADDONS)) {
    if ((await getConfig(a.enabledKey, 'true')) === 'false') continue
    const [monthlyPrice, yearlyPrice] = await Promise.all([
      getConfig(a.monthly.priceKey, String(a.monthly.defaultPrice)),
      getConfig(a.yearly.priceKey, String(a.yearly.defaultPrice))
    ])
    addons.push({
      id: a.id, name: a.name, icon: a.icon, description: a.description, perks: a.perks,
      monthly: { price: Number(monthlyPrice), days: a.monthly.days },
      yearly: { price: Number(yearlyPrice), days: a.yearly.days }
    })
  }
  return {
    plans: [{ id: 'retention_1y', name: '1-Year Data Retention', icon: '🗄️', description: 'Keep all your tests, results, doubts and bookmarks safe.', perks: ['Test history & results', 'Doubts & AI explanations', 'Bookmarks & analytics'], price: Number(retentionPrice), currency: await getConfig('monetization.currency', 'INR'), days: Number(retentionDays), freeHoldHours: Number(freeHold) }],
    addons
  }
}

// Is this addon currently for sale at all (admin kill-switch)? Used to hide
// its feature everywhere (nav, buttons, routes) — not just the pricing page —
// regardless of whether any individual student already owns it.
export async function isAddonEnabled(addonId) {
  const a = ADDONS[addonId]
  if (!a) return true
  return (await getConfig(a.enabledKey, 'true')) !== 'false'
}

export async function activateAddon(userId, planStr) {
  const parsed = parseAddonPlan(planStr)
  if (!parsed) throw new Error('Unknown addon')
  const { addonId, cycle, addon } = parsed
  const days = addon[cycle].days
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

// Resolve a plan string (e.g. "ai_power" or "smart_revision:monthly") to its
// current charge amount — used by payments.js/create-order.
export async function priceForAddonPlan(planStr) {
  const parsed = parseAddonPlan(planStr)
  if (!parsed) return null
  const { cycle, addon } = parsed
  return Number(await getConfig(addon[cycle].priceKey, String(addon[cycle].defaultPrice)))
}

export function isAddonPlan(planStr) {
  return Boolean(parseAddonPlan(planStr))
}

export async function getEntitlements(userId) {
  const rows = await db.prepare(`SELECT addon_id, expires_at FROM user_addons WHERE user_id = ?`).all(userId)
  const now = Date.now()
  const out = { aiPower: false, aiMax: false, voiceDoubts: false, currentAffairs: false, focusAreas: false, smartRevision: false, analyticsPro: false, retention: false, addons: [] }
  for (const r of rows) {
    const active = new Date(r.expires_at.replace(' ', 'T') + 'Z').getTime() > now
    if (!active) continue
    if (r.addon_id === 'ai_power') out.aiPower = true
    if (r.addon_id === 'ai_max') { out.aiMax = true; out.aiPower = true; out.voiceDoubts = true; out.smartRevision = true; out.analyticsPro = true } // Max includes everything
    if (r.addon_id === 'voice_doubts') out.voiceDoubts = true
    if (r.addon_id === 'current_affairs') out.currentAffairs = true
    if (r.addon_id === 'focus_areas') out.focusAreas = true
    if (r.addon_id === 'smart_revision') out.smartRevision = true
    if (r.addon_id === 'analytics_pro') out.analyticsPro = true
    out.addons.push({ id: r.addon_id, until: r.expires_at })
  }
  const ret = await db.prepare('SELECT retain_until FROM user_retention WHERE user_id = ?').get(userId)
  out.retention = Boolean(ret && new Date(ret.retain_until.replace(' ', 'T') + 'Z').getTime() > now)
  return out
}

export async function hasAddon(userId, addonId) {
  const e = await getEntitlements(userId)
  if (addonId === 'ai_power') return e.aiPower
  if (addonId === 'ai_max') return e.aiMax
  if (addonId === 'voice_doubts') return e.voiceDoubts
  if (addonId === 'current_affairs') return e.currentAffairs
  if (addonId === 'focus_areas') return e.focusAreas
  if (addonId === 'smart_revision') return e.smartRevision
  if (addonId === 'analytics_pro') return e.analyticsPro
  return e.addons.some((a) => a.id === addonId)
}

// Daily doubt cap for THIS user (0/undefined = uncapped). Order: ai_max/ai_power
// share the high soft-cap; retention-plan buyers keep the mid cap; free users
// the low hook cap. All values admin-configurable (no redeploy).
export async function doubtCapFor(ent) {
  // voiceDoubts included: a standalone Voice Doubts buyer would otherwise
  // still be capped at the free 15/day limit for the very doubts they paid
  // to ask by voice — same paid tier as retention/aiPower.
  if (ent.aiPower || ent.retention || ent.voiceDoubts) return Number(await getConfig('monetization.paidDoubtsPerDay', '50')) || 50
  return Number(await getConfig('monetization.freeDoubtsPerDay', '15')) || 15
}

export async function addonAdminGrant(userId, addonId) {
  return activateAddon(userId, addonId)
}
