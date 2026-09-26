import db from '../db.js'
import crypto from 'crypto'
import { getConfig } from './aiService.js'
import { awardPoints } from './points.js'
import { visibilityInstId } from './visibility.js'

// ---------------------------------------------------------------------------
// 1v1 Quiz Battles (#6) — duels with friends on any exam, scored by the
// classic "+1 if correct, first correct answer of the round +1 bonus" rule,
// with ELO rating deltas applied to a persistent leaderboard (users.elo).
// Realtime feel over HTTP polling: rounds carry round_ends_at timestamps and
// both clients poll the room state; no websocket server needed (₹0 infra).
// ---------------------------------------------------------------------------

export const ROUND_SECONDS = 20
const K_FACTOR = 32

function code() {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const buf = crypto.randomBytes(6)
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[buf[i] % alphabet.length]
  return out
}

function untilIso(secs) {
  return new Date(Date.now() + secs * 1000).toISOString().replace('T', ' ').slice(0, 19)
}

export async function battlesUsedToday(userId) {
  // Portable day boundary (created_at is TEXT 'YYYY-MM-DD HH24:MI:SS'):
  // count battles whose timestamp starts with today's UTC date.
  const today = new Date().toISOString().slice(0, 10)
  const row = await db.prepare(`SELECT COUNT(*) c FROM battle_rooms
    WHERE (player1_id = ? OR player2_id = ?) AND created_at LIKE ?`).get(Number(userId), Number(userId), `${today}%`)
  return Number(row?.c) || 0
}

// Battles cost the platform ~nothing (no AI calls) and are a competitive/
// viral hook — kept fully free and unlimited for everyone, on purpose, rather
// than gated behind a paid plan.
export async function assertCanBattle(_userId) {
  return { allowed: true, unlimited: true }
}

// AI question fetch — only called when the bank runs dry for the exam/topic.
async function aiQuestionFor(examId) {
  try {
    const { generateQuestionsWithAI, persistQuestions } = await import('./aiTasks.js')
    const exam = await db.prepare('SELECT * FROM exams WHERE id = ?').get(Number(examId))
    if (!exam) return null
    const list = await generateQuestionsWithAI({ exam, count: 1, seed: `battle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` })
    if (!list?.length) return null
    await persistQuestions(list, { exam, source: 'ai', sourceMeta: { battle: true } })
    return list[0] // { question, options, correctAnswer, ... }
  } catch {
    return null
  }
}

// Draw a question: reuse existing bank questions (no AI cost); fall back to AI.
// Institute isolation: instId > 0 -> global + own-institute only; 0 -> global only.
async function drawQuestion(examId, usedIds, instId = 0) {
  const vis = instId > 0 ? '(institute_id IS NULL OR institute_id = ?)' : 'institute_id IS NULL'
  const base = `SELECT id, qtype, question_text, options_json, correct_answer, difficulty, topic_id
    FROM questions WHERE is_active = 1 AND exam_id = ? AND ${vis}`
  let rows
  if (usedIds.length) {
    const marks = '?,'.repeat(usedIds.length).slice(0, -1)
    rows = await db.prepare(`${base} AND id NOT IN (${marks}) ORDER BY RANDOM() LIMIT 1`).all(Number(examId), ...(instId > 0 ? [instId] : []), ...usedIds)
  } else {
    // NOTE: never emit `NOT IN (NULL)` — in real Postgres that evaluates to
    // NULL and matches zero rows.
    rows = await db.prepare(`${base} ORDER BY RANDOM() LIMIT 1`).all(Number(examId), ...(instId > 0 ? [instId] : []))
  }
  if (rows.length) return rows[0]
  const any = await db.prepare(`${base} ORDER BY RANDOM() LIMIT 1`).all(Number(examId), ...(instId > 0 ? [instId] : []))
  if (any.length) return any[0]
  const ai = await aiQuestionFor(examId)
  return ai
}

