import db from '../db.js'
import { getConfig, setConfig } from './aiService.js'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// Group Study & Discussions.
//
// Business model (admin-configurable, DB-backed):
//   - Group Study is free to use (zero infra cost: plain Postgres rows, no
//     realtime service needed). Free users can own `groupsFreeForFree`
//     groups; paid users `groupsFreeForPaid`.
//   - Group Discussions is the paid-side feature (chat load + moderation),
//     but groups earn free seats: every `freeAfterPaid` paying members unlock
//     `freeSlots` free discussion seats (capped at maxFree). Default deal:
//     2 paid -> 1 free seat. Admin can set e.g. freeAfterPaid=3, freeSlots=1
//     to make it "4 ka group, 1 free".
//
// The deal is recalculated server-side whenever a payment completes, so it
// can never drift. No third-party service is required for either feature.
// ---------------------------------------------------------------------------

export const GROUP_DEFAULTS = {
  freeAfterPaid: 2, // paid members needed to unlock free seats
  freeSlots: 1,     // free seats unlocked per deal
  maxFree: 3,       // hard cap on free seats per group
  groupsFreeForFree: 1,
  groupsFreeForPaid: 3,
  maxMembers: 20,
  freeSeatDays: 45  // free seats are re-issued with this validity on recompute
}

function num(v, d) {
  const x = Number(v)
  return Number.isFinite(x) && x >= 0 ? x : d
}

export async function getGroupConfig() {
  const [freeAfterPaid, freeSlots, maxFree, groupsFreeForFree, groupsFreeForPaid, maxMembers, freeSeatDays, enabled, discussionsEnabled] = await Promise.all([
    getConfig('groups.freeAfterPaid', String(GROUP_DEFAULTS.freeAfterPaid)),
    getConfig('groups.freeSlots', String(GROUP_DEFAULTS.freeSlots)),
    getConfig('groups.maxFree', String(GROUP_DEFAULTS.maxFree)),
    getConfig('groups.groupsFreeForFree', String(GROUP_DEFAULTS.groupsFreeForFree)),
    getConfig('groups.groupsFreeForPaid', String(GROUP_DEFAULTS.groupsFreeForPaid)),
    getConfig('groups.maxMembers', String(GROUP_DEFAULTS.maxMembers)),
    getConfig('groups.freeSeatDays', String(GROUP_DEFAULTS.freeSeatDays)),
    getConfig('features.groupStudy', 'false'),
    getConfig('features.groupDiscussions', 'false')
  ])
  return {
    freeAfterPaid: num(freeAfterPaid, GROUP_DEFAULTS.freeAfterPaid),
    freeSlots: num(freeSlots, GROUP_DEFAULTS.freeSlots),
    maxFree: num(maxFree, GROUP_DEFAULTS.maxFree),
    groupsFreeForFree: num(groupsFreeForFree, GROUP_DEFAULTS.groupsFreeForFree),
    groupsFreeForPaid: num(groupsFreeForPaid, GROUP_DEFAULTS.groupsFreeForPaid),
    maxMembers: num(maxMembers, GROUP_DEFAULTS.maxMembers),
    freeSeatDays: num(freeSeatDays, GROUP_DEFAULTS.freeSeatDays),
    enabled: enabled === 'true',
    discussionsEnabled: discussionsEnabled === 'true'
  }
}

export async function getGroupFeatureFlags() {
  const cfg = await getGroupConfig()
  return { groupStudy: cfg.enabled, groupDiscussions: cfg.discussionsEnabled, maxMembers: cfg.maxMembers }
}

export async function saveGroupConfig(patch = {}) {
  const map = {
    freeAfterPaid: 'groups.freeAfterPaid',
    freeSlots: 'groups.freeSlots',
    maxFree: 'groups.maxFree',
    groupsFreeForFree: 'groups.groupsFreeForFree',
    groupsFreeForPaid: 'groups.groupsFreeForPaid',
    maxMembers: 'groups.maxMembers',
    freeSeatDays: 'groups.freeSeatDays',
    enabled: 'features.groupStudy',
    discussionsEnabled: 'features.groupDiscussions'
  }
  for (const [k, v] of Object.entries(patch)) {
    if (map[k] !== undefined && v !== undefined && v !== null && v !== '') await setConfig(map[k], String(v))
  }
}

export async function isUserPaid(userId) {
  const { getEntitlements } = await import('./addons.js')
  const e = await getEntitlements(userId)
  return Boolean(e.retention || e.aiPower || e.voiceDoubts)
}

function makeCode() {
  // Unambiguous alphabet (no I/L/O/0/1)
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const buf = crypto.randomBytes(6)
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[buf[i] % alphabet.length]
  return out
}

