// ---------------------------------------------------------------------------
// Gravity contextual ads (monetization layer).
//
// Non-intrusive, AI-native sponsored recommendations shown beside AI tutor
// answers (below_response placement). Pay-per-impression revenue for the
// platform. Free users see it; paid users' experience stays clean (the UI
// hides ads for entitled users; the endpoint also short-circuits).
//
// Key resolution: env GRAVITY_API_KEY wins; Admin → AI Config 'gravity.apiKey'
// fallback. Fail-open: any error → no ads rendered, app unaffected.
// Kill-switch: features.contextualAds = 'false' explicitly disables ads even
// when a key is configured. No key configured → no ads (nothing to sell).
// ---------------------------------------------------------------------------

import { getConfig } from './aiService.js'

export async function getGravityKey() {
  return process.env.GRAVITY_API_KEY || (await getConfig('gravity.apiKey')) || ''
}

export async function gravityConfigured() {
  return Boolean(await getGravityKey())
}

/**
 * Request a contextual ad for an AI conversation surface.
 * Returns the Gravity ad object or null (no match / not configured / disabled).
 */
export async function getContextualAd({ messages, sessionId, user, device }) {
  // Ads run whenever a publisher key exists. Admin can still force them off
  // with an explicit features.contextualAds = 'false' (AI Config kill-switch).
  const flag = await getConfig('features.contextualAds')
  if (flag === 'false') return null
  const apiKey = await getGravityKey()
  if (!apiKey) return null
  if (!device?.ua || !device?.ip) return null // Gravity 400s without these — skip early

  try {
    const res = await fetch('https://server.trygravity.ai/api/v1/ad', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: (messages || []).slice(-4),
        sessionId: sessionId || 'anon',
        placements: [{ placement: 'below_response', placement_id: 'doubt' }],
        user: { id: String(user?.id || 'anonymous') },
        device: { ua: device.ua, ip: device.ip },
        supportsSpec: false
      }),
      signal: AbortSignal.timeout(2500) // never slow the tutor down
    })
    if (res.status === 204) return null // no ad matched — normal case
    if (!res.ok) return null
    const ads = await res.json()
    return Array.isArray(ads) ? ads[0] || null : null
  } catch {
    return null
  }
}

/** Extract ad fields safe for the client (always use clickUrl for links, fire impUrl on visible). */
export function publicAdFields(ad) {
  if (!ad) return null
  return {
    id: ad.id || null,
    title: ad.title || ad.headline || 'Sponsored',
    body: ad.body || ad.description || '',
    sponsor: ad.sponsor || ad.advertiser || null,
    clickUrl: ad.clickUrl || ad.click_url || null,
    impUrl: ad.impUrl || ad.imp_url || null
  }
}
