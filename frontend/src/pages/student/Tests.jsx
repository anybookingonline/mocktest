import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Empty, Modal, useToast, fmtDate, fmtDuration } from '../../components/ui.jsx'

const KIND_LABEL = { mock: 'Mock', chapter: 'Chapter', topic: 'Topic', adaptive: 'Adaptive', speed: 'Speed', revision: 'Revision', custom: 'Custom', full: 'Full Mock' }

export default function Tests() {
  const nav = useNavigate()
  const toast = useToast()
  const [tests, setTests] = useState([])
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [aiModal, setAiModal] = useState(false)
  const [aiCfg, setAiCfg] = useState({ examId: '', count: 15, duration: 30, subject: '', chapter: '', topic: '' })
  const [busy, setBusy] = useState(false)
  const [provider, setProvider] = useState(null)

  const load = () => {
    api.get('/tests' + (examId ? `?examId=${examId}` : '')).then((d) => setTests(d.tests)).catch(() => {})
  }
  useEffect(() => { api.get('/exams').then((d) => setExams(d.exams)) }, [])
  useEffect(() => { load() }, [examId])
  useEffect(() => { api.get('/ai/provider-status').then(setProvider).catch(() => {}) }, [])

  const startTest = async (id) => {
    try {
      await api.post('/attempts', { testId: id })
      nav(`/tests/${id}/session`)
    } catch (e) { toast(e.message, 'err') }
  }

  const generateAI = async () => {
    if (!aiCfg.examId) { toast('Select an exam', 'err'); return }
    if (!provider?.deepseekConfigured && !provider?.geminiConfigured && !provider?.openrouterConfigured) {
      toast('No AI provider key configured. Ask the admin to set up DeepSeek/Gemini/OpenRouter.', 'err')
      return
    }
    setBusy(true)
    try {
      const d = await api.post('/tests/ai', { examId: Number(aiCfg.examId), config: { ...aiCfg, kind: 'full' }, title: `${exams.find((e) => e.id === Number(aiCfg.examId))?.name} AI Full Mock` })
      toast(`AI mock created with ${d.questionCount} fresh questions`, 'ok')
      setAiModal(false)
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <StudentLayout title="Mock Tests">
      <div className="card mb spread">
        <div>
          <b>Practice papers & mocks</b>
          <p className="tiny">Predefined papers and full-length AI-generated mocks. Pick one and start — the timer engine will guide your pace.</p>
        </div>
        <div className="row">
          <select className="select" style={{ width: 200 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
            <option value="">All exams</option>
            {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button className="btn btn-accent" onClick={() => setAiModal(true)}>✨ Generate AI Full Mock</button>
        </div>
      </div>

      {tests.length === 0 && <Empty title="No tests yet" text="Generate an AI mock test or ask your admin to create tests." />}
      <div className="grid grid-3">
        {tests.map((t) => (
          <div key={t.id} className="card hover">
            <div className="spread mb">
              <Badge kind="purple">{KIND_LABEL[t.kind] || t.kind}</Badge>
              <span className="tiny">{fmtDate(t.created_at)}</span>
            </div>
            <b style={{ fontSize: 16 }}>{t.title}</b>
            <p className="tiny" style={{ marginTop: 4 }}>{t.description}</p>
            <div className="row mt">
              <span className="chip">{t.question_count} questions</span>
              <span className="chip">{t.exam_name}</span>
            </div>
            <div className="row mt">
              <button className="btn btn-primary btn-sm" style={{ flex: 1 }} onClick={() => startTest(t.id)}>Start Test</button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={aiModal} onClose={() => setAiModal(false)} title="✨ Generate AI Full Mock Test"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setAiModal(false)}>Cancel</button>
          <button className="btn btn-accent" onClick={generateAI} disabled={busy}>{busy ? 'Generating (this can take a minute)…' : 'Generate Questions'}</button>
        </>}>
        <div className="col">
          <p className="tiny">{provider?.provider === 'openrouter' ? 'Using OpenRouter' : provider?.provider === 'gemini' ? 'Using Gemini' : 'Using DeepSeek'} as primary AI · {provider?.fallbackEnabled ? 'fallback enabled' : 'fallback off'}</p>
          <label className="field"><span>Exam</span>
            <select className="select" value={aiCfg.examId} onChange={(e) => setAiCfg({ ...aiCfg, examId: e.target.value })}>
              <option value="">Select exam…</option>
              {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <div className="field-row">
            <label className="field"><span>Questions (max 50)</span>
              <input className="input" type="number" min="1" max="50" value={aiCfg.count} onChange={(e) => setAiCfg({ ...aiCfg, count: e.target.value })} />
            </label>
            <label className="field"><span>Duration (min)</span>
              <input className="input" type="number" value={aiCfg.duration} onChange={(e) => setAiCfg({ ...aiCfg, duration: e.target.value })} />
            </label>
          </div>
          <label className="field"><span>Subject filter (optional)</span>
            <input className="input" value={aiCfg.subject} onChange={(e) => setAiCfg({ ...aiCfg, subject: e.target.value })} placeholder="e.g. Physics" />
          </label>
          <label className="field"><span>Chapter / Topic (optional)</span>
            <input className="input" value={aiCfg.chapter} onChange={(e) => setAiCfg({ ...aiCfg, chapter: e.target.value })} placeholder="e.g. Mechanics / Laws of Motion" />
          </label>
          <p className="tiny">DeepSeek writes fresh exam-quality questions. Gemini is the automatic fallback.</p>
        </div>
      </Modal>
    </StudentLayout>
  )
}
