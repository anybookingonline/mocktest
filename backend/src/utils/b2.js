import crypto from 'crypto'
import { getConfig } from './aiService.js'

// ---------------------------------------------------------------------------
// Backblaze B2 storage (S3-compatible). Used for PDF/PYQ paper archives and
// payment proof screenshots when B2 credentials are configured; otherwise the
// local uploads/ directory is used (dev mode).
//
// Credentials resolution (env wins, admin panel fallback):
//   1. Env:  B2_KEY_ID / B2_APP_KEY / B2_BUCKET_ID (or B2_BUCKET_NAME)
//   2. Admin → Settings → Storage:  b2.keyId / b2.appKey / b2.bucketId
//
// Optional (friendly public URLs / custom CDN domain):
//   B2_BUCKET_NAME / b2.bucketName,  B2_PUBLIC_BASE_URL / b2.publicBaseUrl
//
// Uses the native B2 REST API (no SDK needed):
//   1. b2_authorize_account  -> auth token + API + download URL
//   2. b2_get_upload_url     -> per-bucket upload URL + token
//   3. b2_upload_file        -> PUT the bytes
// Auth is cached in-process and re-authorized automatically on expiry.
// ---------------------------------------------------------------------------

// Legacy sync aliases (kept so a stale import somewhere doesn't crash hard):
export function b2EnvConfigured() {
  return Boolean(process.env.B2_KEY_ID && process.env.B2_APP_KEY && (process.env.B2_BUCKET_ID || process.env.B2_BUCKET_NAME))
}

let auth = null // { token, apiUrl, downloadUrl, bucketName, publicBase, expiresAt }

