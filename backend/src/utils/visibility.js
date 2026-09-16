import db from '../db.js'
import { hashContent } from './aiService.js'

// ---------------------------------------------------------------------------
// Institute content isolation (Phase 5) — visibility rule, defined ONCE:
//
//   questions.institute_id IS NULL  -> platform/curated GLOBAL (everyone)
//   questions.institute_id = X      -> institute-private (only institute X)
//
// Every question-retrieval query in the app MUST end with one of these:
//   visibilitySql(userId)  -> "AND (institute_id IS NULL OR institute_id = $n)"
//   visibilitySqlAdmin()   -> "AND institute_id IS NULL" (platform-only views)
//
// Auth workers (attempts already in progress, battle rounds already drawn)
// resolve through visibilityInstId(user) so a finished session never breaks —
// but any NEW retrieval is always filtered server-side.
// ---------------------------------------------------------------------------

// Resolve the caller's institute id (0 = no institute → global-only).
export async function visibilityInstId(userId) {
  if (!userId) return 0
  try {
    const u = await db.prepare('SELECT institute_id FROM users WHERE id = ?').get(Number(userId))
    return Number(u?.institute_id) || 0
  } catch {
    return 0
  }
}

// SQL fragment (AND-prefixed) + positional params for a student-facing query.
// instId 0 (no institute) sees ONLY global questions; instId X sees global + X.
export function visibilitySql(instId, startIndex) {
  if (instId > 0) {
    return { sql: ` AND (institute_id IS NULL OR institute_id = $${startIndex})`, params: [instId] }
  }
  return { sql: ' AND institute_id IS NULL', params: [] }
}

// Platform-admin-facing views: only curated/global questions.
export function visibilitySqlAdmin() {
  return { sql: ' AND institute_id IS NULL', params: [] }
}

// ---------------------------------------------------------------------------
// Institute-scoped dedup hashing. The UNIQUE(content_hash) constraint is the
// dedup engine, so ownership must live INSIDE the hash:
//   institute imports  -> hash includes the institute id (same paper uploaded
//                         by two schools produces two independent question sets)
//   platform imports   -> plain content hash (global dedup, as before)
// Retrieval visibility (institute_id column) is untouched — ye sirf dedup
// scoping hai. approveStagedQuestions staging ka stored (scoped) hash hi INSERT
// karta hai, isliye publish path bhi automatically scoped ho jata hai.
// ---------------------------------------------------------------------------
export function scopedContentHash(rawContent, instituteId) {
  return hashContent(
    instituteId ? `inst:${Number(instituteId)}:${rawContent}` : String(rawContent)
  )
}
