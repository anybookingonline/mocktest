import React, { useEffect, useState } from 'react'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'

const MEDALS = ['🥇', '🥈', '🥉']

export default function Rankings() {
  const { user } = useAuth()
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [data, setData] = useState(null)

  useEffect(() => { api.get('/exams').then((d) => { setExams(d.exams); if (d.exams.length) setExamId(String(d.exams[0].id)) }) }, [])
  useEffect(() => {
    if (!examId) { setData(null); return }
    api.get(`/analytics/rankings?examId=${examId}`).then(setData).catch(() => {})
  }, [examId])

  return (
    <StudentLayout title="Leaderboard & Rankings">
      <div className="spread mb">
        <p className="small muted">Rankings are computed from average scores across completed mock tests.</p>
        <select className="select" style={{ width: 220 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {data?.me && (
        <div className="card mb" style={{ borderColor: 'var(--accent)' }}>
          <div className="spread">
            <div className="row">
              <div className="avatar">{user?.name?.charAt(0)}</div>
              <div>
                <b>Your rank: #{data.me.rank}</b>
                <p className="tiny">{data.me.score} avg score · {data.me.accuracy}% accuracy</p>
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
            {data?.rankings?.map((r) => (
              <tr key={r.user_id} style={r.user_id === user?.id ? { background: 'rgba(99,102,241,0.12)' } : {}}>
                <td><b>{MEDALS[r.rank - 1] || `#${r.rank}`}</b></td>
                <td>{r.name}</td>
                <td><Badge kind="blue">{r.score}</Badge></td>
                <td>{r.accuracy}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data && data.rankings.length === 0 && <div className="empty">Complete a mock test to enter the rankings.</div>}
      </div>
    </StudentLayout>
  )
}
