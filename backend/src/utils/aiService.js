import db from '../db.js'
import crypto from 'crypto'
import { jsonrepair } from 'jsonrepair'

// ---------------------------------------------------------------------------
// AI Provider abstraction.
// Primary engine: DeepSeek. Fallback: Gemini (also used for all vision tasks).
// OpenRouter supported as an optional provider (offers free LLM models).
// "custom" = any OpenAI-compatible endpoint (Groq, Mistral, xAI/Grok, Together,
// Fireworks, Cerebras, Ollama, vLLM, …) configured in Admin → AI Config.
// ---------------------------------------------------------------------------

const PROVIDERS = {
  deepseek: {
    base: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat'
  },
  gemini: {
    base: 'https://generativelanguage.googleapis.com/v1beta',
    // NOTE: the whole Gemini 2.0 line (incl. gemini-2.0-flash-exp) was shut
    // down by Google — calling it now returns 404. Per Google's current model
    // guide (ai.google.dev/gemini-api/docs/models), 3.5 Flash-Lite / 3.8 Flash
    // are the recommended defaults for new projects. Check that guide before
    // changing these — Google retires models on a rolling basis.
    defaultModel: 'gemini-3.5-flash-lite',
    // One generation behind the usual admin-configured vision model (3.8
    // Flash) on purpose: a different capacity pool to fall back to in
    // visionExtract() when the primary model is overloaded (503).
    defaultVisionModel: 'gemini-3.6-flash'
  },
  openrouter: {
    base: 'https://openrouter.ai/api/v1',
    // :free slugs rotate — when this dies (404), the error message itself
    // names the replacement slug ("use this slug instead: ..."); or pick a
    // current free model from https://openrouter.ai/models?max_price=0 and
    // update Admin > AI Config.
    defaultModel: 'deepseek/deepseek-chat-v3-0324'
  }
}

// Preset buttons shown in the admin UI for one-click custom provider setup
export const CUSTOM_PRESETS = {
  groq: { base: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', label: 'Groq' },
  mistral: { base: 'https://api.mistral.ai/v1', model: 'mistral-large-latest', label: 'Mistral' },
  xai: { base: 'https://api.x.ai/v1', model: 'grok-3-mini', label: 'xAI (Grok)' },
  together: { base: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', label: 'Together AI' },
  fireworks: { base: 'https://api.fireworks.ai/inference/v1', model: 'accounts/fireworks/models/llama-v3p3-70b-instruct', label: 'Fireworks AI' },
  cerebras: { base: 'https://api.cerebras.ai/v1', model: 'llama-3.3-70b', label: 'Cerebras' },
  ollama: { base: 'http://localhost:11434/v1', model: 'llama3.1', label: 'Ollama (local)' }
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
    'gemini.apiKey', 'gemini.model', 'gemini.visionModel', 'openrouter.apiKey', 'openrouter.model',
    'custom.name', 'custom.baseUrl', 'custom.apiKey', 'custom.model', 'custom.enabled',
    'features.voiceDoubts', 'features.telegramBot', 'features.groupStudy', 'features.groupDiscussions', 'features.battles', 'features.currentAffairs', 'features.focusAreas', 'openai.apiKey', 'telegram.botToken',
    'groups.freeAfterPaid', 'groups.freeSlots', 'groups.maxFree', 'groups.maxMembers', 'groups.freeSeatDays',
    'exa.apiKey', 'exa.monthlyLimit', 'gravity.apiKey', 'features.contextualAds']
  const out = {}
  for (const k of keys) out[k] = await getConfig(k, '')
  return out
}

// Optional platform features (admin toggles). Voice doubts use the OpenAI
// Whisper STT API; the Telegram tutor bot uses the official Bot API.
export async function getFeatureFlags() {
  const s = await getAiSettings()
  return {
    voiceDoubts: s['features.voiceDoubts'] === 'true' && Boolean(s['openai.apiKey']),
    telegramBot: s['features.telegramBot'] === 'true' && Boolean(s['telegram.botToken']),
    groupStudy: s['features.groupStudy'] === 'true',
    groupDiscussions: s['features.groupDiscussions'] === 'true',
    battles: s['features.battles'] === 'true',
    currentAffairs: s['features.currentAffairs'] === 'true',
    focusAreas: s['features.focusAreas'] === 'true',
    contextualAds: s['features.contextualAds'] === 'true'
  }
}

// ------------------------------ Whisper STT ---------------------------------

export async function transcribeAudio({ buffer, mimeType = 'audio/ogg' }) {
  const apiKey = await getConfig('openai.apiKey')
  if (!apiKey) throw new Error('OpenAI API key not configured (required for voice doubts)')
  const form = new FormData()
  form.append('file', new Blob([buffer], { type: mimeType }), 'audio.ogg')
  form.append('model', 'whisper-1')
  const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error?.message || `Whisper failed (${res.status})`)
  return data.text || ''
}

