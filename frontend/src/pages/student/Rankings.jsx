import React, { useEffect, useState } from 'react'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'

const MEDALS = ['🥇', '🥈', '🥉']

// Leaderboard with three views:
//  AIR — All-India style rank across the platform (percentile-framed)
//  Exam — per-exam rankings (avg score based, existing)
//  Points — recognition wall (FB-style points + levels)
export default function Rankings() {
  const { user } = useAuth()
  const [tab, setTab] = useState('air')
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [air, setAir] = useState(null)
  const [examData, setExamData] = useState(null)
  const [pts, setPts] = useState(null)
  const [wall, setWall] = useState(null)

  useEffect(() => { api.get('/exams').then((d) => { setExams(d.exams); if (d.exams.length) setExamId(String(d.exams[0].id)) }) }, [])
  useEffect(() => { api.get('/analytics/points').then(setPts).catch(() => {}) }, [])
  useEffect(() => {
    if (tab === 'air' && examId) api.get(`/analytics/air?examId=${examId}`).then(setAir).catch(() => {})
    if (tab === 'exam' && examId) api.get(`/analytics/rankings?examId=${examId}`).then(setExamData).catch(() => {})
    if (tab === 'points') api.get('/analytics/points/leaderboard').then(setWall).catch(() => {})
  }, [tab, examId])

  const lvl = pts?.level

  return (
    <StudentLayout title="Leaderboard">
      {/* Tabs */}
      <div className="row mb" role="tablist">
        {[['air', '🇮🇳 All India Rank'], ['exam', '📊 Exam Rank'], ['points', '⭐ Points Wall']].map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id}
            className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      <select className="select mb" style={{ maxWidth: 260 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
        {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
      </select>

      {/* ---------------- AIR tab ---------------- */}
      {tab === 'air' && (
        <>
          {air?.me ? (
            <div className="card mb" style={{ borderColor: 'var(--accent)' }}>
              <div className="spread">
                <div className="row">
                  <div className="avatar">{user?.name?.charAt(0)}</div>
                  <div>
                    <b style={{ fontSize: 18 }}>AIR #{air.me.rank}</b>
                    <span className="tiny muted"> of {air.me.total}</span>
                    <p className="tiny muted">Best score {air.me.bestScore} · {air.me.avgAccuracy}% avg accuracy · {air.me.tests} tests</p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <span className="badge purple" style={{ fontSize: 14 }}>Top {100 - air.me.percentile + 1}%</span>
                  <p className="tiny muted mt" style={{ marginTop: 4 }}>You're ahead of {air.me.percentile}% students</p>
                </div>
              </div>
            </div>
          ) : (
            <div className="card mb muted small">Complete a test in this exam to get your All-India Rank.</div>
          )}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Rank</th><th>Student</th><th>Best score</th><th>Accuracy</th><th>Percentile</th></tr></thead>
              <tbody>
                {air?.board?.map((r) => (
                  <tr key={r.user_id} style={r.user_id === user?.id ? { background: 'rgba(99,102,241,0.12)' } : {}}>
                    <td><b>{MEDALS[r.rank - 1] || `#${r.rank}`}</b></td>
                    <td>{r.name}{r.user_id === user?.id && <span className="chip" style={{ marginLeft: 8 }}>You</span>}</td>
                    <td><Badge kind="blue">{r.best_score}</Badge></td>
                    <td>{r.avg_accuracy}%</td>
                    <td className="tiny muted">{r.percentile}%ile</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {air && air.board.length === 0 && <div className="empty">No completed tests yet in this exam.</div>}
          </div>
          <p className="tiny muted mt">Rank from completed tests on the platform. Percentile = students you're ahead of.</p>
        </>
      )}

      {/* ---------------- Exam tab (original avg-score ranking) ---------------- */}
      {tab === 'exam' && (
        <>
          {examData?.me && (
            <div className="card mb" style={{ borderColor: 'var(--accent)' }}>
              <div className="spread">
                <div className="row">
                  <div className="avatar">{user?.name?.charAt(0)}</div>
                  <div>
                    <b>Your rank: #{examData.me.rank}</b>
                    <p className="tiny">{examData.me.score} avg score · {examData.me.accuracy}% accuracy</p>
                  </div>
                </div>
                <span className="badge purple">You're on the board!</span>
              </div>
            </div>
          )}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>Rank</th><th>Student</th><th>Avg score</th><th>Accuracy</th></tr></thead>
              <tbody>
                {examData?.rankings?.map((r) => (
                  <tr key={r.user_id} style={r.user_id === user?.id ? { background: 'rgba(99,102,241,0.12)' } : {}}>
                    <td><b>{MEDALS[r.rank - 1] || `#${r.rank}`}</b></td>
                    <td>{r.name}</td>
                    <td><Badge kind="blue">{r.score}</Badge></td>
                    <td>{r.accuracy}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {examData && examData.rankings.length === 0 && <div className="empty">Complete a mock test to enter the rankings.</div>}
          </div>
        </>
      )}

      {/* ---------------- Points tab ---------------- */}
      {tab === 'points' && (
        <>
          {lvl && (
            <div className="card mb" style={{ borderColor: 'var(--accent)' }}>
              <div className="spread" style={{ alignItems: 'flex-start' }}>
                <div className="row">
                  <div style={{ fontSize: 34 }}>{lvl.icon}</div>
                  <div>
                    <b style={{ fontSize: 18 }}>{lvl.name} · Level {lvl.level}</b>
                    <p className="tiny muted">{pts.total} points · {pts.weekly} this week · Global rank #{pts.globalRank}{pts.totalRanked ? ` of ${pts.totalRanked}` : ''}</p>
                    <div className="progress" style={{ width: 220, marginTop: 6 }}>
                      <div style={{ width: `${lvl.progress}%` }} />
                    </div>
                    {lvl.next && <p className="tiny muted" style={{ marginTop: 4 }}>{lvl.next.need} points to {lvl.next.icon} {lvl.next.name}</p>}
                  </div>
                </div>
                {pts.recent?.length > 0 && (
                  <div style={{ maxWidth: 260 }}>
                    <b className="tiny">Recent recognition</b>
                    <div className="col" style={{ gap: 4, marginTop: 6 }}>
                      {pts.recent.slice(0, 4).map((p, i) => (
                        <span key={i} className="tiny">
                          <Badge kind="green">+{p.points}</Badge> {ACTION_LABELS[p.action] || p.action}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="tbl">
              <thead><tr><th>#</th><th>Student</th><th>Points</th><th>Battle ELO</th></tr></thead>
              <tbody>
                {wall?.top?.map((r, i) => (
                  <tr key={r.id} style={r.id === user?.id ? { background: 'rgba(99,102,241,0.12)' } : {}}>
                    <td><b>{MEDALS[i] || `#${i + 1}`}</b></td>
                    <td>{r.name}{r.id === user?.id && <span className="chip" style={{ marginLeft: 8 }}>You</span>}</td>
                    <td><Badge kind="green">⭐ {r.points}</Badge></td>
                    <td className="tiny muted">{r.elo ? r.elo : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {wall && wall.top.length === 0 && <div className="empty">Earn points by completing tests, winning battles and helping in groups!</div>}
          </div>
          <div className="card mt">
            <b className="small">Kaise points kamayein?</b>
            <div className="grid grid-3 mt" style={{ gap: 8 }}>
              {Object.entries(ACTION_LABELS).map(([k, label]) => (
                <span key={k} className="chip tiny">{label}</span>
              ))}
            </div>
          </div>
        </>
      )}
    </StudentLayout>
  )
}

const ACTION_LABELS = {
  register: 'Welcome bonus',
  test_completed: 'Test complete +10',
  perfect_test: 'Perfect score +25',
  doubt_asked: 'Doubt pucha +5',
  doubt_resolved: 'Doubt solved +3',
  voice_doubt: 'Voice doubt +5',
  battle_win: 'Battle jeeta +15',
  battle_draw: 'Battle draw +8',
  battle_loss: 'Battle khela +4',
  group_created: 'Group banaya +10',
  group_joined: 'Group join kiya +5',
  group_message: 'Discussion me help +2',
  revision_mock: 'Revision mock +10',
  revision_streak: 'Revision streak +3',
  focus_viewed: 'Focus areas +3',
  invite_accepted: 'Dost ko bulaya +10',
  profile_completed: 'Profile complete +5'
}
