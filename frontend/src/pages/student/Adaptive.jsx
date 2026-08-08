import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Modal, useToast, fmtDuration } from '../../components/ui.jsx'

export default function Adaptive() {
  const nav = useNavigate()
  const toast = useToast()
  const [exams, setExams] = useState([])
  const [syllabus, setSyllabus] = useState([])
  const [cfg, setCfg] = useState({ examId: '', chapterId: '', topicId: '', num: 10 })
  const [sessionId, setSessionId] = useState(null)
  const [question, setQuestion] = useState(null)
  const [level, setLevel] = useState('medium')
  const [progress, setProgress] = useState({ completed: 0, total: 10 })
  const [result, setResult] = useState(null)
  const [score, setScore] = useState(0)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [streak, setStreak] = useState(0)
  const [startedAt, setStartedAt] = useState(null)

  useEffect(() => { api.get('/exams').then((d) => setExams(d.exams)) }, [])
  useEffect(() => {
    if (!cfg.examId) { setSyllabus([]); return }
    api.get(`/exams/${cfg.examId}/syllabus`).then((d) => setSyllabus(d.syllabus)).catch(() => {})
  }, [cfg.examId])

  const chapters = syllabus.flatMap((s) => s.chapters.map((c) => ({ ...c, subject: s.name })))

  const start = async () => {
    if (!cfg.examId) { toast('Select an exam', 'err'); return }
    setBusy(true)
    try {
      const d = await api.post('/ai/adaptive/start', { examId: Number(cfg.examId), chapterId: cfg.chapterId ? Number(cfg.chapterId) : null, topicId: cfg.topicId ? Number(cfg.topicId) : null, numQuestions: Number(cfg.num) })
      setSessionId(d.attemptId)
      setProgress({ completed: 0, total: Number(cfg.num) })
      setScore(0); setDone(false); setResult(null); setStreak(0)
      setStartedAt(Date.now())
      const next = await api.post(`/ai/adaptive/${d.attemptId}/next`, {})
      setQuestion(next.question); setLevel(next.level); setProgress({ completed: next.completed, total: next.total })
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const submit = async (selected) => {
    if (!question || busy) return
    setBusy(true)
    const spent = Math.round((Date.now() - (startedAt || Date.now())) / 1000) || 5
    setElapsed((e) => e + spent)
    try {
      await api.post(`/attempts/${sessionId}/answer`, { questionId: question.id, selected, timeSpent: Math.max(1, spent) })
      const isCorrect = String(selected).trim().toLowerCase() === String(question.correct_answer).trim().toLowerCase()
      setStreak(isCorrect ? streak + 1 : 0)
      if (isCorrect) setScore((s) => s + question.marks)
      setResult({ isCorrect, question: { ...question, selected } })
      if (isCorrect) {
        const next = await api.post(`/ai/adaptive/${sessionId}/next`, { lastQuestionId: question.id, wasCorrect: true })
        handleNext(next)
      } else {
        setQuestion(null) // show solution; user clicks continue
      }
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const handleNext = (next) => {
    if (next.done) {
      setDone(true)
      api.post(`/attempts/${sessionId}/complete`, {}).catch(() => {})
    } else {
      setProgress({ completed: next.completed, total: next.total })
      setLevel(next.level)
      setQuestion(next.question)
      setResult(null)
      setStartedAt(Date.now())
    }
  }

  const continueAfterWrong = async () => {
    setBusy(true)
    try {
      const next = await api.post(`/ai/adaptive/${sessionId}/next`, { lastQuestionId: result.question.id, wasCorrect: false })
      setResult(null)
      handleNext(next)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <StudentLayout title="Adaptive Practice">
      <div className="card mb">
        <p className="small muted">🧠 Difficulty auto-adjusts to your level. Answer correctly and the questions get harder; miss and they get easier.</p>
      </div>

      {!sessionId && (
        <div className="card">
          <div className="field-row">
            <label className="field"><span>Exam</span>
              <select className="select" value={cfg.examId} onChange={(e) => { setCfg({ ...cfg, examId: e.target.value, chapterId: '', topicId: '' }) }}>
                <option value="">Select exam…</option>
                {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Chapter (optional)</span>
              <select className="select" value={cfg.chapterId} onChange={(e) => setCfg({ ...cfg, chapterId: e.target.value, topicId: '' })}>
                <option value="">All chapters</option>
                {chapters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
            <label className="field"><span>Questions</span>
              <input className="input" type="number" min="5" max="50" value={cfg.num} onChange={(e) => setCfg({ ...cfg, num: e.target.value })} />
            </label>
          </div>
          <button className="btn btn-primary" onClick={start} disabled={busy}>{busy ? 'Starting…' : 'Start adaptive session'}</button>
        </div>
      )}

      {sessionId && (
        <div className="card mb spread">
          <div className="row">
            <span className="chip">Session #{sessionId}</span>
            <span className="chip">Level: <b style={{ color: level === 'hard' ? 'var(--red)' : level === 'medium' ? 'var(--amber)' : 'var(--green)' }}>{level}</b></span>
            <span className="chip">🔥 streak {streak}</span>
            <span className="chip">⏱️ {fmtDuration(elapsed)}</span>
          </div>
          <div className="row">
            <Badge kind="blue">{progress.completed}/{progress.total} solved</Badge>
            <Badge kind="green">{score} pts</Badge>
          </div>
        </div>
      )}

      {sessionId && question && !done && (
        <div className="card qcard">
          <div className="spread mb">
            <Badge kind="purple">{question.qtype} · {question.difficulty}</Badge>
            <span className="tiny">+{question.marks} / -{question.negative_marks}</span>
          </div>
          <div className="qtext">{question.question_text}</div>
          {question.options?.length > 0 && (
            <div className="mt">
              {question.options.map((opt) => {
                const key = opt.split('.')[0]?.trim()
                return (
                  <div key={opt} className="option" onClick={() => submit(key)}>
                    <span className="key">{key}</span><span style={{ whiteSpace: 'pre-wrap' }}>{opt.slice(opt.indexOf('.') + 1).trim() || opt}</span>
                  </div>
                )
              })}
            </div>
          )}
          {(question.qtype === 'numerical' || question.qtype === 'integer') && (
            <div className="row mt">
              <input className="input" style={{ maxWidth: 200 }} placeholder="Type answer" id="num-ans"
                onKeyDown={(e) => { if (e.key === 'Enter') submit(e.target.value) }} />
              <button className="btn btn-primary" onClick={() => { const v = document.getElementById('num-ans').value; if (v) submit(v) }}>Submit</button>
            </div>
          )}
        </div>
      )}

      {result && !question && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 620 }}>
            <div className="spread mb">
              <h2 style={{ color: result.isCorrect ? 'var(--green)' : 'var(--red)' }}>{result.isCorrect ? '✅ Correct!' : '❌ Not quite'}</h2>
              {result.isCorrect && <Badge kind="green">+{result.question.marks} pts</Badge>}
            </div>
            <div className="solution">
              <b>Correct answer: {result.question.correct_answer}</b>
              <p className="small mt" style={{ whiteSpace: 'pre-wrap' }}>{result.question.explanation || 'No explanation.'}</p>
            </div>
            <div className="row mt" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-primary" onClick={result.isCorrect ? continueAfterWrong : continueAfterWrong} disabled={busy}>Next question →</button>
            </div>
          </div>
        </div>
      )}

      {done && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 460, textAlign: 'center' }}>
            <div style={{ fontSize: 54 }}>🏁</div>
            <h2>Session complete!</h2>
            <p className="muted small">Adaptive practice finished. Keep going — your weak topics are being tracked for analytics.</p>
            <div className="row mt" style={{ justifyContent: 'center' }}>
              <button className="btn btn-ghost" onClick={() => { setSessionId(null); setQuestion(null) }}>New session</button>
              <button className="btn btn-primary" onClick={() => nav('/analytics')}>View analytics</button>
            </div>
          </div>
        </div>
      )}
    </StudentLayout>
  )
}
