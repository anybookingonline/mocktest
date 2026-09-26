import db from '../db.js'
import { cacheGet, cacheSet } from './redis.js'

// ---------------------------------------------------------------------------
// Visitor tracking (first-party, cookie-free). Dedupe window: one hit per
// (visitor_id + path) per 24 hours — reloads, SPA re-renders and new tab
// sessions within the same day never inflate counts. visitor_id is a stable
// random browser id (localStorage), so uniqueness survives tab/session
// restarts; using raw IP instead would wrongly merge whole college/office
// NAT networks into one visitor. IP is still stored on every row for the
// admin detail table. Everything degrades gracefully: tracking never breaks
// a page load.
// ---------------------------------------------------------------------------

const DEDUPE_TTL_SEC = 24 * 60 * 60

// Normalize a referrer to a readable source label (admin table "Source" col).
export function normalizeSource(referrer) {
  try {
    if (!referrer) return 'direct'
    const u = new URL(referrer)
    const host = (u.hostname || '').replace(/^www\./, '').toLowerCase()
    if (!host) return 'direct'
    if (/google\./.test(host)) return 'Google'
    if (/bing\./.test(host)) return 'Bing'
    if (/duckduckgo/.test(host)) return 'DuckDuckGo'
    if (/youtube\.com|youtu\.be/.test(host)) return 'YouTube'
    if (/instagram\.com/.test(host)) return 'Instagram'
    if (/facebook\.com|fb\.com/.test(host)) return 'Facebook'
    if (/twitter\.com|x\.com/.test(host)) return 'X (Twitter)'
    if (/t\.me|telegram/.test(host)) return 'Telegram'
    if (/whatsapp\.com/.test(host)) return 'WhatsApp'
    if (/reddit\.com/.test(host)) return 'Reddit'
    if (/linkedin\.com/.test(host)) return 'LinkedIn'
    if (/quora\.com/.test(host)) return 'Quora'
    // Same-origin navigation is just internal movement, not a referral.
    if (/aisepadho\.com$/.test(host)) return 'direct'
    return host
  } catch { return 'direct' }
}

// Coarse device class from the User-Agent (admin table only — no fancy libs).
export function parseDevice(ua) {
  const s = String(ua || '').toLowerCase()
  if (/ipad|tablet|playbook|silk|kindle/.test(s)) return 'tablet'
  if (/mobi|iphone|android|phone|ipod/.test(s)) return 'mobile'
  return 'desktop'
}

// Best-effort geo from reverse-proxy headers (Cloudflare first, then Vercel).
export function geoFromHeaders(req) {
  const h = req.headers || {}
  const country = String(h['cf-ipcountry'] || h['x-vercel-ip-country'] || '').toUpperCase().slice(0, 2)
  const city = String(h['cf-ipcity'] || h['x-vercel-ip-city'] || '').slice(0, 60)
  return { country, city, countryCode: country }
}