// Normalize a public base URL: strip trailing slashes and add https:// when the
// scheme is missing (admins often paste "s3.us-east-005.backblazeb2.com" —
// "Failed to parse URL" naya b2.js kya hai uske bina).
function normalizeBaseUrl(raw) {
  let v = String(raw || '').trim().replace(/\/+$/, '')
  if (!v) return ''
  if (!/^https?:\/\//i.test(v)) v = `https://${v}`
  return v
}

export async function getB2Config() {
  const envKeyId = process.env.B2_KEY_ID
  const envAppKey = process.env.B2_APP_KEY
  const envBucketId = process.env.B2_BUCKET_ID
  const envBucketName = process.env.B2_BUCKET_NAME || ''
  const envPublicBase = normalizeBaseUrl(process.env.B2_PUBLIC_BASE_URL)
  if (envKeyId && envAppKey && (envBucketId || envBucketName)) {
    return { keyId: envKeyId, appKey: envAppKey, bucketId: envBucketId || '', bucketName: envBucketName, publicBase: envPublicBase, source: 'env' }
  }
  const [keyId, appKey, bucketId, bucketName, publicBase] = await Promise.all([
    getConfig('b2.keyId'), getConfig('b2.appKey'), getConfig('b2.bucketId'),
    getConfig('b2.bucketName'), getConfig('b2.publicBaseUrl')
  ])
  return {
    keyId: keyId || '', appKey: appKey || '', bucketId: bucketId || '',
    bucketName: bucketName || '', publicBase: normalizeBaseUrl(publicBase),
    source: 'settings'
  }
}

export async function b2Configured() {
  const c = await getB2Config()
  return Boolean(c.keyId && c.appKey && (c.bucketId || c.bucketName))
}

export async function b2Status() {
  const c = await getB2Config()
  const configured = Boolean(c.keyId && c.appKey && (c.bucketId || c.bucketName))
  return {
    configured,
    source: configured ? c.source : null,
    bucket: c.bucketName || c.bucketId || null,
    publicBase: c.publicBase || null,
    mode: configured ? 'b2' : 'local'
  }
}

/**
 * Full self-test: authorize → get upload URL → upload a tiny file →
 * read it back → delete it. Returns a step-by-step report (no secrets).
 * Leaves nothing behind in the bucket (diagnostics/ prefix, cleaned up).
 */
export async function b2SelfTest() {
  const steps = []
  const step = (name, ok, info = '') => { steps.push({ name, ok, info }); return ok }
  try {
    const a = await authorize(true)
    const region = typeof a.apiUrl === 'string' ? (a.apiUrl.match(/api(\d\d)/)?.[1] || 'ok') : 'ok'
    step('authorize', true, `region ${region}`)
  } catch (e) { step('authorize', false, e.message); return { ok: false, steps } }

  let key = null
  try {
    const c = await getB2Config()
    const body = c.bucketId ? { bucketId: c.bucketId } : { bucketName: c.bucketName }
    const res = await fetch(`${auth.apiUrl}/b2api/v3/b2_get_upload_url`, {
      method: 'POST',
      headers: { Authorization: auth.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || `get_upload_url failed (${res.status})`)
    step('upload_url', true, 'bucket reachable')

    key = `diagnostics/b2-selftest-${Date.now()}.txt`
    const payload = Buffer.from(`Aisepadho B2 self-test ${new Date().toISOString()}`)
    const sha1 = crypto.createHash('sha1').update(payload).digest('hex')
    const up = await fetch(data.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: data.authorizationToken,
        'X-Bz-File-Name': encodeURIComponent(key),
        'Content-Type': 'text/plain',
        'X-Bz-Content-Sha1': sha1,
        'X-Bz-Server-Side-Encryption': 'AES256'
      },
      body: new Uint8Array(payload)
    })
    if (!up.ok) throw new Error(`upload failed (${up.status})`)
    const upData = await up.json().catch(() => ({}))
    step('upload', true, key)

    // Round-trip via b2_download_file_by_id — authorized call, private buckets
    // par bhi chalta hai aur public base URL / bucket-name par depend nahi karta.
    const dlRes = await fetch(`${auth.apiUrl}/b2api/v3/b2_download_file_by_id?fileId=${encodeURIComponent(upData.fileId || '')}`,
      { headers: { Authorization: auth.token } })
    if (!dlRes.ok) throw new Error(`download failed (${dlRes.status})`)
    const buf = Buffer.from(await dlRes.arrayBuffer())
    step('download', buf.equals(payload), `${buf.length} bytes round-trip`)
  } catch (e) {
    step(key ? 'download' : 'upload', false, e.message)
  }

  try {
    if (key) {
      await deleteFromB2(key)
      step('delete', true, 'bucket clean')
    }
  } catch (e) { step('delete', false, e.message) }

  return { ok: steps.every((s) => s.ok), steps }
}

async function deleteFromB2(key) {
  const a = await authorize()
  const c = await getB2Config()
  // b2_delete_file_version needs fileId; simplest reliable path: list by name then delete
  const listRes = await fetch(`${a.apiUrl}/b2api/v3/b2_list_file_names?bucketId=${encodeURIComponent(c.bucketId)}&prefix=${encodeURIComponent(key)}&maxFileCount=1`, {
    headers: { Authorization: a.token }
  })
  const list = await listRes.json().catch(() => ({}))
  const file = list.files?.[0]
  if (!file) return // nothing to delete — fine
  await fetch(`${a.apiUrl}/b2api/v3/b2_delete_file_version`, {
    method: 'POST',
    headers: { Authorization: a.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileId: file.fileId, fileName: file.fileName })
  })
}

async function authorize(force = false) {
  const c = await getB2Config()
  if (!(c.keyId && c.appKey && (c.bucketId || c.bucketName))) {
    throw new Error('Backblaze B2 is not configured (env B2_KEY_ID/B2_APP_KEY/B2_BUCKET_ID ya Admin → Settings → Storage me daalo)')
  }
  if (!force && auth && auth.expiresAt > Date.now()) return auth
  const basic = Buffer.from(`${c.keyId}:${c.appKey}`).toString('base64')
  const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `B2 authorization failed (${res.status})`)
  // v3 API nests the storage endpoints under apiInfo.storageApi (v2 had them top-level).
  const sa = data.apiInfo?.storageApi || {}
  auth = {
    token: data.authorizationToken || sa.authorizationToken,
    apiUrl: sa.apiUrl || data.apiUrl,
    downloadUrl: sa.downloadUrl || data.downloadUrl,
    // Bucket-restricted app keys echo their bucket here — handy fallback when
    // the admin set only the key + bucket name and skipped bucket ID.
    keyBucketId: sa.bucketId || data.bucketId || null,
    bucketName: c.bucketName || null,
    publicBase: c.publicBase,
    // B2 tokens are valid 24h; refresh after 23h to be safe
    expiresAt: Date.now() + 23 * 60 * 60 * 1000
  }
  return auth
}

