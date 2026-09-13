import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Backblaze B2 storage (S3-compatible). Used for PDF/PYQ paper archives and
// payment proof screenshots when B2 credentials are configured; otherwise the
// local uploads/ directory is used (dev mode).
//
// Env vars:
//   B2_KEY_ID / B2_APP_KEY  — Backblaze application key pair
//   B2_BUCKET_ID            — bucket ID (or set B2_BUCKET_NAME)
//   B2_BUCKET_NAME          — optional; enables friendly public URLs
//   B2_PUBLIC_BASE_URL      — optional custom domain (e.g. https://cdn.examai.app)
//
// Uses the native B2 REST API (no SDK needed):
//   1. b2_authorize_account  -> auth token + API + download URL
//   2. b2_get_upload_url     -> per-bucket upload URL + token
//   3. b2_upload_file        -> PUT the bytes
// Auth is cached in-process and re-authorized automatically on expiry.
// ---------------------------------------------------------------------------

const KEY_ID = process.env.B2_KEY_ID
const APP_KEY = process.env.B2_APP_KEY
const BUCKET_ID = process.env.B2_BUCKET_ID
const BUCKET_NAME = process.env.B2_BUCKET_NAME || ''
const PUBLIC_BASE = (process.env.B2_PUBLIC_BASE_URL || '').replace(/\/$/, '')

let auth = null // { token, apiUrl, downloadUrl, expiresAt }

export function b2Configured() {
  return Boolean(KEY_ID && APP_KEY && (BUCKET_ID || BUCKET_NAME))
}

export function b2Status() {
  return {
    configured: b2Configured(),
    bucket: BUCKET_NAME || BUCKET_ID || null,
    publicBase: PUBLIC_BASE || null,
    mode: b2Configured() ? 'b2' : 'local'
  }
}

async function authorize(force = false) {
  if (!b2Configured()) throw new Error('Backblaze B2 is not configured (set B2_KEY_ID, B2_APP_KEY, B2_BUCKET_ID)')
  if (!force && auth && auth.expiresAt > Date.now()) return auth
  const basic = Buffer.from(`${KEY_ID}:${APP_KEY}`).toString('base64')
  const res = await fetch('https://api.backblazeb2.com/b2api/v3/b2_authorize_account', {
    headers: { Authorization: `Basic ${basic}` }
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.message || `B2 authorization failed (${res.status})`)
  auth = {
    token: data.authorizationToken,
    apiUrl: data.apiUrl,
    downloadUrl: data.downloadUrl,
    // B2 tokens are valid 24h; refresh after 23h to be safe
    expiresAt: Date.now() + 23 * 60 * 60 * 1000
  }
  return auth
}

let uploadUrlCache = null // { uploadUrl, token, expiresAt }

async function getUploadUrl() {
  const a = await authorize()
  if (uploadUrlCache && uploadUrlCache.expiresAt > Date.now()) return uploadUrlCache
  const body = BUCKET_ID ? { bucketId: BUCKET_ID } : { bucketName: BUCKET_NAME }
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
  if (PUBLIC_BASE) return `${PUBLIC_BASE}/${key}`
  if (BUCKET_NAME) {
    const a = auth
    if (a?.downloadUrl) return `${a.downloadUrl}/file/${BUCKET_NAME}/${key}`
    // downloadUrl is stable per-account region: fall back to the generic pattern
    return `B2_DOWNLOAD_URL/file/${BUCKET_NAME}/${key}`
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
  const res = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      Authorization: token,
      'X-Bz-File-Name': encodeURIComponent(key),
      'Content-Type': contentType,
      'X-Bz-Content-Sha1': sha1,
      'X-Bz-Server-Side-Encryption': 'AES256'
    },
    body: new Uint8Array(buffer)
  })
  if (res.status === 401) {
    // upload token expired/rotated — retry once with a fresh one
    uploadUrlCache = null
    const retry = await getUploadUrl()
    const r2 = await fetch(retry.uploadUrl, {
      method: 'POST',
      headers: {
        Authorization: retry.token,
        'X-Bz-File-Name': encodeURIComponent(key),
        'Content-Type': contentType,
        'X-Bz-Content-Sha1': sha1,
        'X-Bz-Server-Side-Encryption': 'AES256'
      },
      body: new Uint8Array(buffer)
    })
    if (!r2.ok) throw new Error(`B2 upload failed (${r2.status})`)
    return { key, publicUrl: publicUrlForKey(key) }
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
  const url = PUBLIC_BASE
    ? `${PUBLIC_BASE}/${key}`
    : `${a.downloadUrl}/file/${BUCKET_NAME}/${encodeURIComponent(key)}`
  const res = await fetch(url, { headers: { Authorization: a.token } })
  if (!res.ok) throw new Error(`B2 download failed (${res.status})`)
  return Buffer.from(await res.arrayBuffer())
}

/**
 * Upload a local file to B2 (if configured) and return the public URL.
 * Returns null when B2 is not configured so callers can keep the local copy.
 */
export async function putFile(filePath, { prefix = 'files', filename, contentType } = {}) {
  if (!b2Configured()) return null
  const fs = await import('fs')
  const buffer = fs.readFileSync(filePath)
  const safeName = String(filename || filePath.split('/').pop()).replace(/[^\w.\-]/g, '_')
  const key = `${prefix}/${Date.now()}-${safeName}`
  const { publicUrl } = await uploadToB2(buffer, key, contentType || 'application/octet-stream')
  return publicUrl
}