export async function trackVisit({ visitorId, sessionId, ip, referrer, userAgent, path, geo = {} }) {
  try {
    if (!visitorId || !sessionId) return
    // 24-hour per (visitor, path) dedupe — unique visitor per page per day.
    const key = `visit:${visitorId}:${path}`
    if (await cacheGet(key)) return
    await cacheSet(key, '1', DEDUPE_TTL_SEC)
    const source = normalizeSource(referrer)
    const device = parseDevice(userAgent)
    await db.prepare(`INSERT INTO visitor_hits (visitor_id, session_id, ip, country, country_code, city, path, referrer, source, device, user_agent)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
      .run(String(visitorId).slice(0, 64), String(sessionId).slice(0, 64), String(ip || '').slice(0, 60),
        String(geo.country || '').slice(0, 60), String(geo.countryCode || '').slice(0, 2), String(geo.city || '').slice(0, 60),
        String(path || '/').slice(0, 200), String(referrer || '').slice(0, 300),
        source, device, String(userAgent || '').slice(0, 250))
  } catch { /* tracking must never break a request */ }
}

// Summary for the admin Visitors page: unique visitors, pageviews and
// top-referrers for today / yesterday / all-time, plus a paginated detail table.
// Date filtering compares the TEXT created_at ('YYYY-MM-DD HH24:MI:SS') with
// JS-computed 'YYYY-MM-DD' boundary strings — lexicographically correct and
// identical across Postgres and the pg-mem test harness.
export async function visitorsSummary({ page = 1, perPage = 50 }) {
  const safePer = Math.min(Math.max(Number(perPage) || 50, 10), 200)
  const safePage = Math.max(Number(page) || 1, 1)
  const count = async (sql, ...p) => Number((await db.prepare(sql).get(...p))?.c || 0)

  // DB-side day boundaries (same clock that writes created_at) — no timezone drift.
  const days = await db.prepare(`SELECT to_char(now(), 'YYYY-MM-DD') today, to_char(now() - interval '1 day', 'YYYY-MM-DD') yday`).get()
  const today = days?.today || ''
  const yday = days?.yday || ''

  const [
    uniqToday, uniqYesterday, uniqTotal,
    viewsToday, viewsYesterday, viewsTotal
  ] = await Promise.all([
    count(`SELECT COUNT(DISTINCT visitor_id) c FROM visitor_hits WHERE created_at >= ?`, today),
    count(`SELECT COUNT(DISTINCT visitor_id) c FROM visitor_hits WHERE created_at >= ? AND created_at < ?`, yday, today),
    count(`SELECT COUNT(DISTINCT visitor_id) c FROM visitor_hits`),
    count(`SELECT COUNT(*) c FROM visitor_hits WHERE created_at >= ?`, today),
    count(`SELECT COUNT(*) c FROM visitor_hits WHERE created_at >= ? AND created_at < ?`, yday, today),
    count(`SELECT COUNT(*) c FROM visitor_hits`)
  ])

  const topSources = await db.prepare(`SELECT source,
      COUNT(*) hits,
      COUNT(DISTINCT visitor_id) visitors,
      COUNT(CASE WHEN created_at >= '${today}' THEN 1 END) today,
      COUNT(CASE WHEN created_at >= '${yday}' AND created_at < '${today}' THEN 1 END) yesterday
    FROM visitor_hits GROUP BY source ORDER BY hits DESC LIMIT 12`).all()

  const topCountries = await db.prepare(`SELECT CASE WHEN country IS NULL OR country = '' THEN 'Unknown' ELSE country END AS country,
      COUNT(*) hits, COUNT(DISTINCT visitor_id) visitors
    FROM visitor_hits GROUP BY CASE WHEN country IS NULL OR country = '' THEN 'Unknown' ELSE country END ORDER BY visitors DESC LIMIT 10`).all()

  const topPaths = await db.prepare(`SELECT path, COUNT(*) hits, COUNT(DISTINCT visitor_id) visitors
    FROM visitor_hits GROUP BY path ORDER BY hits DESC LIMIT 10`).all()

  // Detail table: one row per (session, path) group, latest hit wins.
  // Done in JS over a bounded scan (limit) so the SQL stays simple — the
  // recent window is what the admin table paginates through anyway.
  const total = await count(`SELECT COUNT(*) c FROM (SELECT 1 FROM visitor_hits GROUP BY session_id, path) x`)
  const pages = Math.max(1, Math.ceil(total / safePer))
  const scan = await db.prepare(`SELECT id, visitor_id, ip, country, country_code, city, path, referrer, source, device, session_id, created_at
    FROM visitor_hits ORDER BY id DESC LIMIT 5000`).all()
  const seen = new Set()
  const groups = []
  for (const h of scan) {
    const key = `${h.session_id}|${h.path}`
    if (seen.has(key)) continue
    seen.add(key)
    groups.push(h)
  }
  groups.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
  const rows = groups.slice((safePage - 1) * safePer, (safePage - 1) * safePer + safePer)

  return {
    summary: {
      today: { visitors: uniqToday, views: viewsToday },
      yesterday: { visitors: uniqYesterday, views: viewsYesterday },
      total: { visitors: uniqTotal, views: viewsTotal }
    },
    topSources, topCountries, topPaths,
    pagination: { page: safePage, perPage: safePer, total, pages },
    hits: rows.map((h) => ({ ...h, last_seen: h.created_at }))
  }
}
