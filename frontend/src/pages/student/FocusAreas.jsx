import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Empty, useToast, Progress } from '../../components/ui.jsx'

// AI Focus Areas (#3) — "topics most frequently asked in past years".
// Pro-exclusive (any paid plan); free users see the upgrade card.
export default function FocusAreas() {
  const toast = useToast()
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [data, setData] = useState(null)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    api.get('/focus/status').then((d) => {
      setExams(d.exams || [])
      if (d.exams?.length) setExamId(String(d.exams[0].id))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!examId) return
    setBusy(true)
    api.get(`/focus?examId=${examId}`)
      .then(setData)
      .catch((e) => {
        if (e.status === 402) setLocked(true)
        else toast(e.message, 'err')
      })
      .finally(() => setBusy(false))
  }, [examId])

  const refresh = async () => {
    setRefreshing(true)
    try {
      await api.post(`/focus/refresh/${examId}`, {})
      const d = await api.get(`/focus?examId=${examId}&refresh=1`)
      setData(d)
      toast('Focus areas regenerated from latest PYQ data', 'ok')
    } catch (e) { toast(e.message, 'err') } finally { setRefreshing(false) }
  }

  const maxScore = data?.areas?.[0]?.score || 1

  return (
    <StudentLayout title="🔥 AI Focus Areas">
      <div className="card mb">
        <div className="spread">
          <div>
            <b>Topics most frequently asked in past years</b>
            <p className="tiny muted">Ranked purely from the previous-year papers stored in your platform (year / shift / topic data) — updated automatically, 7-day cache. High-frequency topics pehle master karo.</p>
          </div>
          <div className="row">
            <select className="select" style={{ width: 220 }} value={examId} onChange={(e) => { setExamId(e.target.value); setData(null); setLocked(false) }}>
              {exams.length === 0 && <option value="">No PYQ data yet</option>}
              {exams.map((e) => <option key={e.id} value={e.id}>{e.name} ({e.pyq_count} PYQs)</option>)}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={refresh} disabled={!examId || refreshing || locked}>{refreshing ? 'Refreshing…' : '↻ Regenerate'}</button>
          </div>
        </div>
      </div>

      {locked && (
        <div className="card" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🔥</div>
          <b style={{ fontSize: 18 }}>AI Focus Areas ek Pro feature hai</b>
          <p className="muted small" style={{ maxWidth: 460, margin: '10px auto 18px' }}>
            Koi bhi paid plan (Data Retention ya AI Power Pack) Focus Areas unlock kar deta hai — saath me unlimited battles priority, unlimited AI doubts aur data retention bhi.
          </p>
          <Link to="/retention" className="btn btn-primary">Unlock with Pro →</Link>
        </div>
      )}

      {!locked && busy && <div className="card"><div className="spin" /></div>}

      {!locked && !busy && data && (data.isEmpty || !data.areas?.length) && (
        <Empty title="Is exam ka PYQ data abhi kam hai" text="Admin panel se PYQ PDFs import karo (2+ papers) — phir Focus Areas khud ban jayenge." />
      )}

      {!locked && !busy && data?.areas?.length > 0 && (
        <div className="col">
          {data.areas.map((a) => (
            <div key={a.topicId} className="card hover">
              <div className="spread">
                <div className="row" style={{ gap: 12 }}>
                  <div className="metric" style={{ minWidth: 46, textAlign: 'center' }}>
                    <div className="m-value" style={{ color: a.rank <= 3 ? 'var(--accent2)' : undefined }}>#{a.rank}</div>
                  </div>
                  <div>
                    <b>{a.topic}</b>
                    <div className="tiny muted">{a.subject} › {a.chapter}</div>
                  </div>
                </div>
                <div className="row">
                  <Badge kind={a.rank <= 3 ? 'green' : a.rank <= 6 ? 'amber' : 'gray'}>{a.rank <= 3 ? '🔥 Top priority' : a.rank <= 6 ? 'High frequency' : 'Frequent'}</Badge>
                  <span className="chip">{a.appearances} questions</span>
                  <span className="chip">{a.yearsSeen} years</span>
                  {a.lastYear && <span className="chip">last: {a.lastYear}</span>}
                </div>
              </div>
              <p className="small" style={{ marginTop: 10, color: 'var(--text2)' }}>💡 {a.note}</p>
              <Progress value={(a.score / maxScore) * 100} />
            </div>
          ))}
          <p className="tiny muted" style={{ textAlign: 'center' }}>
            Ranking aapke platform ki legally-imported PYQ data se banti hai — sirf "most frequently asked in past years" dikhata hai, koi prediction claim nahi.
            {data.cached ? ' (cached)' : ''}
          </p>
        </div>
      )}

      {!locked && !busy && !data && !examId && (
        <Empty title="Koi exam me PYQ data nahi mila" text="Admin → PDF Import se previous year papers upload karo." />
      )}
    </StudentLayout>
  )
}