let uploadUrlCache = null // { uploadUrl, token, expiresAt }

async function getUploadUrl() {
  const a = await authorize()
  if (uploadUrlCache && uploadUrlCache.expiresAt > Date.now()) return uploadUrlCache
  const c = await getB2Config()
  const bucketId = c.bucketId || auth.keyBucketId
  const body = bucketId ? { bucketId } : { bucketName: c.bucketName }
  const res = await fetch(`${a.apiUrl}/b2api/v3/b2_get_upload_url`, {
    method: 'POST',
    headers: { Authorization: a.token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    // Auth token may have been revoked — re-authorize once
    if (res.status === 401) {
      await authorize(true)
      return getUploadUrl()
    }
    throw new Error(data.message || `B2 get_upload_url failed (${res.status})`)
  }
  uploadUrlCache = { uploadUrl: data.uploadUrl, token: data.authorizationToken, expiresAt: Date.now() + 60 * 60 * 1000 }
  return uploadUrlCache
}

export function publicUrlForKey(key) {
  if (auth?.publicBase) return `${auth.publicBase}/${key}`
  if (auth?.bucketName) {
    if (auth.downloadUrl) return `${auth.downloadUrl}/file/${auth.bucketName}/${key}`
    // downloadUrl is stable per-account region: fall back to the generic pattern
    return `B2_DOWNLOAD_URL/file/${auth.bucketName}/${key}`
  }
  return null // no public URL — stream through the API instead
}

/**
 * Upload a Buffer to B2. Returns { key, publicUrl } or throws.
 * @param {Buffer} buffer file bytes
 * @param {string} key object key, e.g. "pdfs/1726-NEET-2024.pdf"
 * @param {string} contentType mime type
 */
export async function uploadToB2(buffer, key, contentType = 'application/octet-stream') {
  const { uploadUrl, token } = await getUploadUrl()
  const sha1 = crypto.createHash('sha1').update(buffer).digest('hex')
  const doUpload = (url, tok) => fetch(url, {
    method: 'POST',
    headers: {
      Authorization: tok,
      'X-Bz-File-Name': encodeURIComponent(key),
      'Content-Type': contentType,
      'X-Bz-Content-Sha1': sha1,
      'X-Bz-Server-Side-Encryption': 'AES256'
    },
    body: new Uint8Array(buffer)
  })
  let res = await doUpload(uploadUrl, token)
  if (res.status === 401) {
    // upload token expired/rotated — retry once with a fresh one
    uploadUrlCache = null
    const retry = await getUploadUrl()
    res = await doUpload(retry.uploadUrl, retry.token)
  }
  if (!res.ok) {
    const t = await res.text().catch(() => '')
    throw new Error(`B2 upload failed (${res.status}): ${t.slice(0, 200)}`)
  }
  return { key, publicUrl: publicUrlForKey(key) }
}

/**
 * Read a file from B2 into a Buffer (used to feed Gemini Vision from storage).
 */
export async function downloadFromB2(key) {
  const a = await authorize()
  const c = await getB2Config()
  // NOTE: ye server-side authorized download hai — hamesha B2 ke apne
  // downloadUrl se jaata hai (private buckets par bhi kaam karta hai).
  // publicBase sirf user-facing friendly URLs ke liye hai (publicUrlForKey).
  const url = `${a.downloadUrl}/file/${encodeURIComponent(c.bucketName || auth.bucketName || '')}/${encodeURIComponent(key)}`
  const res = await fetch(url, { headers: { Authorization: a.token } })
  if (!res.ok) throw new Error(`B2 download failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Upload a local file to B2 (if configured) and return the public URL.
 * Returns null when B2 is not configured so callers can keep the local copy.
 */
export async function putFile(filePath, { prefix = 'files', filename, contentType } = {}) {
  if (!(await b2Configured())) return null
  const fs = await import('fs')
  const buffer = fs.readFileSync(filePath)
  const safeName = String(filename || filePath.split('/').pop()).replace(/[^\w.\-]/g, '_')
  const key = `${prefix}/${Date.now()}-${safeName}`
  const { publicUrl } = await uploadToB2(buffer, key, contentType || 'application/octet-stream')
  return publicUrl
}