export async function createRoom({ userId, examId, rounds = 5, topicId = null, inviteOnly = false }) {
  const gate = await assertCanBattle(userId)
  if (!gate.allowed) {
    return { error: `Free limit: ${gate.limit} battles/day. AI Power Pack ya Retention plan unlimited battles deta hai.`, upgrade: true }
  }
  const exam = await db.prepare('SELECT id FROM exams WHERE id = ?').get(Number(examId))
  if (!exam) return { error: 'examId required' }
  // join_code: open rooms are discoverable via matchmaking; invite rooms via code
  const jc = code()
  const r = await db.prepare(`INSERT INTO battle_rooms (exam_id, player1_id, status, rounds, topic_id, join_code, created_at)
    VALUES (?, ?, 'waiting', ?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`)
    .run(Number(examId), Number(userId), Math.min(10, Math.max(3, Number(rounds) || 5)), topicId || null, jc)
  return { roomId: Number(r.lastInsertRowid), joinCode: jc, inviteOnly: Boolean(inviteOnly) }
}

export async function joinRoom({ userId, roomId, joinCode }) {
  let room
  if (roomId) room = await db.prepare(`SELECT * FROM battle_rooms WHERE id = ? AND status = 'waiting'`).get(Number(roomId))
  else if (joinCode) room = await db.prepare(`SELECT * FROM battle_rooms WHERE join_code = ? AND status = 'waiting'`).get(String(joinCode).toUpperCase())
  if (!room) return { error: 'Open battle not found (already started or finished)' }
  if (Number(room.player1_id) === Number(userId)) return { error: 'Ye aapka hi room hai — doosra player join hone ka intezaar karo' }
  const gate = await assertCanBattle(userId)
  if (!gate.allowed) return { error: `Free limit: ${gate.limit} battles/day. Plan lo for unlimited.`, upgrade: true }
  const r = await db.prepare(`UPDATE battle_rooms SET player2_id = ?, status = 'active' WHERE id = ? AND status = 'waiting'`)
    .run(Number(userId), room.id)
  if (!r.changes) return { error: 'Someone just joined — try another' }
  await beginRound(room.id, 1)
  return { roomId: room.id, started: true }
}

// Matchmaking: 1v1 kiske saath? Closest-ELO opponent first (fair fights), then
// fewest past meetings, then oldest room. Filtering/ordering in JS keeps the
// query portable across Postgres flavors.
export async function quickMatch({ userId, examId }) {
  const me = await db.prepare('SELECT elo FROM users WHERE id = ?').get(Number(userId))
  const myElo = Number(me?.elo) || 1200
  const rows = await db.prepare(`
    SELECT b.id, b.player1_id, COALESCE(u.elo, 1200) AS opp_elo
    FROM battle_rooms b
    JOIN users u ON u.id = b.player1_id
    WHERE b.status = 'waiting' AND b.exam_id = ? AND b.player1_id <> ? AND b.join_code IS NOT NULL
    ORDER BY b.created_at ASC LIMIT 20`).all(Number(examId), Number(userId))
  if (rows.length) {
    const enriched = []
    for (const r of rows) {
      const past = await db.prepare(`SELECT COUNT(*) c FROM battle_rooms past
        WHERE past.status = 'finished'
          AND ((past.player1_id = ? AND past.player2_id = ?)
            OR (past.player2_id = ? AND past.player1_id = ?))`)
        .get(Number(userId), Number(r.player1_id), Number(userId), Number(r.player1_id))
      enriched.push({ id: r.id, eloGap: Math.abs((Number(r.opp_elo) || 1200) - myElo), meetings: Number(past?.c) || 0 })
    }
    enriched.sort((a, b) => (Math.min(a.eloGap, 250) === 0 ? 0 : a.eloGap <= 250 ? 0 : 1) - (Math.min(b.eloGap, 250) === 0 ? 0 : b.eloGap <= 250 ? 0 : 1) || a.meetings - b.meetings || a.eloGap - b.eloGap)
    const j = await joinRoom({ userId, roomId: enriched[0].id })
    if (!j.error) return { ...j, matched: true }
  }
  return createRoom({ userId, examId })
}

