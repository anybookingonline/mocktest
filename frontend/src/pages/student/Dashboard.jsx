import React, { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Progress, Skeleton, fmtDuration, statColor, timeAgo } from '../../components/ui.jsx'
import { useAuth } from '../../context/AuthContext.jsx'

export default function Dashboard() {
  const { user } = useAuth()
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [exams, setExams] = useState([])
  const [tests, setTests] = useState([])
  const [recs, setRecs] = useState([])

  useEffect(() => {
    api.get('/analytics/overview').then(setData).catch(() => {})
    api.get('/exams').then((d) => setExams(d.exams)).catch(() => {})
    api.get('/tests').then((d) => setTests(d.tests)).catch(() => {})
    api.get('/analytics/recommendations').then((d) => setRecs(d.recommendations)).catch(() => {})
  }, [])

  const acc = data ? Math.round((data.totalCorrect / Math.max(1, data.totalQuestions)) * 100) : 0

  return (
    <StudentLayout title="Dashboard">
      <div className="card mb" style={{ background: 'linear-gradient(120deg, rgba(99,102,241,0.22), rgba(34,211,238,0.12))', border: '1px solid rgba(99,102,241,0.35)' }}>
        <div className="spread">
          <div>
            <h2>Namaste, {user?.name?.split(' ')[0]} 👋</h2>
            <p className="muted small">Keep your pace steady. Your streak builds with every solved question.</p>
          </div>
          <button className="btn btn-primary" onClick={() => nav(tests.length ? `/tests` : '/tests')}>Take a Mock Test →</button>
        </div>
      </div>

      <div className="grid grid-4 mb">
        <div className="card stat"><span className="label">Tests completed</span><span className="value">{data ? data.totalTests : <Skeleton h={30} />}</span><span className="sub">across all exams</span></div>
        <div className="card stat"><span className="label">Questions solved</span><span className="value">{data ? data.totalQuestions : <Skeleton h={30} />}</span><span className="sub">{data?.totalCorrect} correct</span></div>
        <div className="card stat"><span className="label">Overall accuracy</span><span className="value">{data ? `${acc}%` : <Skeleton h={30} />}</span><span className="sub">{data ? `${data.avgScore} avg score` : ''}</span></div>
        <div className="card stat"><span className="label">Total time</span><span className="value">{data ? fmtDuration(data.totalTime) : <Skeleton h={30} />}</span><span className="sub">in exams</span></div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div className="col">
          <div className="card">
            <div className="spread mb"><b>Choose your exam</b><Link className="small" to="/tests">See mock tests →</Link></div>
            <div className="grid grid-4">
              {exams.map((e) => (
                <div key={e.id} className="card hover" style={{ padding: 14, textAlign: 'center', cursor: 'pointer' }} onClick={() => nav(`/practice?exam=${e.id}`)}>
                  <div style={{ fontSize: 26 }}>{e.icon || '🎯'}</div>
                  <b className="small" style={{ display: 'block' }}>{e.name}</b>
                  <div className="tiny">{e.total_questions} Q · {e.duration_minutes} min</div>
                </div>
              ))}
            </div>
          </div>

          {data?.recent?.length > 0 && (
            <div className="card">
              <div className="spread mb"><b>Recent tests</b><Link className="small" to="/history">History →</Link></div>
              {data.recent.slice(0, 5).map((a) => (
                <Link key={a.id} to={`/results/${a.id}`} style={{ display: 'block' }}>
                  <div className="row spread" style={{ padding: '9px 4px', borderBottom: '1px solid var(--border)' }}>
                    <div>
                      <b className="small">{a.title}</b>
                      <div className="tiny">{timeAgo(a.started_at)} · {a.accuracy}% acc</div>
                    </div>
                    <div className="row">
                      <Badge kind={a.score >= 0 ? 'green' : 'gray'}>{a.score} pts</Badge>
                      <Badge kind={statColor(a.accuracy)}>{a.correct}C / {a.wrong}W</Badge>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="col">
          <div className="card">
            <div className="spread mb"><b>AI Recommendations</b><span className="badge purple">Personalized</span></div>
            {recs.length === 0 && <Skeleton h={80} />}
            {recs.map((r, i) => (
              <div key={i} className="ai-bubble" style={{ marginBottom: 10, fontSize: 13 }}>
                <b>{r.title}</b>
                <p className="small muted" style={{ marginTop: 4 }}>{r.text}</p>
              </div>
            ))}
          </div>

          {data?.weakTopics?.length > 0 && (
            <div className="card">
              <div className="spread mb"><b>Weak topics</b><Link className="small" to="/analytics">Analyze →</Link></div>
              {data.weakTopics.slice(0, 5).map((t, i) => {
                const p = Math.round((t.correct / Math.max(1, t.attempts)) * 100)
                return (
                  <div key={i} style={{ marginBottom: 12 }}>
                    <div className="spread tiny mb"><span>{t.topic_name || 'Topic'}</span><span>{p}%</span></div>
                    <Progress value={p} kind={statColor(p)} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </StudentLayout>
  )
}
