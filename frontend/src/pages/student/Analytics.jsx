import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { useAuth } from '../../context/AuthContext.jsx'
import { Badge, Progress, Skeleton, fmtDuration, statColor, useToast } from '../../components/ui.jsx'

export default function Analytics() {
  const nav = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [data, setData] = useState(null)
  const [report, setReport] = useState(null)
  const [recs, setRecs] = useState([])
  const [heatmap, setHeatmap] = useState(null)
  const [predict, setPredict] = useState(null)
  const [shareUrl, setShareUrl] = useState(null)
  const [shareBusy, setShareBusy] = useState(false)
  const [tab, setTab] = useState('weak')

  useEffect(() => {
    api.get('/analytics/overview').then(setData).catch(() => {})
    api.get('/analytics/report').then(setReport).catch(() => {})
    api.get('/analytics/recommendations').then((d) => setRecs(d.recommendations)).catch(() => {})
  }, [])

  useEffect(() => {
    if (tab === 'heatmap' && !heatmap) api.get('/analytics/heatmap').then(setHeatmap).catch(() => {})
    if (tab === 'predict' && !predict && user?.exam_id) api.get(`/analytics/predict?examId=${user.exam_id}`).then(setPredict).catch(() => {})
  }, [tab])

  const shareReport = async () => {
    setShareBusy(true)
    try {
      const d = await api.post('/analytics/report/share', {})
      const url = `${window.location.origin}/report/${d.token}`
      setShareUrl(url)
      try { await navigator.clipboard.writeText(url); toast('Link copied — parents ko bhej do!', 'ok') } catch { toast('Link ready — neeche se copy karo', 'ok') }
    } catch (e) { toast(e.message, 'err') } finally { setShareBusy(false) }
  }

  const revokeShare = async () => {
    try { await api.post('/analytics/report/share/revoke', {}); setShareUrl(null); toast('Purana link band ho gaya', 'ok') } catch (e) { toast(e.message, 'err') }
  }

  return (
    <StudentLayout title="Performance Analytics">
      <div className="card mb spread">
        <div>
          <b className="small">👪 Parent Report</b>
          <p className="tiny muted">Ek read-only link banao jo parents/guardian bina login ke dekh sakte hain.</p>
          {shareUrl && <input className="input tiny mt" readOnly value={shareUrl} onFocus={(e) => e.target.select()} style={{ maxWidth: 320 }} />}
        </div>
        <div className="row">
          <button className="btn btn-primary btn-sm" onClick={shareReport} disabled={shareBusy}>{shareBusy ? '…' : shareUrl ? '🔗 Copy again' : '🔗 Get share link'}</button>
          {shareUrl && <button className="btn btn-ghost btn-sm" onClick={revokeShare}>Revoke</button>}
        </div>
      </div>

      <div className="row mb">
        {[['weak', 'Weak Topic Analysis'], ['heatmap', 'Heatmap'], ['subjects', 'Subject-wise'], ['trend', 'Score Trend'], ['recommendations', 'Recommendations'], ['speed', 'Speed Analysis'], ['predict', 'Rank Estimate']].map(([k, label]) => (
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

      {tab === 'heatmap' && (
        <div className="card">
          <div className="spread mb">
            <b className="small">Weak-area heatmap — every topic you've attempted, red = weak, green = strong</b>
            <span className="tiny muted">tile size ≈ how many questions attempted</span>
          </div>
          {!heatmap && <Skeleton h={200} />}
          {heatmap?.subjects?.length === 0 && <div className="empty">Answer more questions to build your heatmap.</div>}
          {heatmap?.subjects?.map((s) => (
            <div key={s.id} className="mb" style={{ marginBottom: 18 }}>
              <div className="spread small mb">
                <b>{s.name}</b>
                <span className="tiny muted">{s.accuracy != null ? `${s.accuracy}% overall` : '—'}</span>
              </div>
              {s.chapters.map((c) => (
                <div key={c.id} className="row" style={{ flexWrap: 'wrap', gap: 6, alignItems: 'center', marginBottom: 8 }}>
                  <span className="tiny muted" style={{ width: 140, flexShrink: 0 }}>{c.name}</span>
                  {c.topics.map((t) => (
                    <div key={t.id}
                      title={`${t.name} — ${t.accuracy}% (${t.correct}/${t.attempts})`}
                      style={{
                        width: Math.min(64, 26 + t.attempts * 3), height: 26,
                        background: heatColor(t.accuracy), opacity: Math.min(1, 0.45 + t.attempts * 0.1),
                        borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 10, color: '#0b0f1a', fontWeight: 700, cursor: 'default'
                      }}>
                      {t.accuracy}%
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ))}
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

      {tab === 'predict' && (
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Rank estimate</b>
          {!user?.exam_id && <div className="empty">Profile me apna target exam select karo pehle.</div>}
          {user?.exam_id && !predict && <Skeleton h={120} />}
          {predict && !predict.enough && <div className="empty">{predict.message}</div>}
          {predict?.enough && (
            <>
              {predict.percentileRange ? (
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 34, fontWeight: 800 }}>{predict.percentileRange[0]}–{predict.percentileRange[1]}th percentile</div>
                  <p className="tiny muted">among {predict.sampleSize} Aisepadho students on this exam</p>
                </div>
              ) : <p className="small muted">Abhi enough students nahi hain is exam par ek percentile estimate ke liye.</p>}
              <div className="row mt" style={{ justifyContent: 'center', gap: 10 }}>
                <span className="chip">Recent accuracy: {predict.recentAccuracy}%</span>
                <Badge kind={predict.trend === 'improving' ? 'green' : predict.trend === 'declining' ? 'red' : 'amber'}>
                  {predict.trend === 'improving' ? '📈 Improving' : predict.trend === 'declining' ? '📉 Declining' : '➡️ Steady'}
                </Badge>
              </div>
              <p className="tiny muted mt" style={{ textAlign: 'center' }}>⚠️ {predict.disclaimer}</p>
            </>
          )}
        </div>
      )}
    </StudentLayout>
  )
}

// Smooth red(0%) -> amber(50%) -> green(100%) hue ramp for the heatmap tiles.
function heatColor(pct) {
  const p = Math.max(0, Math.min(100, pct ?? 0))
  return `hsl(${Math.round(p * 1.2)}, 70%, 50%)`
}