async function beginRound(roomId, roundNo) {
  const room = await db.prepare('SELECT * FROM battle_rooms WHERE id = ?').get(roomId)
  if (!room) return null
  if (roundNo > room.rounds) return finishRoom(room)
  const used = await db.prepare('SELECT question_id FROM battle_rounds WHERE room_id = ?').all(roomId)
  // Room ke players me se kisi ek ka institute hi visibility scope hai (dono
  // same institute ke hain ya global questions khelte hain — matchmaking par
  // alag institute ke rooms bante hi nahi, kyunki dono global pool se draw karte hain).
  const instId = await visibilityInstId(room.player1_id)
  const q = await drawQuestion(room.exam_id, used.map((r) => r.question_id), instId)
  if (!q) {
    await db.prepare(`UPDATE battle_rooms SET status = 'finished', finished_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`).run(roomId)
    return null
  }
  // Normalize AI-generated shapes into the same layout as bank rows
  const question = {
    id: q.id ?? null,
    qtype: q.qtype || 'single',
    question_text: q.question_text ?? q.question ?? '',
    options_json: q.options_json ?? JSON.stringify(q.options || []),
    correct_answer: String(q.correct_answer ?? q.correctAnswer ?? ''),
    difficulty: q.difficulty || 'medium',
    topic_id: q.topic_id ?? null
  }
  let qid = question.id
  if (!qid) qid = Number((await db.prepare(`SELECT id FROM questions WHERE content_hash IS NOT NULL ORDER BY id DESC LIMIT 1`).get())?.id || 0) || null
  await db.prepare(`INSERT INTO battle_rounds (room_id, round_no, question_id, round_ends_at)
    VALUES (?, ?, ?, ?) ON CONFLICT (room_id, round_no) DO NOTHING`)
    .run(roomId, roundNo, qid, untilIso(ROUND_SECONDS))
  await db.prepare(`UPDATE battle_rooms SET current_round = ? WHERE id = ?`).run(roundNo, roomId)
  return true
}

function normalizeAns(s) {
  return String(s ?? '').trim().toLowerCase()
}

export async function submitAnswer({ roomId, userId, roundNo, selected }) {
  const room = await db.prepare('SELECT * FROM battle_rooms WHERE id = ?').get(Number(roomId))
  if (!room || room.status !== 'active') return { error: 'Battle is not active' }
  const round = await db.prepare('SELECT * FROM battle_rounds WHERE room_id = ? AND round_no = ?').get(Number(roomId), Number(roundNo))
  if (!round) return { error: 'Round not found' }
  const me = Number(room.player1_id) === Number(userId) ? 1 : Number(room.player2_id) === Number(userId) ? 2 : null
  if (!me) return { error: 'Not a player in this battle' }

  const existing = await db.prepare('SELECT * FROM battle_answers WHERE room_id = ? AND round_no = ? AND user_id = ?')
    .get(Number(roomId), Number(roundNo), Number(userId))
  if (existing) return { error: 'Already answered' }

  const q = await db.prepare('SELECT correct_answer FROM questions WHERE id = ?').get(round.question_id)
  if (!q) return { error: 'Question missing' }
  const correct = normalizeAns(selected) === normalizeAns(q.correct_answer) && selected != null
  const elapsedMs = Math.max(0, Date.now() - new Date(String(round.round_started_at).replace(' ', 'T') + 'Z').getTime())
  const expired = Date.now() > new Date(String(round.round_ends_at).replace(' ', 'T') + 'Z').getTime()

  let points = 0
  if (correct && !expired) {
    points = 1
    // +1 speed bonus when I'm the FIRST correct answer of the round
    const firsts = await db.prepare(`SELECT user_id FROM battle_answers
      WHERE room_id = ? AND round_no = ? AND is_correct = 1 ORDER BY answer_ms ASC LIMIT 1`)
      .all(Number(roomId), Number(roundNo))
    if (!firsts.length) points = 2
  }

  await db.prepare(`INSERT INTO battle_answers (room_id, round_no, user_id, selected, is_correct, answer_ms, points, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, to_char(now(), 'YYYY-MM-DD HH24:MI:SS'))`)
    .run(Number(roomId), Number(roundNo), Number(userId), selected == null ? null : String(selected), correct ? 1 : 0, elapsedMs, points)

  const col = me === 1 ? 'p1_score' : 'p2_score'
  await db.prepare(`UPDATE battle_rooms SET ${col} = ${col} + ? WHERE id = ?`).run(points, Number(roomId))

  // Both answered (or round expired) -> next round
  const answered = await db.prepare('SELECT user_id FROM battle_answers WHERE room_id = ? AND round_no = ?')
    .all(Number(roomId), Number(roundNo))
  const bothIn = Number(room.player1_id) && Number(room.player2_id)
  const allAnswered = bothIn && answered.length >= 2
  const nowExpired = Date.now() > new Date(String(round.round_ends_at).replace(' ', 'T') + 'Z').getTime()
  if (allAnswered || nowExpired) {
    const next = Number(roundNo) + 1
    await beginRound(Number(roomId), next)
  }
  return { correct, points, expired }
}