export async function hasAnyKey() {
  const s = await getAiSettings()
  return Boolean(s['deepseek.apiKey'] || s['gemini.apiKey'] || s['openrouter.apiKey'] ||
    (s['custom.enabled'] !== 'false' && s['custom.apiKey'] && s['custom.baseUrl']))
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

// Provider-side capacity errors (Gemini 503 "high demand", 429 rate limit,
// gateway blips) are transient by nature — the API literally says "try again
// later". Retry those automatically with linear backoff instead of failing
// the whole task (a PDF import used to die on the first 503).
const TRANSIENT_STATUS = [429, 500, 502, 503, 504]

async function postJsonWithRetry(url, headers, body, timeoutMs = 120000, { attempts = 3, baseDelayMs = 5000, label = 'ai' } = {}) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      return await postJson(url, headers, body, timeoutMs)
    } catch (e) {
      lastErr = e
      const msg = String(e.message || '')
      const transient = TRANSIENT_STATUS.some((s) => msg.includes(`HTTP ${s}`))
      if (!transient || i === attempts) throw e
      const delay = baseDelayMs * i // 5s, 10s, …
      console.warn(`[${label}] transient error (attempt ${i}/${attempts}): ${msg.slice(0, 160)} — retrying in ${delay / 1000}s`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastErr
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
    extraHeaders: { 'HTTP-Referer': process.env.APP_URL || 'https://www.aisepadho.com', 'X-Title': 'ExamAI Platform' }
  })
  return data.choices?.[0]?.message?.content ?? ''
}

