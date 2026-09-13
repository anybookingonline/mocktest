import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Empty, useToast } from '../../components/ui.jsx'

// 1v1 Quiz Battles (#6) — quick-match or friend duels over HTTP polling.
// Free: 3 battles/day; paid (Retention / AI Power Pack): unlimited. ELO ladder.
export default function Battles() {
  const toast = useToast()
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [meta, setMeta] = useState(null) // { battles, quota }
  const [board, setBoard] = useState([])
  const [room, setRoom] = useState(null) // active battle state
  const [busy, setBusy] = useState(false)
  const [joinCode, setJoinCode] = useState('')
  const pollRef = useRef(null)

  useEffect(() => {
    api.get('/exams').then((d) => {
      setExams(d.exams || [])
      if (d.exams?.length) setExamId(String(d.exams[0].id))
    }).catch(() => {})
    load()
  }, [])

  const load = () => api.get('/battles').then(setMeta).catch(() => {})
  useEffect(() => {
    api.get('/battles/leaderboard').then((d) => setBoard(d.leaderboard || [])).catch(() => {})
  }, [meta])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  const startPolling = (roomId) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const s = await api.get(`/battles/${roomId}/state`)
        setRoom(s)
        if (s.room?.status === 'finished') {
          clearInterval(pollRef.current)
          pollRef.current = null
          load()
        }
      } catch { /* transient */ }
    }, 1500)
  }

  const quickMatch = async () => {
    if (!examId) return toast('Select an exam', 'err')
    setBusy(true)
    try {
      const d = await api.post('/battles/quick-match', { examId: Number(examId) })
      if (d.roomId) { startPolling(d.roomId); toast(d.matched ? 'Opponent mil gaya — battle shuru!' : 'Room bana — opponent ka intezaar…', 'ok') }
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const inviteFriend = async () => {
    if (!examId) return toast('Select an exam', 'err')
    setBusy(true)
    try {
      const d = await api.post('/battles/invite', { examId: Number(examId), rounds: 5 })
      if (d.roomId) { startPolling(d.roomId); toast(`Invite code: ${d.joinCode} — dost ko bhejo!`, 'ok') }
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const join = async () => {
    const code = joinCode.trim().toUpperCase()
    if (!code) return
    setBusy(true)
    try {
      const d = await api.post('/battles/join', { joinCode: code })
      if (d.roomId) { startPolling(d.roomId); toast('Battle shuru!', 'ok') }
      setJoinCode('')
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const answer = async (opt) => {
    if (!room?.question) return
    try {
      await api.post(`/battles/${room.room.id}/answer`, { roundNo: room.question.roundNo, selected: opt })
    } catch (e) { /* duplicate answers are fine */ }
  }

  const myId = room?.room?.p1?.id || room?.room?.p2?.id
  const iAmP1 = room?.room?.p1 && room.room.p1.id === myId
  const me = iAmP1 ? room.room.p1 : room.room.p2
  const opp = iAmP1 ? room.room.p2 : room.room.p1
  const myScore = me?.score || 0
  const oppScore = opp?.score || 0

  return (
    <StudentLayout title="⚔️ Quiz Battles">
      {/* Active battle view */}
      {room && room.room?.status !== 'finished' && (
        <div className="card mb" style={{ borderColor: 'var(--accent)' }}>
          <div className="spread mb">
            <div className="row" style={{ gap: 14 }}>
              <div style={{ textAlign: 'center' }}>
                <div className="avatar" style={{ margin: '0 auto 4px' }}>{(me?.name || 'Y').charAt(0)}</div>
                <b className="small">{me?.name}</b>
                <div className="tiny" style={{ color: 'var(--accent2)' }}>⚡ {me?.elo || 1200}</div>
              </div>
              <div style={{ fontSize: 22, fontWeight: 800 }}>{myScore} : {oppScore}</div>
              <div style={{ textAlign: 'center' }}>
                <div className="avatar" style={{ margin: '0 auto 4px', background: opp ? undefined : 'var(--bg3)' }}>{opp ? opp.name.charAt(0) : '?'}</div>
                <b className="small">{opp ? opp.name : 'Waiting…'}</b>
                <div className="tiny muted">⚡ {opp?.elo || '—'}</div>
              </div>
            </div>
            {room.room.status === 'waiting' && (
              <div className="row">
                <span className="chip">Invite code: <b>{room.room.joinCode}</b></span>
                <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(room.room.joinCode); toast('Code copied', 'ok') }}>Copy</button>
              </div>
            )}
            {room.room.status === 'active' && <Badge kind="purple">Round {room.room.currentRound}/{room.room.rounds}</Badge>}
          </div>

          {room.room.status === 'active' && room.question && (
            <div>
              <div className="row mb" style={{ justifyContent: 'space-between' }}>
                <Badge kind="gray">{room.question.difficulty}</Badge>
                <b className="timer" style={{ fontSize: 18, color: room.question.endsInMs < 5000 ? 'var(--red)' : undefined }}>
                  {Math.ceil(room.question.endsInMs / 1000)}s
                </b>
              </div>
              <div className="qcard">
                <div className="qtext mb">{room.question.text}</div>
                {room.question.options.map((o, i) => (
                  <div key={i} className="option" onClick={() => answer(o)}>
                    <span className="key">{String.fromCharCode(65 + i)}</span>{o}
                  </div>
                ))}
              </div>
              {room.question.correctAnswer != null && <p className="tiny mt" style={{ color: 'var(--green)' }}>Correct answer: {room.question.correctAnswer}</p>}
            </div>
          )}
          {room.room.status === 'waiting' && <p className="tiny muted">Opponent ke join karte hi pehla round auto-shuru ho jayega…</p>}
        </div>
      )}

      {/* Battle finished */}
      {room?.room?.status === 'finished' && (
        <div className="card mb" style={{ textAlign: 'center', padding: 34 }}>
          <div style={{ fontSize: 40 }}>
            {room.room.winnerId == null ? '🤝' : room.room.winnerId === (iAmP1 ? room.room.p1.id : room.room.p2?.id) ? '🏆' : '💫'}
          </div>
          <b style={{ fontSize: 18 }}>
            {room.room.winnerId == null ? 'Draw!' : room.room.winnerId === (iAmP1 ? room.room.p1.id : room.room.p2?.id) ? 'Jeet aapki!' : 'Better luck next time'}
          </b>
          <p className="muted small">{myScore} : {oppScore} · ELO ±{room.room.ratingDelta || 0}</p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={() => { setRoom(null); load() }}>Naya Battle</button>
            <Link to="/rankings" className="btn btn-ghost">Leaderboard dekho</Link>
          </div>
        </div>
      )}

      {/* Lobby */}
      {!room && (
        <>
          <div className="card mb">
            <div className="spread">
              <div>
                <b>1v1 duel — same questions, 20s per round, speed bonus +1 ⚡</b>
                <p className="tiny muted">
                  {meta?.quota?.unlimited
                    ? '✅ Unlimited battles (paid plan active)'
                    : `Free quota: ${meta?.quota?.used ?? 0}/${meta?.quota?.limit ?? 3} battles aaj. Paid plan = unlimited.`}
                </p>
              </div>
              <div className="row">
                <select className="select" style={{ width: 190 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
                  {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
                <button className="btn btn-primary" onClick={quickMatch} disabled={busy}>⚡ Quick Match</button>
                <button className="btn btn-accent" onClick={inviteFriend} disabled={busy}>📩 Invite Friend</button>
              </div>
            </div>
            <div className="row mt">
              <input className="input" style={{ maxWidth: 220 }} placeholder="Join code daalo (ABC123)" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} />
              <button className="btn btn-ghost" onClick={join} disabled={busy || !joinCode.trim()}>Join</button>
            </div>
          </div>

          <div className="grid grid-2">
            <div className="card">
              <b className="mb" style={{ display: 'block' }}>🏆 ELO Leaderboard</b>
              {board.length === 0 && <p className="tiny muted">Abhi koi battle nahi hui — pehla battle aap karo!</p>}
              {board.map((u, i) => (
                <div key={u.id} className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="row" style={{ gap: 8 }}>
                    <b style={{ width: 26, color: i === 0 ? 'var(--amber)' : i === 1 ? '#cbd5e1' : i === 2 ? '#d97706' : undefined }}>#{i + 1}</b>
                    <span className="small">{u.name}</span>
                  </span>
                  <span className="row" style={{ gap: 8 }}>
                    <span className="chip">{u.wins || 0}W</span>
                    <b style={{ color: 'var(--accent2)' }}>{u.elo || 1200}</b>
                  </span>
                </div>
              ))}
            </div>

            <div className="card">
              <b className="mb" style={{ display: 'block' }}>🗂️ Mere Battles</b>
              {!meta?.battles?.length && <p className="tiny muted">Koi history nahi — Quick Match dabao.</p>}
              {(meta?.battles || []).slice(0, 8).map((b) => (
                <div key={b.id} className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
                  <span className="small">
                    vs <b>{b.opponent_name || '…'}</b> <span className="tiny muted">({b.exam_name})</span>
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    <Badge kind={b.status === 'finished' ? (b.winner_id ? 'green' : 'gray') : 'purple'}>
                      {b.status === 'finished' ? `${b.p1_score}:${b.p2_score}` : b.status}
                    </Badge>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </StudentLayout>
  )
}