// Room state for clients (polling). Reveals the correct answer only after the
// round window has passed or both players answered — anti-cheat.
export async function roomState({ roomId, userId }) {
  const room = await db.prepare(`SELECT b.*, u1.name p1_name, u2.name p2_name, u1.elo p1_elo, u2.elo p2_elo
    FROM battle_rooms b
    JOIN users u1 ON u1.id = b.player1_id
    LEFT JOIN users u2 ON u2.id = b.player2_id
    WHERE b.id = ?`).get(Number(roomId))
  if (!room) return null
  const isPlayer = Number(room.player1_id) === Number(userId) || Number(room.player2_id) === Number(userId)
  // Hard scope: ONLY the two players may poll a room's state. Previously
  // non-players were only blocked for 'waiting' rooms, which let any logged-in
  // user read active rooms (question text, options, post-round correct
  // answers, players' names/ELO) by enumerating room ids.
  if (!isPlayer) return { forbidden: true }

  const rounds = await db.prepare(`SELECT br.*, q.question_text, q.options_json, q.correct_answer, q.difficulty
    FROM battle_rounds br JOIN questions q ON q.id = br.question_id
    WHERE br.room_id = ? ORDER BY br.round_no ASC`).all(Number(roomId))
  const answers = await db.prepare(`SELECT ba.*, u.name FROM battle_answers ba JOIN users u ON u.id = ba.user_id
    WHERE ba.room_id = ? ORDER BY ba.round_no, ba.answer_ms`).all(Number(roomId))

  const current = rounds.find((r) => r.round_no === room.current_round)
  let showAnswer = false
  if (current) {
    const bothIn = Number(room.player1_id) && Number(room.player2_id)
    const cnt = answers.filter((a) => a.round_no === room.current_round).length
    showAnswer = Date.now() > new Date(String(current.round_ends_at).replace(' ', 'T') + 'Z').getTime() || (bothIn && cnt >= 2)
  }

  return {
    room: {
      id: room.id, status: room.status, rounds: room.rounds, currentRound: room.current_round,
      examId: room.exam_id, joinCode: room.join_code,
      p1: { id: room.player1_id, name: room.p1_name, elo: room.p1_elo, score: room.p1_score },
      p2: room.player2_id ? { id: room.player2_id, name: room.p2_name, elo: room.p2_elo, score: room.p2_score } : null,
      winnerId: room.winner_id
    },
    question: current && {
      roundNo: current.round_no, text: current.question_text,
      options: JSON.parse(current.options_json || '[]'),
      difficulty: current.difficulty,
      endsInMs: Math.max(0, new Date(String(current.round_ends_at).replace(' ', 'T') + 'Z').getTime() - Date.now()),
      ...(showAnswer ? { correctAnswer: current.correct_answer } : {})
    },
    myAnswers: answers.filter((a) => a.user_id === Number(userId)).map((a) => ({ roundNo: a.round_no, points: a.points, correct: Boolean(a.is_correct) })),
    lastRoundAnswers: answers.filter((a) => a.round_no === room.current_round).map((a) => ({ userId: a.user_id, name: a.name, correct: Boolean(a.is_correct), points: a.points }))
  }
}

function expectedScore(ra, rb) {
  return 1 / (1 + Math.pow(10, (rb - ra) / 400))
}

