import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Progress, Skeleton, fmtDuration, statColor } from '../../components/ui.jsx'

export default function Analytics() {
  const nav = useNavigate()
  const [data, setData] = useState(null)
  const [report, setReport] = useState(null)
  const [recs, setRecs] = useState([])
  const [tab, setTab] = useState('weak')

  useEffect(() => {
    api.get('/analytics/overview').then(setData).catch(() => {})
    api.get('/analytics/report').then(setReport).catch(() => {})
    api.get('/analytics/recommendations').then((d) => setRecs(d.recommendations)).catch(() => {})
  }, [])

  return (
    <StudentLayout title="Performance Analytics">
      <div className="row mb">
        {[['weak', 'Weak Topic Analysis'], ['subjects', 'Subject-wise'], ['trend', 'Score Trend'], ['recommendations', 'Recommendations'], ['speed', 'Speed Analysis']].map(([k, label]) => (
          <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'weak' && (
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Weak topics — lowest accuracy first</b>
          {!data && <Skeleton h={200} />}
          {data?.weakTopics?.map((t, i) => {
            const p = Math.round((t.correct / Math.max(1, t.attempts)) * 100)
            return (
              <div key={i} className="mb">
                <div className="spread small mb">
                  <b>{t.topic_name || 'Topic'} <span className="tiny muted">{t.chapter_name} · {t.subject_name}</span></b>
                  <span className="tiny">{t.correct}/{t.attempts} correct · {fmtDuration(t.total_time_sec)}</span>
                </div>
                <Progress value={p} kind={statColor(p)} />
                <button className="btn btn-ghost btn-sm mt" onClick={() => nav(`/practice?exam=${data?.weakTopics?.[0]?.exam_id || ''}`)} style={{ marginTop: 6 }}>Practice this →</button>
              </div>
            )
          })}
          {data && data.weakTopics.length === 0 && <div className="empty">Answer more questions (min 2 per topic) to unlock weak-topic analysis.</div>}
        </div>
      )}

      {tab === 'subjects' && (
        <div className="grid grid-3">
          {data?.subjects?.map((s) => {
            const p = s.total ? Math.round((s.correct / s.total) * 100) : 0
            return (
              <div key={s.id} className="card">
                <div className="spread mb"><b>{s.name}</b><span className="tiny">{s.total} attempts</span></div>
                <Progress value={p} kind={statColor(p)} />
                <p className="small mt" style={{ color: p >= 75 ? 'var(--green)' : p >= 50 ? 'var(--amber)' : 'var(--red)' }}>{p}% accuracy</p>
              </div>
            )
          })}
          {(!data || !data.subjects.length) && <div className="empty">No subject data yet.</div>}
        </div>
      )}

      {tab === 'trend' && (
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Score trend across tests</b>
          {report?.trend?.length === 0 && <div className="empty">Complete tests to see your trend.</div>}
          <div className="row" style={{ alignItems: 'flex-end', gap: 10, minHeight: 160 }}>
            {report?.trend?.map((t, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flex: 1 }}>
                <b className="small">{t.score}</b>
                <div style={{ width: '100%', maxWidth: 60, background: 'var(--bg3)', borderRadius: 6, display: 'flex', alignItems: 'flex-end', height: 120 }}>
                  <div style={{ width: '100%', height: `${Math.min(100, Math.max(3, t.score))}%`, background: 'linear-gradient(180deg, var(--accent), var(--accent2))', borderRadius: 6 }} />
                </div>
                <span className="tiny">#{i + 1}</span>
              </div>
            ))}
          </div>
          <div className="row mt">
            {report?.kinds?.map((k) => (
              <span key={k.kind} className="chip">{k.kind}: {k.avgAccuracy}% acc · {k.count} tests</span>
            ))}
          </div>
        </div>
      )}

      {tab === 'recommendations' && (
        <div className="col">
          {recs.map((r, i) => (
            <div key={i} className="ai-bubble">
              <b>{r.title}</b>
              <p className="small muted" style={{ marginTop: 4 }}>{r.text}</p>
            </div>
          ))}
          {recs.length === 0 && <div className="empty">Take a test to get personalized recommendations.</div>}
        </div>
      )}

      {tab === 'speed' && (
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Speed per question across recent tests</b>
          {report?.speedTrend?.map((s, i) => (
            <div key={i} className="row mb">
              <span className="chip">Test #{i + 1}</span>
              <span className={`chip ${s.avgTimePerQ <= 75 ? '' : s.avgTimePerQ <= 120 ? '' : 'danger'}`} style={s.avgTimePerQ > 120 ? { color: 'var(--red)', borderColor: 'var(--red)' } : {}}>{s.avgTimePerQ}s avg</span>
              <span className="tiny">{s.answered} answered</span>
            </div>
          ))}
          {report?.speedTrend?.length === 0 && <div className="empty">No speed data yet.</div>}
        </div>
      )}
    </StudentLayout>
  )
}
