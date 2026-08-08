import 'dotenv/config'
import { Redis } from '@upstash/redis'

// ---------------------------------------------------------------------------
// Cache layer. Uses Upstash Redis REST when UPSTASH_REDIS_REST_URL + TOKEN are
// set; otherwise falls back to a tiny in-process TTL cache so the app still
// works locally/offline. Every call degrades gracefully.
// ---------------------------------------------------------------------------

const url = process.env.UPSTASH_REDIS_REST_URL
const token = process.env.UPSTASH_REDIS_REST_TOKEN
const redis = url && token ? new Redis({ url, token }) : null

const mem = new Map() // key -> { v, exp }

export const redisReady = Boolean(redis)

function memGet(key) {
  const e = mem.get(key)
  if (!e) return null
  if (e.exp < Date.now()) { mem.delete(key); return null }
  return e.v
}

export async function cacheGet(key) {
  try {
    if (redis) return await redis.get(key)
    return memGet(key)
  } catch { return memGet(key) }
}

export async function cacheSet(key, value, ttlSeconds = 60) {
  try {
    if (redis) return await redis.set(key, value, { ex: ttlSeconds })
    mem.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 })
  } catch { mem.set(key, { v: value, exp: Date.now() + ttlSeconds * 1000 }) }
}

export async function cacheDel(...keys) {
  try {
    if (redis && keys.length) return await redis.del(...keys)
    keys.forEach((k) => mem.delete(k))
  } catch { keys.forEach((k) => mem.delete(k)) }
}

export function cacheStatus() {
  return { redis: redisReady, url: url || null, mode: redisReady ? 'upstash' : 'in-memory' }
}