async function finishRoom(room) {
  await db.prepare(`UPDATE battle_rooms SET status = 'finished', finished_at = to_char(now(), 'YYYY-MM-DD HH24:MI:SS') WHERE id = ?`).run(room.id)
  if (!room.player2_id || room.winner_id) return { finished: true }
  const p1 = await db.prepare('SELECT id, elo FROM users WHERE id = ?').get(room.player1_id)
  const p2 = await db.prepare('SELECT id, elo FROM users WHERE id = ?').get(room.player2_id)
  if (!p1 || !p2) return { finished: true }
  const r1 = Number(p1.elo) || 1200
  const r2 = Number(p2.elo) || 1200
  const s1 = room.p1_score > room.p2_score ? 1 : room.p1_score < room.p2_score ? 0 : 0.5
  const winner = s1 === 1 ? p1.id : s1 === 0 ? p2.id : null
  const d1 = Math.round(K_FACTOR * (s1 - expectedScore(r1, r2)))
  const d2 = -d1
  await db.prepare('UPDATE users SET elo = ? WHERE id = ?').run(r1 + d1, p1.id)
  await db.prepare('UPDATE users SET elo = ? WHERE id = ?').run(r2 + d2, p2.id)
  await db.prepare('UPDATE battle_rooms SET winner_id = ?, rating_delta = ? WHERE id = ?').run(winner, Math.abs(d1), room.id)
  // Recognition: battle participation points (win > draw > loss)
  await awardPoints(p1.id, s1 === 1 ? 'battle_win' : s1 === 0 ? 'battle_loss' : 'battle_draw', { dedupe: `battle:${room.id}:p1` })
  await awardPoints(p2.id, s1 === 1 ? 'battle_loss' : s1 === 0 ? 'battle_win' : 'battle_draw', { dedupe: `battle:${room.id}:p2` })
  return { finished: true, winnerId: winner, delta: Math.abs(d1) }
}

// Polling also finishes expired/complete battles (cron-free lifecycle).
export async function tickRoom(roomId) {
  const room = await db.prepare('SELECT * FROM battle_rooms WHERE id = ?').get(Number(roomId))
  if (!room || room.status !== 'active') return
  const current = await db.prepare('SELECT * FROM battle_rounds WHERE room_id = ? AND round_no = ?').get(roomId, room.current_round)
  if (!current) return
  const expired = Date.now() > new Date(String(current.round_ends_at).replace(' ', 'T') + 'Z').getTime()
  if (!expired) return
  const next = Number(room.current_round) + 1
  if (next > room.rounds) await finishRoom(room)
  else await beginRound(roomId, next)
}

export async function myBattles(userId) {
  const rooms = await db.prepare(`SELECT b.id, b.status, b.p1_score, b.p2_score, b.winner_id, b.rounds, b.created_at, b.finished_at,
    e.name exam_name, u1.name p1_name, u2.name p2_name,
    CASE WHEN b.player1_id = ? THEN b.player2_id ELSE b.player1_id END opponent_id,
    CASE WHEN b.player1_id = ? THEN u2.name ELSE u1.name END opponent_name
    FROM battle_rooms b
    JOIN exams e ON e.id = b.exam_id
    JOIN users u1 ON u1.id = b.player1_id
    LEFT JOIN users u2 ON u2.id = b.player2_id
    WHERE b.player1_id = ? OR b.player2_id = ?
    ORDER BY b.id DESC LIMIT 25`).all(Number(userId), Number(userId), Number(userId), Number(userId))
  return rooms
}

export async function leaderboard(examId) {
  if (examId) {
    return db.prepare(`SELECT u.id, u.name, u.elo,
      SUM(CASE WHEN (b.player1_id = u.id AND b.winner_id = u.id) OR (b.player2_id = u.id AND b.winner_id = u.id) THEN 1 ELSE 0 END) wins,
      COUNT(b.id) battles
      FROM users u
      LEFT JOIN battle_rooms b ON (b.player1_id = u.id OR b.player2_id = u.id) AND b.status = 'finished' AND b.exam_id = ?
      WHERE u.role = 'student' AND u.elo > 0
      GROUP BY u.id ORDER BY u.elo DESC LIMIT 20`).all(Number(examId))
  }
  return db.prepare(`SELECT u.id, u.name, u.elo,
    SUM(CASE WHEN (b.player1_id = u.id AND b.winner_id = u.id) OR (b.player2_id = u.id AND b.winner_id = u.id) THEN 1 ELSE 0 END) wins,
    COUNT(b.id) battles
    FROM users u
    LEFT JOIN battle_rooms b ON (b.player1_id = u.id OR b.player2_id = u.id) AND b.status = 'finished'
    WHERE u.role = 'student' AND u.elo > 0
    GROUP BY u.id ORDER BY u.elo DESC LIMIT 20`).all()
}

export async function battlesEnabled() {
  return (await getConfig('features.battles', 'false')) === 'true'
}