// Custom OpenAI-compatible provider (Groq / Mistral / xAI / Together / Ollama / …)
async function callCustom({ model, system, messages, json, temperature, maxTokens = 8192 }) {
  const enabled = await getConfig('custom.enabled', 'true') !== 'false'
  if (!enabled) throw new Error('Custom provider is disabled')
  const apiKey = await getConfig('custom.apiKey')
  const baseUrl = (await getConfig('custom.baseUrl'))?.replace(/\/$/, '')
  if (!baseUrl) throw new Error('Custom provider baseUrl not configured')
  if (!apiKey && !/localhost|127\.0\.0\.1/.test(baseUrl)) throw new Error('Custom provider API key not configured')
  const data = await callOpenAICompatible({
    baseUrl, apiKey: apiKey || 'not-needed',
    model: model || await getConfig('custom.model', ''),
    system, messages, json, temperature, maxTokens
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

  // Bug fix: timeoutMs is a positional arg before the options object — passing
  // the options object in its place made setTimeout() see a NaN delay, which
  // fires almost instantly, so this fallback used to always fail with
  // "This operation was aborted" the moment it was actually needed.
  const data = await postJsonWithRetry(url, {}, payload, 120000, { label: 'gemini' })
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
}

// --------------------------- Unified chat with fallback ---------------------

export function extractJson(text) {
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
  if (provider === 'gemini') order.push('gemini', 'deepseek', 'custom', 'openrouter')
  else if (provider === 'openrouter') order.push('openrouter', 'deepseek', 'custom', 'gemini')
  else if (provider === 'custom') order.push('custom', 'deepseek', 'gemini', 'openrouter')
  else order.push('deepseek', 'custom', 'gemini', 'openrouter')

  const errors = []
  for (const p of order) {
    const start = Date.now()
    try {
      let out
      if (p === 'deepseek') out = await callDeepSeek({ model, system, messages, json, temperature, parts, maxTokens })
      else if (p === 'gemini') out = await callGemini({ model, system, messages, json, temperature, parts })
      else if (p === 'custom') out = await callCustom({ model, system, messages, json, temperature, maxTokens })
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

async function callGeminiVisionModel(m, { apiKey, buffer, mimeType, prompt, attempts, baseDelayMs }) {
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
  const data = await postJsonWithRetry(url, {}, payload, 300000, { attempts, baseDelayMs, label: `gemini-vision:${m}` })
  return data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || ''
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

  // Vision is the ONLY step that can read PDFs, so it gets the most patient
  // retry budget: 5 attempts (~100s of backoff) on the configured model, since
  // Gemini 503 "high demand" spikes are usually temporary but can outlast a
  // few seconds. If that model is still overloaded, fall back to the coded
  // default vision model (a different capacity pool) before giving up —
  // this is a background job (fire-and-forget), so there's no client waiting
  // on a fast response.
  const candidates = [m]
  if (m !== PROVIDERS.gemini.defaultVisionModel) candidates.push(PROVIDERS.gemini.defaultVisionModel)

  const start = Date.now()
  let out, usedModel, lastErr
  for (const [i, candidate] of candidates.entries()) {
    const isLast = i === candidates.length - 1
    try {
      out = await callGeminiVisionModel(candidate, {
        apiKey, buffer, mimeType, prompt,
        attempts: isLast ? 5 : 3, baseDelayMs: 10000
      })
      usedModel = candidate
      break
    } catch (e) {
      lastErr = e
      if (isLast) throw e
      console.warn(`[gemini-vision] ${candidate} still failing after retries, falling back to ${candidates[i + 1]}: ${e.message.slice(0, 160)}`)
    }
  }
  if (out === undefined) throw lastErr

  logAi('vision', 'gemini', usedModel, 'ok', Date.now() - start, null)
  const parsed = extractJson(out)
  if (vkey) await setCachedAi(vkey, 'vision', 'gemini', usedModel, out, parsed)
  return parsed
}

export async function getVisionModel() {
  return getConfig('gemini.visionModel', PROVIDERS.gemini.defaultVisionModel)
}

// ---------------------------------------------------------------------------
// Gemini Batch Mode (Files API + Batch API) — ~50% cheaper than the normal
// synchronous vision call above, but async (Google's target turnaround is
// "up to 24h"). Used by routes/import.js's /pdf-batch route + background
// poller for large, non-urgent bulk PYQ imports. Field names in the Batch API
// request bodies MUST be exact camelCase (fileData/fileUri/mimeType/
// generationConfig/inputConfig/fileName/displayName) — confirmed against
// Google's discovery doc; unlike plain generateContent, batchGenerateContent
// rejects snake_case with a 400.
// ---------------------------------------------------------------------------

export async function geminiFilesUpload(buffer, { displayName, mimeType }) {
  const apiKey = await getConfig('gemini.apiKey')
  if (!apiKey) throw new Error('Gemini API key not configured')
  const base = PROVIDERS.gemini.base.replace('/v1beta', '')

  const start = await fetch(`${base}/upload/v1beta/files`, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(buffer.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ file: { displayName } })
  })
  if (!start.ok) throw new Error(`Gemini Files API start failed: HTTP ${start.status} ${await start.text()}`)
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini Files API did not return an upload URL')

  const done = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Length': String(buffer.length), 'X-Goog-Upload-Offset': '0', 'X-Goog-Upload-Command': 'upload, finalize' },
    body: buffer
  })
  if (!done.ok) throw new Error(`Gemini Files API upload failed: HTTP ${done.status} ${await done.text()}`)
  let file = (await done.json()).file
  for (let i = 0; file?.state === 'PROCESSING' && i < 10; i++) {
    await new Promise((r) => setTimeout(r, 2000))
    const r2 = await fetch(`${base}/v1beta/${file.name}`, { headers: { 'x-goog-api-key': apiKey } })
    file = await r2.json()
  }
  if (file?.state === 'FAILED') throw new Error(`Gemini file processing failed for ${displayName}`)
  return file // { name: "files/xxx", uri, state, ... }
}

export async function createGeminiBatch(model, requestsJsonl, displayName) {
  const apiKey = await getConfig('gemini.apiKey')
  if (!apiKey) throw new Error('Gemini API key not configured')
  const base = PROVIDERS.gemini.base.replace('/v1beta', '')
  const jsonlFile = await geminiFilesUpload(Buffer.from(requestsJsonl, 'utf8'), { displayName: `${displayName}-requests.jsonl`, mimeType: 'application/jsonl' })

  const res = await fetch(`${base}/v1beta/models/${model}:batchGenerateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch: { displayName, inputConfig: { fileName: jsonlFile.name } } })
  })
  if (!res.ok) throw new Error(`Gemini batchGenerateContent failed: HTTP ${res.status} ${await res.text()}`)
  return res.json() // { name: "batches/xxxx", state, ... }
}

export async function getGeminiBatch(batchName) {
  const apiKey = await getConfig('gemini.apiKey')
  if (!apiKey) throw new Error('Gemini API key not configured')
  const base = PROVIDERS.gemini.base.replace('/v1beta', '')
  const res = await fetch(`${base}/v1beta/${batchName}`, { headers: { 'x-goog-api-key': apiKey } })
  if (!res.ok) throw new Error(`Gemini batch status failed: HTTP ${res.status} ${await res.text()}`)
  return res.json()
}

export async function downloadGeminiResultsFile(fileName) {
  const apiKey = await getConfig('gemini.apiKey')
  if (!apiKey) throw new Error('Gemini API key not configured')
  const base = PROVIDERS.gemini.base.replace('/v1beta', '')
  const res = await fetch(`${base}/download/v1beta/${fileName}:download?alt=media`, { headers: { 'x-goog-api-key': apiKey } })
  if (!res.ok) throw new Error(`Gemini results download failed: HTTP ${res.status} ${await res.text()}`)
  return res.text()
}

// Confirmed enum (Google discovery doc, GenerateContentBatch.state):
// BATCH_STATE_PENDING | RUNNING | SUCCEEDED | FAILED | CANCELLED | EXPIRED.
export function geminiBatchState(job) {
  return job?.state || 'BATCH_STATE_UNSPECIFIED'
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
