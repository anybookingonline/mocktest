import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast } from '../../components/ui.jsx'

const MODES = [
  { key: 'chapter', label: 'Chapter-wise', icon: '📖', desc: 'Build a test from selected chapters' },
  { key: 'topic', label: 'Topic-wise', icon: '🎯', desc: 'Target specific weak topics' },
  { key: 'speed', label: 'Speed Test', icon: '⚡', desc: '30 rapid questions, 10 minutes' },
  { key: 'revision', label: 'Revision Mode', icon: '🔁', desc: 'Easy questions to revise basics' },
  { key: 'custom', label: 'Custom Test', icon: '🛠️', desc: 'Full control over the paper' }
]

export default function Practice() {
  const [params] = useSearchParams()
  const nav = useNavigate()
  const toast = useToast()
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState(Number(params.get('exam')) || null)
  const [syllabus, setSyllabus] = useState([])
  const [selected, setSelected] = useState({}) // id -> type(subject/chapter/topic)
  const [mode, setMode] = useState('chapter')
  const [cfg, setCfg] = useState({ numQuestions: 20, duration: 30, difficulty: 'all', difficultyMix: { easy: 30, medium: 50, hard: 20 } })
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.get('/exams').then((d) => setExams(d.exams)) }, [])
  useEffect(() => {
    if (!examId) { setSyllabus([]); return }
    api.get(`/exams/${examId}/syllabus`).then((d) => setSyllabus(d.syllabus)).catch(() => {})
  }, [examId])

  const toggle = (id, type) => {
    setSelected((s) => {
      const next = { ...s }
      if (next[id]) delete next[id]
      else next[id] = type
      return next
    })
  }

  const chapterIds = Object.entries(selected).filter(([, t]) => t === 'chapter').map(([id]) => Number(id))
  const topicIds = Object.entries(selected).filter(([, t]) => t === 'topic').map(([id]) => Number(id))

  const buildConfig = () => {
    if (!examId) { toast('Select an exam first', 'err'); return null }
    const base = { examId, duration: Number(cfg.duration) }
    if (mode === 'chapter') {
      if (!chapterIds.length) { toast('Select at least one chapter', 'err'); return null }
      return { ...base, chapterIds, numQuestions: Number(cfg.numQuestions) }
    }
    if (mode === 'topic') {
      if (!topicIds.length) { toast('Select at least one topic', 'err'); return null }
      return { ...base, topicIds, numQuestions: Number(cfg.numQuestions) }
    }
    if (mode === 'speed') return { ...base, numQuestions: 30, duration: 10, difficultyMix: { easy: 60, medium: 40, hard: 0 } }
    if (mode === 'revision') return { ...base, numQuestions: Number(cfg.numQuestions), difficulty: 'easy' }
    return { ...base, numQuestions: Number(cfg.numQuestions), difficultyMix: cfg.difficultyMix }
  }

  const start = async () => {
    const config = buildConfig()
    if (!config) return
    setBusy(true)
    try {
      const title = `${exams.find((e) => e.id === examId)?.name || ''} ${MODES.find((m) => m.key === mode)?.label}`
      const d = await api.post('/tests', { examId, title, kind: mode, config })
      toast(`Test created with ${d.questionCount} questions`, 'ok')
      nav(`/tests/${d.testId}/session`)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const selectedCount = chapterIds.length + topicIds.length

  return (
    <StudentLayout title="Practice — Build Your Test">
      <div className="card mb">
        <b className="small mb" style={{ display: 'block' }}>1 · Pick your exam</b>
        <div className="grid grid-4">
          {exams.map((e) => (
            <div key={e.id} className={`card hover ${examId === e.id ? 'selected' : ''}`}
              style={{ padding: 12, textAlign: 'center', cursor: 'pointer', ...(examId === e.id ? { borderColor: 'var(--accent)', background: 'rgba(99,102,241,0.12)' } : {}) }}
              onClick={() => { setExamId(e.id); setSelected({}) }}>
              <div style={{ fontSize: 24 }}>{e.icon || '🎯'}</div>
              <b className="small">{e.name}</b>
            </div>
          ))}
        </div>
      </div>

      <div className="card mb">
        <b className="small mb" style={{ display: 'block' }}>2 · Choose mode</b>
        <div className="grid grid-4">
          {MODES.map((m) => (
            <div key={m.key} className="card hover" style={{ padding: 14, cursor: 'pointer', ...(mode === m.key ? { borderColor: 'var(--accent)', background: 'rgba(99,102,241,0.12)' } : {}) }} onClick={() => setMode(m.key)}>
              <div style={{ fontSize: 22 }}>{m.icon}</div>
              <b className="small">{m.label}</b>
              <p className="tiny" style={{ marginTop: 4 }}>{m.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {examId && (
        <div className="card mb">
          <div className="spread mb">
            <b className="small">3 · Select chapters / topics {selectedCount > 0 && <Badge kind="blue">{selectedCount} selected</Badge>}</b>
            {selectedCount > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setSelected({})}>Clear</button>}
          </div>
          {syllabus.length === 0 && <p className="tiny">No syllabus found for this exam yet.</p>}
          <div className="col">
            {syllabus.map((s) => (
              <div key={s.id} className="card muted-bg" style={{ padding: 14 }}>
                <div className="row">
                  <button className="btn btn-sm btn-ghost" onClick={() => s.chapters.forEach((c) => toggle(c.id, 'chapter'))}>
                    {s.chapters.every((c) => chapterIds.includes(c.id)) ? 'Unselect' : 'Select all'}
                  </button>
                  <b>{s.name}</b>
                  <span className="tiny">{s.questionCount} questions</span>
                </div>
                {s.chapters.map((c) => (
                  <div key={c.id} className="mt" style={{ paddingLeft: 10 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
                        <input type="checkbox" checked={!!selected[c.id]} onChange={() => toggle(c.id, 'chapter')} />
                        <b className="small">{c.name}</b>
                        <span className="tiny">{c.questionCount} Q</span>
                      </label>
                    </div>
                    <div className="row" style={{ gap: 6, margin: '6px 0 0 24px' }}>
                      {c.topics.map((t) => (
                        <span key={t.id} className={`chip ${selected[t.id] ? 'active' : ''}`}
                          style={{ cursor: 'pointer', ...(selected[t.id] ? { borderColor: 'var(--accent)', color: 'var(--text)', background: 'rgba(99,102,241,0.18)' } : {}) }}
                          onClick={() => toggle(t.id, 'topic')}>
                          {t.name} {t.questionCount > 0 ? `· ${t.questionCount}` : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card mb">
        <b className="small mb" style={{ display: 'block' }}>4 · Configure</b>
        <div className="field-row">
          <label className="field"><span>Number of questions</span>
            <input className="input" type="number" min="1" max="200" value={cfg.numQuestions} onChange={(e) => setCfg({ ...cfg, numQuestions: e.target.value })} />
          </label>
          <label className="field"><span>Duration (minutes)</span>
            <input className="input" type="number" min="1" value={cfg.duration} onChange={(e) => setCfg({ ...cfg, duration: e.target.value })} />
          </label>
          {mode === 'custom' && (
            <label className="field"><span>Difficulty mix (E:M:H %)</span>
              <div className="row">
                <input className="input" type="number" value={cfg.difficultyMix.easy} onChange={(e) => setCfg({ ...cfg, difficultyMix: { ...cfg.difficultyMix, easy: e.target.value } })} style={{ width: 70 }} />
                <input className="input" type="number" value={cfg.difficultyMix.medium} onChange={(e) => setCfg({ ...cfg, difficultyMix: { ...cfg.difficultyMix, medium: e.target.value } })} style={{ width: 70 }} />
                <input className="input" type="number" value={cfg.difficultyMix.hard} onChange={(e) => setCfg({ ...cfg, difficultyMix: { ...cfg.difficultyMix, hard: e.target.value } })} style={{ width: 70 }} />
              </div>
            </label>
          )}
        </div>
        <button className="btn btn-primary" onClick={start} disabled={busy}>
          {busy ? 'Building test…' : `Start ${MODES.find((m) => m.key === mode)?.label}`}
        </button>
      </div>
    </StudentLayout>
  )
}