function untilStr(date) {
  return date.toISOString().replace('T', ' ').slice(0, 19)
}

// ---------------------------------------------------------------------------
// Deal engine — the single source of truth for "N paid -> M free".
// Free seats are implemented as a `group_discussions` add-on row in
// user_addons, so the existing entitlement checks just work. It only ever
// touches the group addon — never ai_power / voice_doubts / retention.
// ---------------------------------------------------------------------------

export async function recomputeGroupEntitlements(groupId) {
  const cfg = await getGroupConfig()
  const members = await db.prepare('SELECT user_id, member_paid FROM group_members WHERE group_id = ?').all(groupId)
  const paidCount = members.filter((m) => Number(m.member_paid)).length
  const freeUnlocked = paidCount >= cfg.freeAfterPaid ? Math.min(cfg.freeSlots, cfg.maxFree) : 0
  const freeIds = members.filter((m) => !Number(m.member_paid)).map((m) => m.user_id)
  for (let i = 0; i < freeIds.length; i++) {
    const uid = freeIds[i]
    if (i >= freeUnlocked) {
      await db.prepare("DELETE FROM user_addons WHERE user_id = ? AND addon_id = 'group_discussions'").run(uid)
    } else {
      const until = untilStr(new Date(Date.now() + cfg.freeSeatDays * 86400000))
      await db.prepare(`INSERT INTO user_addons (user_id, addon_id, expires_at, created_at)
        VALUES (?, 'group_discussions', ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
        ON CONFLICT (user_id, addon_id) DO UPDATE SET expires_at = excluded.expires_at`).run(uid, until)
    }
  }
  return { members: members.length, paidCount, freeUnlocked }
}

// Called from the payments flow when a user's payment succeeds.
export async function markMemberPaid(groupId, userId, paymentId) {
  await db.prepare(`INSERT INTO group_members (group_id, user_id, role, member_paid, payment_id, joined_at)
    VALUES (?, ?, 'member', 1, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))
    ON CONFLICT (group_id, user_id) DO UPDATE SET member_paid = 1, payment_id = COALESCE(excluded.payment_id, group_members.payment_id)`)
    .run(groupId, userId, paymentId || null)
  return recomputeGroupEntitlements(groupId)
}

export async function createGroup({ ownerId, name, examId, kind }) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = makeCode()
    const exists = await db.prepare('SELECT id FROM group_orders WHERE join_code = ?').get(code)
    if (exists) continue
    const r = await db.prepare(`INSERT INTO group_orders (owner_id, name, exam_id, kind, join_code, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, 1, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`)
      .run(ownerId, String(name || 'Study Group').slice(0, 80), examId || null, kind === 'discussion' ? 'discussion' : 'study', code)
    const groupId = r.lastInsertRowid
    await db.prepare(`INSERT INTO group_members (group_id, user_id, role, member_paid, joined_at)
      VALUES (?, ?, 'owner', 0, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`).run(groupId, ownerId)
    await recomputeGroupEntitlements(groupId)
    return { groupId, code }
  }
  throw new Error('Could not allocate a unique join code')
}

export async function joinGroup({ userId, code }) {
  const g = await db.prepare('SELECT * FROM group_orders WHERE join_code = ? AND is_active = 1').get(String(code || '').toUpperCase())
  if (!g) return { error: 'Invalid join code' }
  const cfg = await getGroupConfig()
  const members = await db.prepare('SELECT user_id, member_paid FROM group_members WHERE group_id = ?').all(g.id)
  if (members.some((m) => m.user_id === userId)) return { groupId: g.id, already: true }
  if (members.length >= cfg.maxMembers) return { error: `Group is full (max ${cfg.maxMembers} members)` }
  await db.prepare(`INSERT INTO group_members (group_id, user_id, role, member_paid, joined_at)
    VALUES (?, ?, 'member', 0, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`).run(g.id, userId)
  const deal = await recomputeGroupEntitlements(g.id)
  return { groupId: g.id, deal }
}

export async function leaveGroup({ userId, groupId }) {
  const g = await db.prepare('SELECT * FROM group_orders WHERE id = ?').get(groupId)
  if (!g) return { error: 'Group not found' }
  const m = await db.prepare('SELECT * FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId)
  if (!m) return { error: 'Not a member of this group' }
  if (m.role === 'owner') {
    const others = await db.prepare('SELECT COUNT(*) c FROM group_members WHERE group_id = ? AND user_id <> ?').get(groupId, userId)
    if (Number(others.c) > 0) return { error: 'Owner cannot leave while other members are in the group — ask members to leave first.' }
    await db.prepare('DELETE FROM group_orders WHERE id = ?').run(groupId)
    return { deleted: true }
  }
  await db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, userId)
  await recomputeGroupEntitlements(groupId)
  return { left: true }
}

