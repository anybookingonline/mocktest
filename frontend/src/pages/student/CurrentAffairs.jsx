import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast } from '../../components/ui.jsx'

// Current Affairs Pro — daily AI-generated quiz. Entitlement is enforced
// server-side; this page shows the locked state with a Plans link for free users.
export default function CurrentAffairs() {
  const nav = useNavigate()
  const toast = useToast()
  const [quiz, setQuiz] = useState(null)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/ca/today')
      .then(setQuiz)
      .catch((e) => { if (e.status === 402) setLocked(true); else toast(e.message, 'err') })
  }, [])

  const start = async () => {
    setBusy(true)
    try {
      const d = await api.post('/ca/attempt', {})
      nav(`/tests/0/session?attempt=${d.attemptId}`)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <StudentLayout title="📰 Current Affairs">
      {locked ? (
        <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}>
          <div style={{ fontSize: 40 }}>📰</div>
          <h2 className="mt mb">Current Affairs Pro</h2>
          <p className="small muted" style={{ maxWidth: 460, margin: '0 auto 18px' }}>
            Roz ka AI-generated quiz — 10 questions from the last 7 days of news,
            aapke target exam ke hisaab se (UPSC, Banking, SSC focus). Har din naya set.
          </p>
          <div className="row" style={{ justifyContent: 'center' }}>
            <a href="/retention" className="btn btn-primary">Plans page se unlock karo →</a>
          </div>
          <p className="tiny muted mt">Koi bhi paid plan lene par bhi CA quiz khul jata hai.</p>
        </div>
      ) : (
        <>
          <div className="card mb" style={{ background: 'linear-gradient(120deg, rgba(99,102,241,0.2), rgba(34,211,238,0.1))', border: '1px solid rgba(99,102,241,0.35)' }}>
            <div className="spread">
              <div>
                <div className="row mb"><h2>Aaj ka quiz {quiz?.cached && <Badge kind="gray">ready</Badge>}</h2></div>
                <p className="small muted">{quiz ? `${quiz.exam.name} — ${quiz.count} questions · fresh from the last 7 days` : 'Loading today\'s set…'}</p>
              </div>
              <button className="btn btn-primary" onClick={start} disabled={busy || !quiz}>
                {busy ? 'Starting…' : '▶ Start today\'s quiz'}
              </button>
            </div>
          </div>
          <div className="card">
            <b className="small">Kaise kaam karta hai?</b>
            <ul className="tiny muted" style={{ lineHeight: 2, paddingLeft: 18, marginTop: 8 }}>
              <li>AI roz subah aapke exam ke liye 10 current-affairs MCQs banata hai</li>
              <li>Wahi set din bhar sab CA Pro students ke liye same — fair comparison</li>
              <li>Kal phir naya set — 7 din ke news cycle se</li>
              <li>Wrong answers ka AI explanation turant milega</li>
            </ul>
          </div>
        </>
      )}
    </StudentLayout>
  )
}
