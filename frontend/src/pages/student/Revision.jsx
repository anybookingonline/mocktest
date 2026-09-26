import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Empty, useToast, fmtDate, Progress, Modal } from '../../components/ui.jsx'

// Spaced Revision (#7) — "aaj ye revise karo" driven by the Leitner forgetting
// curve over the student's own topic stats. One click starts a 10-Q mixed mock.
export default function Revision() {
  const nav = useNavigate()
  const toast = useToast()
  const [due, setDue] = useState([])
  const [busy, setBusy] = useState(false)
  const [summaryTopic, setSummaryTopic] = useState(null) // { topic_id, topic } while summary modal is open
  const [summary, setSummary] = useState('')
  const [summaryBusy, setSummaryBusy] = useState(false)
  const [flashTopic, setFlashTopic] = useState(null)

  const load = () => api.get('/revision/due').then((d) => setDue(d.due || [])).catch(() => {})
  useEffect(() => { load() }, [])

  const openSummary = async (t) => {
    setSummaryTopic(t)
    setSummary('')
    setSummaryBusy(true)
    try {
      const d = await api.get(`/ai/topic-summary/${t.topic_id}`)
      setSummary(d.summary)
    } catch (e) { toast(e.message, 'err'); setSummaryTopic(null) } finally { setSummaryBusy(false) }
  }

  const startMock = async () => {
    setBusy(true)
    try {
      const d = await api.post('/revision/start', {})
      toast(`Revision test ready — ${d.questionCount} questions`, 'ok')
      // attempt=… resume-mode: attempt already exists, session fetches it
      nav(`/tests/0/session?attempt=${d.attemptId}`)
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
            <div className="row mt" style={{ gap: 6 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => openSummary(t)}>📖 Summary</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setFlashTopic(t)}>🗂️ Flashcards</button>
            </div>
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

      <Modal open={!!summaryTopic} onClose={() => setSummaryTopic(null)} title={summaryTopic ? `📖 ${summaryTopic.topic}` : ''}
        footer={<button className="btn btn-ghost" onClick={() => setSummaryTopic(null)}>Close</button>}>
        {summaryBusy ? <div className="spin" /> : <p className="small" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.7 }}>{summary}</p>}
      </Modal>

      {flashTopic && <FlashcardModal topic={flashTopic} onClose={() => setFlashTopic(null)} toast={toast} />}
    </StudentLayout>
  )
}

// Flip-card recall viewer for one topic — "Got it" / "Still learning" feeds
// the same Leitner box the test-based revision engine uses (see
// /revision/flashcard-result), so flashcard review actually moves the topic
// through the forgetting-curve schedule, not just a throwaway quiz.
function FlashcardModal({ topic, onClose, toast }) {
  const [cards, setCards] = useState(null)
  const [i, setI] = useState(0)
  const [flipped, setFlipped] = useState(false)

  useEffect(() => {
    api.get(`/revision/flashcards/${topic.topic_id}`).then((d) => setCards(d.cards || [])).catch((e) => { toast(e.message, 'err'); onClose() })
  }, [topic.topic_id])

  const mark = async (gotIt) => {
    try { await api.post('/revision/flashcard-result', { topicId: topic.topic_id, gotIt }) } catch { /* non-fatal */ }
    if (i + 1 < (cards?.length || 0)) { setI(i + 1); setFlipped(false) } else onClose()
  }

  return (
    <Modal open onClose={onClose} title={`🗂️ ${topic.topic}`}>
      {!cards && <div className="spin" />}
      {cards && cards.length === 0 && <p className="small muted">Flashcards nahi ban paye — dobara try karo.</p>}
      {cards && cards.length > 0 && (
        <>
          <p className="tiny muted mb">Card {i + 1} / {cards.length}</p>
          <div className="card" style={{ minHeight: 140, display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', cursor: 'pointer', padding: 24 }}
            onClick={() => setFlipped((f) => !f)}>
            <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{flipped ? cards[i].back : cards[i].front}</p>
          </div>
          <p className="tiny muted mt" style={{ textAlign: 'center' }}>{flipped ? 'Answer — tap to flip back' : 'Tap the card to reveal the answer'}</p>
          {flipped && (
            <div className="row mt" style={{ justifyContent: 'center', gap: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => mark(false)}>😵 Still learning</button>
              <button className="btn btn-primary btn-sm" onClick={() => mark(true)}>✅ Got it</button>
            </div>
          )}
        </>
      )}
    </Modal>
  )
}
