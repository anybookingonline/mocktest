import db from '../db.js'
import crypto from 'crypto'
import { jsonrepair } from 'jsonrepair'

// ---------------------------------------------------------------------------
// AI Provider abstraction.
// Primary engine: DeepSeek. Fallback: Gemini (also used for all vision tasks).
// OpenRouter supported as an optional provider (offers free LLM models).
// ---------------------------------------------------------------------------

const PROVIDERS = {
  deepseek: {
    base: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat'
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    defaultVisionModel: 'gemini-2.0-flash'
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    defaultModel: 'deepseek/deepseek-chat-v3-0324:free'
  }
}

export async function getConfig(key, def = null) {
  const row = await db.prepare('SELECT value FROM ai_configs WHERE key = ?').get(key)
  return row ? row.value : def
}

export async function setConfig(key, value) {
  await db.prepare(
    'INSERT INTO ai_configs (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).run(key, String(value))
}

export async function getAiSettings() {
  const keys = ['ai.provider', 'ai.fallbackEnabled', 'deepseek.apiKey', 'deepseek.model',
    'gemini.apiKey', 'gemini.model', 'gemini.visionModel', 'openrouter.apiKey', 'openrouter.model']
  const out = {}
  for (const k of keys) out[k] = await getConfig(k, '')
  return out
}

export async function hasAnyKey() {
  const s = await getAiSettings()
  return Boolean(s['deepseek.apiKey'] || s['gemini.apiKey'] || s['openrouter.apiKey'])
}

async function logAi(action, provider, model, status, latencyMs, user) {
  try {
    await db.prepare(
      `INSERT INTO ai_logs (action, provider, model, status, latency_ms, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(action, provider, model, status, Math.round(latencyMs), user || null)
  } catch { /* non-fatal */ }
}

// ------------------------------- AI cache -----------------------------------

export async function getCachedAi(cacheKey, ttlDays = 30) {
  const row = await db.prepare(
    `SELECT provider, model, raw, data_json FROM ai_cache
     WHERE cache_key = ? AND created_at::timestamptz > now() - make_interval(days => ?)`
  ).get(cacheKey, Number(ttlDays) || 30)
  return row || null
}

export async function setCachedAi(cacheKey, action, provider, model, raw, data) {
  await db.prepare(
    `INSERT INTO ai_cache (cache_key, action, provider, model, raw, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
     ON CONFLICT (cache_key) DO UPDATE SET
       action = excluded.action, provider = excluded.provider, model = excluded.model,
       raw = excluded.raw, data_json = excluded.data_json, created_at = excluded.created_at`
  ).run(cacheKey, action, provider, model, String(raw ?? ''), JSON.stringify(data ?? null))
}

export async function clearAiCache() {
  await db.prepare('DELETE FROM ai_cache').run()
}

export async function cacheStats() {
  const total = (await db.prepare('SELECT COUNT(*) c FROM ai_cache').get()).c
  const recent = (await db.prepare(`SELECT COUNT(*) c FROM ai_logs WHERE status = 'hit' AND provider = 'cache'`).get()).c
  const actions = await db.prepare('SELECT action, COUNT(*) c FROM ai_cache GROUP BY action ORDER BY c DESC').all()
  return { total, hits: recent, actions }
}

function cacheKeyFor({ action, system, messages, json, model }) {
  return hashContent(`${action}|${system || ''}|${JSON.stringify(messages)}|${json ? 'json' : 'text'}|${model || ''}`)
}

function sanitize(obj) {
  return JSON.parse(JSON.stringify(obj))
}

// ------------------------------- HTTP core ---------------------------------

async function postJson(url, headers, body, timeoutMs = 120000) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    })
    const text = await res.text()
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 500)}`)
    }
    return text ? JSON.parse(text) : {}
  } finally {
    clearTimeout(timer)
  }
}

// --------------------------- OpenAI-compatible ------------------------------

async function callOpenAICompatible({ baseUrl, apiKey, model, system, messages, json = false, temperature = 0.7, extraHeaders = {}, maxTokens = 4096 }) {
  const url = `${baseUrl}/chat/completions`
  const body = {
    model,
    messages: system ? [{ role: 'system', content: system }, ...messages] : messages,
    temperature,
    max_tokens: maxTokens
  }
  if (json) body.response_format = { type: 'json_object' }
  return postJson(url, { Authorization: `Bearer ${apiKey}`, ...extraHeaders }, body)
}

async function callDeepSeek({ model, system, messages, json, temperature, maxTokens = 8192 }) {
  const apiKey = await getConfig('deepseek.apiKey')
  if (!apiKey) throw new Error('DeepSeek API key not configured')
  const base = PROVIDERS.deepseek.base
  const data = await callOpenAICompatible({
    baseUrl: base, apiKey, model: model || await getConfig('deepseek.model', PROVIDERS.deepseek.defaultModel),
    system, messages, json, temperature, maxTokens
  })
  return data.choices?.[0]?.message?.content ?? ''
}

async function callOpenRouter({ model, system, messages, json, temperature, maxTokens = 8192 }) {
  const apiKey = await getConfig('openrouter.apiKey')
  if (!apiKey) throw new Error('OpenRouter API key not configured')
  const data = await callOpenAICompatible({
    baseUrl: PROVIDERS.openrouter.base, apiKey,
    model: model || await getConfig('openrouter.model', PROVIDERS.openrouter.defaultModel),
    system, messages, json, temperature, maxTokens,
    extraHeaders: { 'HTTP-Referer': 'http://localhost:3001', 'X-Title': 'ExamAI Platform' }
  })
  return data.choices?.[0]?.message?.content ?? ''
}

// -------------------------------- Gemini ------------------------------------

async function callGemini({ model, system, messages, parts = [], json = false, temperature = 0.7, imageData = null, mimeType = null }) {
  const apiKey = await getConfig('gemini.apiKey')
  if (!apiKey) throw new Error('Gemini API key not configured')
  const m = model || await getConfig('gemini.model', PROVIDERS.gemini.defaultModel)
  const url = `${PROVIDERS.gemini.base}/models/${m}:generateContent?key=${apiKey}`

  const contentParts = []
  if (system) contentParts.push({ text: system + '\n\n' + (messages?.[0]?.content || '') })
  else if (messages?.length) contentParts.push({ text: messages.map(x => `${x.role}: ${x.content}`).join('\n') })
  for (const p of parts || []) contentParts.push(p)
  if (imageData) {
    contentParts.push({ inline_data: { mime_type: mimeType || 'image/png', data: imageData } })
  }

  const payload = {
    contents: [{ role: 'user', parts: contentParts }],
    generationConfig: { temperature }
  }
  if (json) payload.generationConfig.responseMimeType = 'application/json'

  const data = await postJson(url, {}, payload)
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
}

// --------------------------- Unified chat with fallback ---------------------

function extractJson(text) {
  if (!text) throw new Error('Empty AI response')
  let t = text.trim()
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence) t = fence[1].trim()
  const start = t.indexOf('{')
  const end = t.lastIndexOf('}')
  if (start !== -1 && end > start) t = t.slice(start, end + 1)
  try {
    return JSON.parse(t)
  } catch {
    // DeepSeek occasionally emits raw control characters or unescaped quotes
    // inside string literals, which are invalid JSON. Repair then retry.
    try {
      return jsonrepair(t)
    } catch {
      const stripped = t.replace(/[\u0000-\u001f]/g, '')
      try { return jsonrepair(stripped) } catch {
        throw new Error('AI returned invalid JSON')
      }
    }
  }
}

