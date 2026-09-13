import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Empty, useToast, fmtDate, Progress } from '../../components/ui.jsx'

// Spaced Revision (#7) — "aaj ye revise karo" driven by the Leitner forgetting
// curve over the student's own topic stats. One click starts a 10-Q mixed mock.
export default function Revision() {
  const nav = useNavigate()
  const toast = useToast()
  const [due, setDue] = useState([])
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/revision/due').then((d) => setDue(d.due || [])).catch(() => {})
  useEffect(() => { load() }, [])

  const startMock = async () => {
    setBusy(true)
    try {
      const d = await api.post('/revision/start', {})
      toast(`Revision test ready — ${d.questionCount} questions`, 'ok')
      nav(`/tests/${d.attemptId}/session`)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const BOX_LABEL = { 1: 'Strength building', 2: '3-day cycle', 3: 'Weekly', 4: 'Bi-weekly', 5: 'Monthly — mastered' }

  return (
    <StudentLayout title="🔁 AI Revision">
      <div className="card mb">
        <div className="spread">
          <div>
            <b>Today's revision plan</b>
            <p className="tiny muted">AI aapke topic accuracy + time ke basis par ye decide karta hai ki kis topic ko aaj dohrana hai (forgetting-curve scheduling). Revision karte hi topic agle interval me chala jata hai.</p>
          </div>
          <button className="btn btn-primary" onClick={startMock} disabled={busy || !due.length}>
            {busy ? 'Preparing…' : `▶ Start Revision Test ${due.length ? `(${Math.min(10, due.length * 2)} Q)` : ''}`}
          </button>
        </div>
      </div>

      {due.length === 0 && (
        <Empty title="🎉 Aaj kuch due nahi hai!" text="Ya to sab topics strong hain, ya aapne abhi practice shuru nahi ki. Practice/mock tests khelne par ye list khud build hogi." />
      )}

      <div className="grid grid-2">
        {due.map((t) => (
          <div key={t.topic_id} className="card">
            <div className="spread mb">
              <b>{t.topic}</b>
              <Badge kind={t.box <= 2 ? 'red' : t.box <= 3 ? 'amber' : 'green'}>{BOX_LABEL[t.box] || `Box ${t.box}`}</Badge>
            </div>
            <div className="tiny muted mb">{t.subject} › {t.chapter}</div>
            {t.attempts > 0 ? (
              <>
                <div className="row tiny muted mb" style={{ justifyContent: 'space-between' }}>
                  <span>Accuracy: <b style={{ color: t.accuracy >= 60 ? 'var(--green)' : t.accuracy >= 40 ? 'var(--amber)' : 'var(--red)' }}>{t.accuracy}%</b></span>
                  <span>{t.correct}/{t.attempts} correct</span>
                </div>
                <Progress value={t.accuracy} kind={t.accuracy >= 60 ? 'green' : t.accuracy >= 40 ? 'amber' : 'red'} />
              </>
            ) : <p className="tiny muted">Is topic ka data abhi kam hai — revision test se shuru karo.</p>}
          </div>
        ))}
      </div>

      <div className="card mt">
        <b className="small">Kaise kaam karta hai?</b>
        <p className="tiny muted mt" style={{ marginTop: 6 }}>
          • Har topic ka apna "box" hota hai — Box 1 har din, Box 2 har 3 din, Box 3 har hafta, Box 4 har 15 din, Box 5 har mahine.<br />
          • Topic par lagatar 2 sahi answers → box up (revision kam baar). Galat answer → box down (revision zyada baar).<br />
          • 90 din tak koi practice nahi → topic wapas Box 1 me (taaki exam se pehle dobara surface ho).<br />
          • Telegram bot linked hai to roz ka nudge bhi milega (max 1/day).
        </p>
      </div>
    </StudentLayout>
  )
}
