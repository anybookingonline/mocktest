import React, { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { api } from '../../api/client.js'
import { Badge, Progress, Empty, useToast, fmtDuration, fmtDate, qTypeLabel, diffBadge } from '../../components/ui.jsx'

export default function Results() {
  const { id } = useParams()
  const nav = useNavigate()
  const toast = useToast()
  const [data, setData] = useState(null)
  const [reviewMode, setReviewMode] = useState('all') // all | wrong | correct | skipped
  const [doubtQ, setDoubtQ] = useState(null)
  const [doubtMsg, setDoubtMsg] = useState('')
  const [doubtRes, setDoubtRes] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get(`/attempts/${id}`).then(setData).catch((e) => toast(e.message, 'err'))
  }, [id])

  if (!data) return <div className="auth-wrap"><div className="spin" style={{ width: 30, height: 30 }} /></div>

  const { attempt, questions } = data
  const map = {}
  questions.forEach((q) => { map[q.id] = q })
  const results = questions.map((q) => {
    const a = (attempt.answers || []).find((x) => x.questionId === q.id)
    return { q, a }
  })
  const wrongList = results.filter((r) => r.a?.selected != null && !r.a?.correct)
  const correctList = results.filter((r) => r.a?.correct)
  const skippedList = results.filter((r) => r.a?.selected == null)

  const shown = results.filter((r) => {
    if (reviewMode === 'wrong') return r.a?.selected != null && !r.a?.correct
    if (reviewMode === 'correct') return r.a?.correct
    if (reviewMode === 'skipped') return r.a?.selected == null
    return true
  })

  const askDoubt = async () => {
    if (!doubtMsg.trim()) return
    setBusy(true)
    try {
      const d = await api.post('/ai/doubt', { questionId: doubtQ.id, message: doubtMsg })
      setDoubtRes(d.response)
    } catch (e) { setDoubtRes('AI not configured — set a key in Admin → AI Config.') } finally { setBusy(false) }
  }

  const percentile = () => {
    return Math.max(1, Math.min(99, Math.round(attempt.accuracy / 2 + 30)))
  }

  return (
    <div className="content" style={{ maxWidth: 1100 }}>
      <div className="card mb" style={{ background: 'linear-gradient(120deg, rgba(99,102,241,0.2), rgba(34,211,238,0.1))', border: '1px solid rgba(99,102,241,0.35)' }}>
        <div className="spread">
          <div>
            <div className="row mb"><h2>Test Complete 🎉</h2><Badge kind="blue">{fmtDate(attempt.completed_at)}</Badge></div>
            <h1 style={{ fontSize: 40 }}>{attempt.score} <span className="muted" style={{ fontSize: 18 }}>marks</span></h1>
            <p className="muted small">{attempt.title}</p>
          </div>
          <div className="row">
            <button className="btn btn-ghost" onClick={() => nav('/tests')}>Back to tests</button>
            <button className="btn btn-primary" onClick={() => nav('/analytics')}>View analytics</button>
          </div>
        </div>
        <div className="grid grid-4 mt">
          <div className="metric"><div className="m-label">Correct</div><div className="m-value" style={{ color: 'var(--green)' }}>{attempt.correct}</div></div>
          <div className="metric"><div className="m-label">Wrong</div><div className="m-value" style={{ color: 'var(--red)' }}>{attempt.wrong}</div></div>
          <div className="metric"><div className="m-label">Skipped</div><div className="m-value" style={{ color: 'var(--amber)' }}>{attempt.skipped}</div></div>
          <div className="metric"><div className="m-label">Accuracy</div><div className="m-value">{attempt.accuracy}%</div></div>
          <div className="metric"><div className="m-label">Time taken</div><div className="m-value">{fmtDuration(attempt.duration_seconds)}</div></div>
          <div className="metric"><div className="m-label">Percentile</div><div className="m-value" style={{ color: 'var(--accent2)' }}>{percentile()}%</div></div>
        </div>
      </div>

      <div className="card mb">
        <b className="small">Accuracy</b>
        <div className="row mt">
          <Progress value={attempt.accuracy} kind={attempt.accuracy >= 75 ? 'green' : attempt.accuracy >= 50 ? 'amber' : 'red'} />
          <span className="small">{attempt.accuracy}%</span>
        </div>
      </div>

      <div className="spread mb">
        <b>Detailed review — {shown.length} questions</b>
        <div className="row">
          {[['all', 'All'], ['wrong', `Wrong (${wrongList.length})`], ['correct', `Correct (${correctList.length})`], ['skipped', `Skipped (${skippedList.length})`]].map(([k, label]) => (
            <button key={k} className={`btn btn-sm ${reviewMode === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setReviewMode(k)}>{label}</button>
          ))}
        </div>
      </div>

      {shown.length === 0 && <Empty title="No questions in this view" />}

      {shown.map(({ q, a }, i) => {
        const isCorrect = a?.correct
        return (
          <div key={q.id} className="card qcard mb" style={{ opacity: reviewMode === 'all' && a?.selected == null ? 0.75 : 1 }}>
            <div className="spread mb">
              <div className="row">
                <Badge kind="blue">Q{i + 1}</Badge>
                <Badge kind={diffBadge(q.difficulty)}>{q.difficulty}</Badge>
                <Badge kind="purple">{qTypeLabel(q.qtype)}</Badge>
                {a?.selected == null && <Badge kind="amber">Skipped</Badge>}
                {isCorrect && <Badge kind="green">Correct</Badge>}
                {a?.selected != null && !isCorrect && <Badge kind="red">Wrong</Badge>}
              </div>
              <span className="tiny">{fmtDuration(a?.timeSpent || 0)} spent</span>
            </div>
            <div className="qtext">{q.question_text}</div>
            <div className="mt">
              {q.options.map((opt) => {
                const key = opt.split('.')[0]?.trim()
                const isAnswer = String(q.correct_answer).trim().toLowerCase() === String(key).toLowerCase()
                const isChosen = a?.selected != null && String(a.selected).trim().toLowerCase() === String(key).toLowerCase()
                return (
                  <div key={opt} className={`option ${isAnswer ? 'correct' : ''} ${isChosen && !isAnswer ? 'wrong' : ''}`}>
                    <span className="key">{key}</span><span style={{ whiteSpace: 'pre-wrap' }}>{opt.slice(opt.indexOf('.') + 1).trim() || opt}</span>
                    {isAnswer && <span style={{ marginLeft: 'auto', color: 'var(--green)', fontWeight: 700 }}>✓</span>}
                    {isChosen && !isAnswer && <span style={{ marginLeft: 'auto', color: 'var(--red)', fontWeight: 700 }}>✗</span>}
                  </div>
                )
              })}
              {(q.qtype === 'numerical' || q.qtype === 'integer') && (
                <div className="row">
                  <span className="chip">Your answer: {a?.selected ?? '—'}</span>
                  <span className="chip" style={{ borderColor: 'var(--green)', color: 'var(--green)' }}>Correct: {q.correct_answer}</span>
                </div>
              )}
            </div>
            <div className="solution mt">
              <b>Solution:</b>
              <p className="small mt" style={{ whiteSpace: 'pre-wrap' }}>{q.explanation || 'No explanation available.'}</p>
            </div>
            <div className="row mt">
              <button className="btn btn-ghost btn-sm" onClick={() => { setDoubtQ(q); setDoubtMsg(''); setDoubtRes('') }}>💬 Ask AI doubt</button>
              <button className="btn btn-ghost btn-sm" onClick={async () => {
                try { await api.post(`/questions/${q.id}/toggle-bookmark`); toast('Bookmark updated') } catch (e) { toast(e.message, 'err') }
              }}>🔖 Bookmark</button>
            </div>
            {doubtQ?.id === q.id && (
              <div className="mt">
                <div className="row">
                  <input className="input" style={{ flex: 1 }} placeholder="Ask anything about this question…" value={doubtMsg} onChange={(e) => setDoubtMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askDoubt()} />
                  <button className="btn btn-accent btn-sm" onClick={askDoubt} disabled={busy}>{busy ? '…' : 'Ask'}</button>
                </div>
                {doubtRes && <div className="ai-bubble mt">{doubtRes}</div>}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