/**
 * Primary call flow with automatic fallback:
 * deepseek (or configured primary) -> gemini -> openrouter
 */
export async function aiChat({ system, messages, json = false, temperature = 0.7, action = 'chat', model = null, parts = [], maxTokens = 8192 }) {
  const provider = await getConfig('ai.provider', 'deepseek')
  const fallbackEnabled = await getConfig('ai.fallbackEnabled', 'true') !== 'false'
  const cacheEnabled = await getConfig('ai.cacheEnabled', 'true') !== 'false'
  const ttlDays = Number(await getConfig('ai.cacheTtlDays', '30')) || 30

  let cacheKey = null
  if (cacheEnabled && !parts?.length) {
    cacheKey = cacheKeyFor({ action, system, messages, json, model })
    try {
      const hit = await getCachedAi(cacheKey, ttlDays)
      if (hit) {
        logAi(action, 'cache', hit.model, 'hit', 0, null)
        return { raw: hit.raw, data: JSON.parse(hit.data_json), cached: true, provider: hit.provider }
      }
    } catch { /* cache failures are non-fatal */ }
  }

  const order = []
  if (provider === 'gemini') order.push('gemini', 'deepseek', 'openrouter')
  else if (provider === 'openrouter') order.push('openrouter', 'deepseek', 'gemini')
  else order.push('deepseek', 'gemini', 'openrouter')

  const errors = []
  for (const p of order) {
    const start = Date.now()
    try {
      let out
      if (p === 'deepseek') out = await callDeepSeek({ model, system, messages, json, temperature, parts, maxTokens })
      else if (p === 'gemini') out = await callGemini({ model, system, messages, json, temperature, parts })
      else out = await callOpenRouter({ model, system, messages, json, temperature, maxTokens })
      logAi(action, p, model || 'default', 'ok', Date.now() - start, null)
      if (json) {
        const data = extractJson(out)
        if (cacheKey) await setCachedAi(cacheKey, action, p, model || 'default', out, data)
        return { raw: out, data, cached: false, provider: p }
      }
      if (cacheKey) await setCachedAi(cacheKey, action, p, model || 'default', out, out)
      return { raw: out, data: out, cached: false, provider: p }
    } catch (e) {
      errors.push(`${p}: ${e.message}`)
      logAi(action, p, model || 'default', 'error', Date.now() - start, null)
      if (p === provider) {
        if (!fallbackEnabled) break
      } else if (!fallbackEnabled) break
    }
  }
  throw new Error('All AI providers failed: ' + errors.join(' | '))
}