export async function isGroupMember(groupId, userId) {
  return Boolean(await db.prepare('SELECT 1 x FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId))
}

export async function groupDetail({ groupId, userId }) {
  const g = await db.prepare(`SELECT g.*, u.name owner_name FROM group_orders g JOIN users u ON u.id = g.owner_id WHERE g.id = ?`).get(groupId)
  if (!g) return null
  const me = await db.prepare('SELECT role, member_paid FROM group_members WHERE group_id = ? AND user_id = ?').get(groupId, userId)
  if (!me) return { forbidden: true }
  const cfg = await getGroupConfig()
  const members = await db.prepare(`SELECT gm.user_id, gm.role, gm.member_paid, u.name, u.email
    FROM group_members gm JOIN users u ON u.id = gm.user_id WHERE gm.group_id = ? ORDER BY gm.joined_at`).all(groupId)
  const paidCount = members.filter((m) => Number(m.member_paid)).length
  const freeUnlocked = paidCount >= cfg.freeAfterPaid ? Math.min(cfg.freeSlots, cfg.maxFree) : 0
  const messages = cfg.discussionsEnabled
    ? (await db.prepare(`SELECT m.id, m.body, m.created_at, m.user_id, u.name user_name
        FROM group_messages m JOIN users u ON u.id = m.user_id WHERE m.group_id = ? ORDER BY m.id DESC LIMIT 60`).all(groupId)).reverse()
    : []
  return {
    group: { id: g.id, name: g.name, kind: g.kind, examId: g.exam_id, joinCode: g.join_code, isOwner: me.role === 'owner', createdAt: g.created_at },
    ownerName: g.owner_name,
    members: members.map((m) => ({ id: m.user_id, name: m.name, email: m.email, role: m.role, paid: Boolean(Number(m.member_paid)) })),
    paidCount,
    freeUnlocked,
    discussionsEnabled: cfg.discussionsEnabled,
    deal: { freeAfterPaid: cfg.freeAfterPaid, freeSlots: cfg.freeSlots, maxMembers: cfg.maxMembers, maxFree: cfg.maxFree },
    messages
  }
}

export async function messagesSince(groupId, afterId) {
  return db.prepare(`SELECT m.id, m.body, m.created_at, m.user_id, u.name user_name
    FROM group_messages m JOIN users u ON u.id = m.user_id
    WHERE m.group_id = ? AND m.id > ? ORDER BY m.id ASC LIMIT 100`).all(groupId, Number(afterId) || 0)
}

export async function listMyGroups(userId) {
  // No correlated subqueries here on purpose — they are portable SQL but some
  // engines choke on them; two plain queries do the job everywhere.
  const rows = await db.prepare(`SELECT g.id, g.name, g.kind, g.join_code, g.created_at, gm.role
    FROM group_orders g JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
    WHERE g.is_active = 1 ORDER BY g.created_at DESC`).all(userId)
  const counts = await db.prepare(`SELECT group_id, COUNT(*) member_count,
    SUM(CASE WHEN member_paid = 1 THEN 1 ELSE 0 END) paid_count
    FROM group_members GROUP BY group_id`).all()
  const byId = Object.fromEntries(counts.map((c) => [Number(c.group_id), c]))
  const cfg = await getGroupConfig()
  return rows.map((g) => {
    const paidCount = Number(byId[Number(g.id)]?.paid_count || 0)
    return {
      ...g,
      member_count: Number(byId[Number(g.id)]?.member_count || 0),
      paidCount,
      freeUnlocked: paidCount >= cfg.freeAfterPaid ? Math.min(cfg.freeSlots, cfg.maxFree) : 0
    }
  })
}

export async function canCreateGroup(userId) {
  const cfg = await getGroupConfig()
  const paid = await isUserPaid(userId)
  const count = Number((await db.prepare('SELECT COUNT(*) c FROM group_orders WHERE owner_id = ? AND is_active = 1').get(userId))?.c || 0)
  const limit = paid ? cfg.groupsFreeForPaid : cfg.groupsFreeForFree
  return { allowed: count < limit, limit, count, paid }
}

export async function postGroupMessage({ groupId, userId, body }) {
  const text = String(body || '').trim().slice(0, 1000)
  if (!text) return { error: 'Message required' }
  const member = await isGroupMember(groupId, userId)
  if (!member) return { error: 'Not a member' }
  const r = await db.prepare(`INSERT INTO group_messages (group_id, user_id, body, created_at)
    VALUES (?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`).run(groupId, userId, text)
  return { id: r.lastInsertRowid }
}
