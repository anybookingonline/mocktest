import db from '../db.js'

// ---------------------------------------------------------------------------
// FB-style recognition points ("XP"). Every meaningful action earns points:
//   register 5 · test complete 10 (+2 per 10% accuracy band) · perfect test 25
//   doubt asked 5 · AI doubt resolved 3 · voice doubt 5 · battle win 15
//   battle draw 8 · battle loss 4 · group created 10 · group message 2 (cap/day)
//   revision mock done 10 · focus areas viewed 3 (cap/day) · profile complete 5
// Anti-spam: per-action daily caps + duplicate-guard for idempotent events.
// ---------------------------------------------------------------------------

const RULES = {
  register: { points: 5, dailyCap: 1 },
  test_completed: { points: 10, bonusPerBand: 2, dailyCap: 20 },
  perfect_test: { points: 25, dailyCap: 5 },
  doubt_asked: { points: 5, dailyCap: 10 },
  doubt_resolved: { points: 3, dailyCap: 10 },
  voice_doubt: { points: 5, dailyCap: 10 },
  battle_win: { points: 15, dailyCap: 10 },
  battle_draw: { points: 8, dailyCap: 10 },
  battle_loss: { points: 4, dailyCap: 10 },
  battle_played: { points: 2, dailyCap: 10 },
  group_created: { points: 10, dailyCap: 2 },
  group_joined: { points: 5, dailyCap: 5 },
  group_message: { points: 2, dailyCap: 15 },
  revision_mock: { points: 10, dailyCap: 3 },
  revision_streak: { points: 3, dailyCap: 5 },
  focus_viewed: { points: 3, dailyCap: 1 },
  invite_accepted: { points: 10, dailyCap: 20 },
  profile_completed: { points: 5, dailyCap: 1 }
}

export const LEVELS = [
  { level: 1, name: 'Newbie', min: 0, icon: '🌱' },
  { level: 2, name: 'Learner', min: 50, icon: '📘' },
  { level: 3, name: 'Achiever', min: 200, icon: '⚡' },
  { level: 4, name: 'Champion', min: 500, icon: '🏅' },
  { level: 5, name: 'Master', min: 1000, icon: '🔥' },
  { level: 6, name: 'Legend', min: 2500, icon: '👑' }
]

export function levelFor(points) {
  let cur = LEVELS[0]
  for (const l of LEVELS) if (points >= l.min) cur = l
  const next = LEVELS.find((l) => l.min > points)
  return {
    ...cur,
    points,
    next: next ? { ...next, need: next.min - points } : null,
    progress: next ? Math.min(100, Math.round(((points - cur.min) / (next.min - cur.min)) * 100)) : 100
  }
}

// Core award. `dedupe` (a string) makes the event idempotent — re-sending the
// same event (e.g. test complete retried) never double-awards.
export async function awardPoints(userId, action, { points = null, meta = null, dedupe = null } = {}) {
  try {
    const rule = RULES[action]
    if (!rule) return { ok: false, error: 'unknown action' }
    if (dedupe) {
      const seen = await db.prepare(`SELECT id FROM points_log WHERE user_id = ? AND action = ? AND meta_json = ? LIMIT 1`)
        .get(Number(userId), action, dedupe)
      if (seen) return { ok: false, error: 'already awarded' }
    }
    if (rule.dailyCap) {
      const today = await db.prepare(`SELECT COALESCE(SUM(points),0) c FROM points_log
        WHERE user_id = ? AND action = ? AND created_at::date = current_date`).get(Number(userId), action)
      if (Number(today?.c) >= rule.dailyCap * 25) return { ok: false, error: 'daily cap' }
    }
    let award = points != null ? Math.max(1, Math.min(500, Number(points))) : rule.points
    // accuracy bonus bands: >=50% +2, >=70% +4, >=85% +6, 100% handled via perfect_test
    if (action === 'test_completed' && rule.bonusPerBand && meta?.accuracy != null) {
      const a = Number(meta.accuracy)
      award += a >= 85 ? 6 : a >= 70 ? 4 : a >= 50 ? 2 : 0
    }
    const r = await db.prepare(`INSERT INTO points_log (user_id, points, action, meta_json)
      VALUES (?, ?, ?, ?)`).run(Number(userId), award, action, dedupe || JSON.stringify(meta || {}))
    if (!r.lastInsertRowid) return { ok: false, error: 'insert failed' }
    await db.prepare('UPDATE users SET points = COALESCE(points,0) + ? WHERE id = ?').run(award, Number(userId))
    const lvl = levelFor(Number((await db.prepare('SELECT points FROM users WHERE id = ?').get(Number(userId)))?.points) || 0)
    return { ok: true, awarded: award, level: lvl.level, levelName: lvl.name, leveledUp: lvl.level !== levelFor((await db.prepare('SELECT points FROM users WHERE id = ?').get(Number(userId)))?.points - award || 0).level && lvl.level > 1 }
  } catch {
    return { ok: false, error: 'points award failed' }
  }
}

export async function pointsSummary(userId) {
  const u = await db.prepare('SELECT points FROM users WHERE id = ?').get(Number(userId))
  const total = Number(u?.points) || 0
  const recent = await db.prepare(`SELECT action, points, created_at FROM points_log
    WHERE user_id = ? ORDER BY id DESC LIMIT 12`).all(Number(userId))
  const week = await db.prepare(`SELECT COALESCE(SUM(points),0) c FROM points_log
    WHERE user_id = ? AND created_at::timestamptz > now() - interval '7 days'`).get(Number(userId))
  const rankRow = await db.prepare(`SELECT COUNT(*) + 1 c FROM users WHERE COALESCE(points,0) > ?`).get(total)
  const totalUsers = await db.prepare(`SELECT COUNT(*) c FROM users WHERE COALESCE(points,0) > 0`).get()
  return {
    total, weekly: Number(week?.c) || 0,
    globalRank: Number(rankRow?.c) || 1,
    totalRanked: Number(totalUsers?.c) || 0,
    level: levelFor(total),
    recent: recent.map((r) => ({ ...r, points: Number(r.points) }))
  }
}

// Global points leaderboard (recognition wall)
export async function pointsLeaderboard({ limit = 50, userId = null } = {}) {
  const rows = await db.prepare(`SELECT u.id, u.name, COALESCE(u.points,0) points, u.elo,
    (SELECT COUNT(*) FROM points_log p WHERE p.user_id = u.id) events
    FROM users u WHERE COALESCE(u.points,0) > 0 ORDER BY u.points DESC LIMIT ${Math.max(1, Math.min(100, Number(limit) || 50))}`).all()
  let me = null
  if (userId) {
    me = rows.find((r) => Number(r.id) === Number(userId)) || null
    if (!me) {
      const mine = await db.prepare('SELECT id, name, COALESCE(points,0) points FROM users WHERE id = ?').get(Number(userId))
      if (mine) {
        const above = await db.prepare('SELECT COUNT(*) c FROM users WHERE COALESCE(points,0) > ?').get(mine.points)
        me = { ...mine, rank: Number(above?.c) + 1 }
      }
    } else {
      me.rank = rows.findIndex((r) => Number(r.id) === Number(userId)) + 1
    }
  }
  return { top: rows.map((r) => ({ ...r, points: Number(r.points), elo: Number(r.elo) || 0 })), me }
}
