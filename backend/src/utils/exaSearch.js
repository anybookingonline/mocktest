// ---------------------------------------------------------------------------
// Exa neural web-search integration (optional, admin-configurable).
//
// Purpose: ground AI-generated Current Affairs quizzes in REAL recent news so
// questions reflect the last few days, not the model's training cutoff.
// Also usable for any future "latest news" surface.
//
// Key resolution: env EXA_API_KEY wins; Admin → AI Config 'exa.apiKey' fallback.
// Fail-open: search errors never break quiz generation — AI falls back to its
// own knowledge. Monthly usage can be capped by the admin (exa.monthlyLimit).
// ---------------------------------------------------------------------------

import { getConfig } from './aiService.js'

export async function getExaKey() {
  return process.env.EXA_API_KEY || (await getConfig('exa.apiKey')) || ''
}

export async function exaConfigured() {
  return Boolean(await getExaKey())
}

/**
 * Fetch recent news context for a topic. Returns an array of
 * { title, url, publishedDate, text } — empty array on any failure.
 */
export async function searchNewsContext(topic, { maxResults = 6 } = {}) {
  const apiKey = await getExaKey()
  if (!apiKey) return []

  // Monthly usage cap (admin-set, default 500 searches) — cost guard.
  const cap = Number(await getConfig('exa.monthlyLimit', '500')) || 500
  const used = Number(await getConfig('exa.monthUsed', '0')) || 0
  const month = new Date().toISOString().slice(0, 7)
  const usedMonth = (await getConfig('exa.monthUsedMonth')) || ''
  const usedThisMonth = usedMonth === month ? used : 0
  if (usedThisMonth >= cap) return []

  try {
    const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)
    const res = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `${topic} — latest news and current affairs`,
        numResults: maxResults,
        useAutoprompt: true,
        category: 'news',
        startPublishedDate: since,
        contents: { text: { maxCharacters: 400 } }
      })
    })
    if (!res.ok) return []
    const data = await res.json().catch(() => ({}))
    const results = Array.isArray(data.results) ? data.results : []

    // record usage (idempotent-ish; counters are advisory only)
    await setUsage(month, usedThisMonth + 1)

    return results.map((r) => ({
      title: r.title || '',
      url: r.url || '',
      publishedDate: r.publishedDate || '',
      text: (r.text || '').slice(0, 400)
    }))
  } catch {
    return [] // fail-open
  }
}

async function setUsage(month, value) {
  const { setConfig } = await import('./aiService.js')
  await setConfig('exa.monthUsed', String(value))
  await setConfig('exa.monthUsedMonth', month)
}

/** Build a compact prompt-context block from Exa results (empty string if none). */
export function formatNewsBlock(results) {
  if (!results?.length) return ''
  return results
    .map((r, i) => `${i + 1}. ${r.title}${r.publishedDate ? ` (${r.publishedDate.slice(0, 10)})` : ''}: ${r.text}`)
    .join('\n')
    .slice(0, 2400)
}
