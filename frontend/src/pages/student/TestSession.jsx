import React, { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client.js'
import { Badge, useToast, fmtDuration, qTypeLabel, diffBadge } from '../../components/ui.jsx'

export default function TestSession() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()

  const [test, setTest] = useState(null)
  const [questions, setQuestions] = useState([])
  const [attemptId, setAttemptId] = useState(null)
  const [loading, setLoading] = useState(true)

  const [idx, setIdx] = useState(0)
  const [remaining, setRemaining] = useState(0)
  const [running, setRunning] = useState(false)
  const [answers, setAnswers] = useState([])
  const [overlay, setOverlay] = useState(null) // 'correct' | 'solution'
  const [lastResult, setLastResult] = useState(null)
  const [doubtMsg, setDoubtMsg] = useState('')
  const [doubtRes, setDoubtRes] = useState('')
  const [doubtBusy, setDoubtBusy] = useState(false)
  const [explainBusy, setExplainBusy] = useState(false)
  const [showExpl, setShowExpl] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)

  const qStartRef = useRef(Date.now())
  const timeLimitRef = useRef(0)
  const answersRef = useRef([])

  useEffect(() => {
    (async () => {
      try {
        const ids = searchParams.get('ids')
        let t = null
        let a
        let qs = []
        if (ids) {
          qs = ids.split(',').map(Number).filter(Boolean)
          a = await api.post('/attempts', { questionIds: qs, title: 'Bookmarked Questions', kind: 'revision' })
          t = { id: a.attemptId, title: 'Bookmarked Questions', config: {} }
        } else {
          const res = await api.get(`/tests/${id}`)
          t = res.test
          qs = res.questions || []
          a = await api.post('/attempts', { testId: Number(id) })
        }
        if (!t) throw new Error('Test not found')
        setTest(t)
        setAttemptId(a.attemptId)
        const limit = a.timeLimitSeconds || (qs.length ? qs.reduce((s, q) => s + (q.estimated_time || 90), 0) : 1800)
        setQuestions(qs)
        timeLimitRef.current = limit
        setRemaining(limit)
        setRunning(true)
        qStartRef.current = Date.now()
      } catch (e) {
        toast(e.message, 'err')
        nav('/tests')
      } finally { setLoading(false) }
    })()
  }, [id])

  const answersOf = (qid) => answers.find((x) => x.questionId === qid)

  // ------------------------------- timer ----------------------------------
  useEffect(() => {
    if (!running) return
    const iv = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(iv); handleTimeUp(); return 0 }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [running])

  const handleTimeUp = useCallback(() => {
    setRunning(false)
    toast('Time is up! Auto-submitting your test.', 'err')
    submitAll()
  }, [answers])

  const timeSpentNow = () => {
    const s = (Date.now() - qStartRef.current) / 1000
    qStartRef.current = Date.now()
    return Math.max(1, Math.round(s))
  }

  const elapsed = timeLimitRef.current - remaining

  // ------------------------------- answers --------------------------------
  const upsertAnswer = (entry) => {
    setAnswers((prev) => {
      const next = [...prev]
      const i = next.findIndex((x) => x.questionId === entry.questionId)
      if (i >= 0) next[i] = { ...next[i], ...entry }
      else next.push(entry)
      answersRef.current = next
      return next
    })
  }

  const submitAnswer = async (selected) => {
    if (submitting) return
    const q = questions[idx]
    if (!q) return
    setSubmitting(true)
    setShowExpl(false)
    const spent = timeSpentNow()
    try {
      const d = await api.post(`/attempts/${attemptId}/answer`, {
        questionId: q.id, selected, timeSpent: spent, markedForReview: false
      })
      upsertAnswer({ questionId: q.id, selected, correct: d.correct, timeSpent: spent })
      setLastResult({ ...d, question: q, selected })
      if (d.correct) {
        setOverlay('correct')
      } else {
        // INCORRECT → pause test, show solution with AI doubt clearing
        setRunning(false)
        setOverlay('solution')
        setDoubtMsg('')
        setDoubtRes('')
      }
    } catch (e) {
      toast(e.message, 'err')
      qStartRef.current = Date.now()
    } finally { setSubmitting(false) }
  }

  const skipQuestion = async () => {
    const q = questions[idx]
    const spent = timeSpentNow()
    try {
      await api.post(`/attempts/${attemptId}/answer`, { questionId: q.id, selected: null, timeSpent: spent })
      upsertAnswer({ questionId: q.id, selected: null, correct: false, timeSpent: spent })
      goNext()
    } catch (e) { toast(e.message, 'err') }
  }

  const markReview = async () => {
    const q = questions[idx]
    await api.post(`/attempts/${attemptId}/mark-review`, { questionId: q.id }).catch(() => {})
    upsertAnswer({ questionId: q.id, markedForReview: true })
    toast('Marked for review')
  }

  const resume = () => {
    setOverlay(null)
    goNext()
    setRunning(true)
    qStartRef.current = Date.now()
  }

  const goNext = () => {
    setIdx((i) => Math.min(questions.length - 1, i + 1))
    qStartRef.current = Date.now()
  }
  const goPrev = () => {
    setIdx((i) => Math.max(0, i - 1))
    qStartRef.current = Date.now()
  }

  const askDoubt = async () => {
    if (!doubtMsg.trim()) return
    setDoubtBusy(true)
    try {
      const q = lastResult?.question
      const d = await api.post('/ai/doubt', { questionId: q?.id, message: doubtMsg })
      setDoubtRes(d.response)
    } catch (e) { setDoubtRes('AI is not configured. Set a DeepSeek/Gemini/OpenRouter key in Admin → AI Config.') } finally { setDoubtBusy(false) }
  }

  const showAISolution = async () => {
    const q = lastResult?.question
    if (!q) return
    setExplainBusy(true)
    try {
      const d = await api.post('/ai/explain', { questionId: q.id })
      setShowExpl(d.explanation)
    } catch (e) { setShowExpl(q.explanation || 'No explanation available.') } finally { setExplainBusy(false) }
  }

  const submitAll = async () => {
    setRunning(false)
    try {
      const d = await api.post(`/attempts/${attemptId}/complete`, {})
      nav(`/results/${attemptId}`, { state: { fresh: true } })
    } catch (e) { toast(e.message, 'err') }
  }

  // ------------------------------- render --------------------------------
  if (loading) {
    return <div className="auth-wrap"><div className="spin" style={{ width: 30, height: 30 }} /></div>
  }

  const q = questions[idx]
  if (!q) return null
  const ans = answersOf(q.id)
  const answeredCount = answers.filter((x) => x.selected != null).length
  const correctCount = answers.filter((x) => x.correct).length
  const remainingQ = Math.max(0, questions.length - answeredCount)
  const avgPerRemaining = remainingQ > 0 ? remaining / remainingQ : 0
  const speed = answeredCount > 0 ? elapsed / answeredCount : 0
  const accuracy = answeredCount > 0 ? Math.round((correctCount / answeredCount) * 100) : 0
  const projected = answeredCount > 0 ? (questions.length * elapsed) / answeredCount : null
  const completion = projected ? Math.min(100, Math.round((projected / timeLimitRef.current) * 100)) : 0

  const norm = (v) => (Array.isArray(v) ? v.join('') : String(v || '')).trim().toLowerCase()

  return (
    <div style={{ minHeight: '100vh' }}>
      <div style={{ position: 'sticky', top: 0, zIndex: 30, background: 'rgba(11,15,26,0.92)', backdropFilter: 'blur(8px)', borderBottom: '1px solid var(--border)' }}>
        <div className="content" style={{ padding: '12px 20px', maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <b style={{ flex: 1, minWidth: 160 }}>{test?.title}</b>
          <div className={`timer ${remaining < 300 ? 'warn' : ''}`}>{fmtDuration(remaining)}</div>
          <div className="row" style={{ gap: 6 }}>
            <span className="chip">{answeredCount}/{questions.length} answered</span>
            {elapsed > 0 && <span className="chip">{fmtDuration(elapsed)} elapsed</span>}
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmSubmit(true)}>Submit Test</button>
          </div>
        </div>
      </div>

      <div className="content" style={{ maxWidth: 1400 }}>
        {/* Live pace dashboard */}
        <div className="grid mb" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' }}>
          <div className="metric"><div className="m-label">Avg time / remaining Q</div><div className="m-value" style={{ color: avgPerRemaining < 45 ? 'var(--red)' : avgPerRemaining < 75 ? 'var(--amber)' : 'var(--green)' }}>{avgPerRemaining.toFixed(0)}s</div><div className="tiny">auto-recalculates as you spend time</div></div>
          <div className="metric"><div className="m-label">Your speed</div><div className="m-value">{speed ? speed.toFixed(0) + 's/Q' : '—'}</div><div className="tiny">avg time per answered Q</div></div>
          <div className="metric"><div className="m-label">Accuracy</div><div className="m-value" style={{ color: accuracy >= 75 ? 'var(--green)' : accuracy >= 50 ? 'var(--amber)' : 'var(--red)' }}>{accuracy}%</div><div className="tiny">{correctCount} correct so far</div></div>
          <div className="metric"><div className="m-label">Completion prediction</div><div className="m-value" style={{ color: completion > 100 ? 'var(--red)' : completion > 80 ? 'var(--amber)' : 'var(--green)' }}>{completion}%</div><div className="tiny">{completion > 100 ? 'ahead → will not finish, speed up!' : 'of time budget used'}</div></div>
          <div className="metric"><div className="m-label">Remaining questions</div><div className="m-value">{remainingQ}</div><div className="tiny">avg per question drops as you slow down</div></div>
        </div>

        <div className="grid" style={{ gridTemplateColumns: '1fr 280px', alignItems: 'start', gap: 18 }}>
          {/* Question area */}
          <div className="card qcard">
            <div className="spread mb">
              <div className="row">
                <Badge kind="blue">Q{idx + 1} / {questions.length}</Badge>
                <Badge kind={diffBadge(q.difficulty)}>{q.difficulty}</Badge>
                <Badge kind="purple">{qTypeLabel(q.qtype)}</Badge>
              </div>
              <span className="tiny">+{q.marks} / -{q.negative_marks} · ~{q.estimated_time}s</span>
            </div>

            <div className="qtext">{q.question_text}</div>
            {q.question_image_url && <img src={q.question_image_url} alt="question" style={{ maxWidth: '100%', borderRadius: 10, marginTop: 10 }} />}

            {q.qtype === 'single' && (
              <div className="mt">
                {q.options.map((opt) => {
                  const key = opt.split('.')[0]?.trim()
                  return (
                    <div key={opt} className={`option ${ans?.selected === key ? 'selected' : ''}`} onClick={() => !submitting && submitAnswer(key)}>
                      <span className="key">{key}</span><span style={{ whiteSpace: 'pre-wrap' }}>{opt.slice(opt.indexOf('.') + 1).trim() || opt}</span>
                    </div>
                  )
                })}
              </div>
            )}

            {q.qtype === 'multiple' && (
              <div className="mt">
                {q.options.map((opt) => {
                  const key = opt.split('.')[0]?.trim()
                  const chosen = (ans?.selected || '').includes(key)
                  return (
                    <div key={opt} className={`option ${chosen ? 'selected' : ''}`} onClick={() => {
                      const cur = new Set(ans?.selected ? ans.selected.split('') : [])
                      if (cur.has(key)) cur.delete(key); else cur.add(key)
                      upsertAnswer({ questionId: q.id, selected: [...cur].join(''), correct: false, timeSpent: 0 })
                    }}>
                      <span className="key">{key}</span><span style={{ whiteSpace: 'pre-wrap' }}>{opt.slice(opt.indexOf('.') + 1).trim() || opt}</span>
                    </div>
                  )
                })}
                <button className="btn btn-primary mt" disabled={submitting || !ans?.selected} onClick={() => submitAnswer(ans.selected)}>Submit multi-select</button>
              </div>
            )}

            {(q.qtype === 'numerical' || q.qtype === 'integer') && (
              <div className="mt">
                <input className="input" type="text" placeholder="Enter numeric answer"
                  value={ans?.selected || ''} onChange={(e) => upsertAnswer({ questionId: q.id, selected: e.target.value, correct: false, timeSpent: 0 })}
                  onKeyDown={(e) => { if (e.key === 'Enter' && ans?.selected) submitAnswer(ans.selected) }} />
                <button className="btn btn-primary mt" disabled={submitting || !ans?.selected} onClick={() => submitAnswer(ans.selected)}>Submit numeric answer</button>
              </div>
            )}

            <div className="row mt" style={{ justifyContent: 'space-between' }}>
              <button className="btn btn-ghost btn-sm" onClick={goPrev} disabled={idx === 0}>← Previous</button>
              <div className="row">
                <button className="btn btn-ghost btn-sm" onClick={markReview}>🔖 Review</button>
                <button className="btn btn-ghost btn-sm" onClick={skipQuestion}>Skip</button>
                <button className="btn btn-accent btn-sm" onClick={goNext} disabled={idx === questions.length - 1}>Next →</button>
              </div>
            </div>
          </div>

          {/* Palette */}
          <div className="card">
            <b className="small mb" style={{ display: 'block' }}>Question palette</b>
            <div className="palette mb">
              {questions.map((qq, i) => {
                const a = answersOf(qq.id)
                let cls = 'qdot'
                if (i === idx) cls += ' current'
                if (a?.correct) cls += ' answered'
                else if (a?.selected != null) cls += ' wrong'
                else if (a?.markedForReview) cls += ' review'
                return <button key={qq.id} className={cls} onClick={() => { setIdx(i); qStartRef.current = Date.now() }}>{i + 1}</button>
              })}
            </div>
            <div className="row tiny" style={{ gap: 8 }}>
              <span className="row" style={{ gap: 4 }}><span className="qdot" style={{ height: 18, width: 30, padding: 0 }}>1</span> current</span>
              <span className="row" style={{ gap: 4 }}><span className="qdot answered" style={{ height: 18, width: 30, padding: 0 }}>2</span> correct</span>
              <span className="row" style={{ gap: 4 }}><span className="qdot wrong" style={{ height: 18, width: 30, padding: 0 }}>3</span> wrong</span>
            </div>
          </div>
        </div>
      </div>

      {/* Correct overlay */}
      {overlay === 'correct' && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 520, textAlign: 'center' }}>
            <div style={{ fontSize: 52 }}>🎉</div>
            <h2 style={{ color: 'var(--green)', margin: '8px 0' }}>Correct! +{q.marks} marks</h2>
            <p className="muted small">Good pace. {fmtDuration(remaining)} left · {avgPerRemaining.toFixed(0)}s per remaining question.</p>
            <div className="row mt" style={{ justifyContent: 'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={showAISolution}>{explainBusy ? 'Loading…' : 'Show solution'}</button>
              <button className="btn btn-primary" onClick={resume}>{idx === questions.length - 1 ? 'Finish Test' : 'Next question →'}</button>
            </div>
            {showExpl && <div className="ai-bubble mt" style={{ textAlign: 'left' }}>{showExpl}</div>}
          </div>
        </div>
      )}

      {/* Wrong answer → paused + solution + AI doubt clearing */}
      {overlay === 'solution' && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 720 }}>
            <div className="spread mb">
              <h2 style={{ color: 'var(--red)' }}>Incorrect — test paused ⏸️</h2>
              <Badge kind="amber">Timer stopped</Badge>
            </div>
            <p className="small muted">The timer is paused. Review the correct solution and clear your doubt, then the clock resumes exactly where it stopped.</p>

            <div className="qcard mt" style={{ background: 'var(--bg2)' }}>
              <b className="small">{lastResult?.question?.question_text}</b>
              {lastResult?.question?.options?.map((opt) => {
                const key = opt.split('.')[0]?.trim()
                const isCorrect = norm(key) === norm(lastResult?.question?.correct_answer)
                const isChosen = norm(key) === norm(lastResult?.selected)
                return (
                  <div key={opt} className={`option ${isCorrect ? 'correct' : ''} ${isChosen && !isCorrect ? 'wrong' : ''}`}>
                    <span className="key">{key}</span><span style={{ whiteSpace: 'pre-wrap' }}>{opt.slice(opt.indexOf('.') + 1).trim() || opt}</span>
                    {isCorrect && <span style={{ marginLeft: 'auto', color: 'var(--green)', fontWeight: 700 }}>✓</span>}
                    {isChosen && !isCorrect && <span style={{ marginLeft: 'auto', color: 'var(--red)', fontWeight: 700 }}>✗</span>}
                  </div>
                )
              })}
              <div className="solution mt">
                <b>Correct answer: {lastResult?.question?.correct_answer}</b>
                <p className="small mt" style={{ whiteSpace: 'pre-wrap' }}>{lastResult?.question?.explanation || 'No explanation available.'}</p>
              </div>
            </div>

            <div className="mt">
              <b className="small">Stuck on this? Ask the AI Tutor 💬</b>
              <div className="row mt">
                <input className="input" style={{ flex: 1 }} placeholder="Type your doubt (e.g. why not option B?)" value={doubtMsg} onChange={(e) => setDoubtMsg(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && askDoubt()} />
                <button className="btn btn-accent" onClick={askDoubt} disabled={doubtBusy}>{doubtBusy ? '…' : 'Ask AI'}</button>
              </div>
              {doubtRes && <div className="ai-bubble mt">{doubtRes}</div>}
            </div>

            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => nav('/tests')}>Exit test</button>
              <button className="btn btn-primary" onClick={resume}>Continue — resume timer ▶</button>
            </div>
          </div>
        </div>
      )}

      {confirmSubmit && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 440 }}>
            <h3>Submit test?</h3>
            <p className="muted small mt">Answered: <b>{answeredCount}</b> · Correct: <b style={{ color: 'var(--green)' }}>{correctCount}</b> · Remaining time: <b>{fmtDuration(remaining)}</b></p>
            <p className="tiny mt">Unanswered questions will be marked as skipped. This cannot be undone.</p>
            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setConfirmSubmit(false)}>Keep solving</button>
              <button className="btn btn-danger" onClick={submitAll}>Submit & view result</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
