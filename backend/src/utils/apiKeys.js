import crypto from 'crypto'
import db from '../db.js'

// ---------------------------------------------------------------------------
// Institute API keys (B2B integrations).
//
// A platform admin can mint an API key for any institute. External systems
// (school ERP, enrollment scripts, SIS connectors) then call the
// /api/institutes/ext/* endpoints with:  X-API-Key: <raw key>
//
// Security model:
//   - The RAW key is shown exactly once at creation (like Stripe/GitHub
//     tokens) — only its sha256 hash is stored, so a DB leak never leaks keys.
//   - Prefix (first 12 chars) is kept for display/identification in the UI.
//   - api_enabled is an instant kill-switch without deleting the key.
//   - External requests are rate-limited per institute and can only touch
//     THEIR OWN institute's data (scoped by middleware, never by request body).
// ---------------------------------------------------------------------------

const PREFIX_LEN = 12

export function generateRawKey() {
  // Inst-prefixed so leaked keys are identifiable in logs/scanners
  return `inst_${crypto.randomBytes(24).toString('base64url')}`
}

export function hashKey(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex')
}

/**
 * Mint (or replace) the API key for an institute.
 * One active key per institute keeps ops simple — generating a new key
 * revokes the old one automatically.
 * @returns {{ raw: string, prefix: string }} raw key (show once!) + prefix
 */
export async function createApiKey(instituteId) {
  const raw = generateRawKey()
  const prefix = raw.slice(0, PREFIX_LEN)
  await db.prepare(
    'UPDATE institutes SET api_key_hash = ?, api_key_prefix = ?, api_enabled = 1 WHERE id = ?'
  ).run(hashKey(raw), prefix, Number(instituteId))
  return { raw, prefix }
}

export async function revokeApiKey(instituteId) {
  await db.prepare('UPDATE institutes SET api_enabled = 0 WHERE id = ?').run(Number(instituteId))
}

export async function enableApiKey(instituteId) {
  await db.prepare('UPDATE institutes SET api_enabled = 1 WHERE id = ?').run(Number(instituteId))
}

/**
 * Resolve an incoming X-API-Key to its institute.
 * @returns {number|null} institute_id, or null when the key is
 *   missing/unknown/disabled (callers turn null into a 401).
 */
export async function resolveApiKey(rawKey) {
  const key = String(rawKey || '').trim()
  if (!key) return null
  const row = await db.prepare(
    'SELECT id FROM institutes WHERE api_key_hash = ? AND api_enabled = 1 AND is_active = 1'
  ).get(hashKey(key))
  return row ? Number(row.id) : null
}

/** Safe summary for admin UIs (never the raw key or its hash). */
export function apiKeySummary(institute) {
  if (!institute?.api_key_hash) return { configured: false }
  return {
    configured: true,
    enabled: Boolean(Number(institute.api_enabled)),
    prefix: institute.api_key_prefix || null
  }
}