/**
 * Gemini vision: extract & understand any PDF (incl. scanned / image-based / multi-column).
 * Sends the whole PDF inline to the Gemini API.
 */
export async function visionExtract({ buffer, mimeType, prompt, model = null }) {
  const apiKey = await getConfig('gemini.apiKey')
  if (!apiKey) throw new Error('Gemini API key not configured for vision extraction. Configure it in Admin > AI Config.')
  const m = model || await getConfig('gemini.visionModel', PROVIDERS.gemini.defaultVisionModel)
  const cacheEnabled = await getConfig('ai.cacheEnabled', 'true') !== 'false'
  const ttlDays = Number(await getConfig('ai.cacheTtlDays', '30')) || 30
  const vkey = cacheEnabled ? hashContent(`vision|${m}|${prompt}|${hashContent(buffer)}`) : null
  if (vkey) {
    try {
      const hit = await getCachedAi(vkey, ttlDays)
      if (hit) {
        logAi('vision', 'cache', m, 'hit', 0, null)
        return JSON.parse(hit.data_json)
      }
    } catch { /* non-fatal */ }
  }
  const b64 = buffer.toString('base64')
  const url = `${PROVIDERS.gemini.base}/models/${m}:generateContent?key=${apiKey}`
  const payload = {
    contents: [{
      role: 'user',
      parts: [
        { inline_data: { mime_type: mimeType || 'application/pdf', data: b64 } },
        { text: prompt }
      ]
    }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
  }
  const start = Date.now()
  const data = await postJson(url, {}, payload, 300000)
  const out = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
  logAi('vision', 'gemini', m, 'ok', Date.now() - start, null)
  const parsed = extractJson(out)
  if (vkey) await setCachedAi(vkey, 'vision', 'gemini', m, out, parsed)
  return parsed
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

export function hashContent(content) {
  return crypto.createHash('sha256').update(String(content)).digest('hex').slice(0, 32)
}

export function safeJsonParse(str, fallback = null) {
  try { return JSON.parse(str) } catch { return fallback }
}
