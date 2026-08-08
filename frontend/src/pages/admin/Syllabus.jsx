import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { useToast } from '../../components/ui.jsx'

export default function AdminSyllabus() {
  const toast = useToast()
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [syllabus, setSyllabus] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => { api.get('/exams').then((d) => { setExams(d.exams); if (d.exams.length) setExamId(String(d.exams[0].id)) }) }, [])
  useEffect(() => { if (examId) api.get(`/exams/${examId}/syllabus`).then((d) => setSyllabus(d.syllabus)).catch(() => {}) }, [examId])

  const save = async () => {
    setBusy(true)
    try {
      await api.post(`/exams/${examId}/syllabus`, { subjects: syllabus })
      toast('Syllabus saved', 'ok')
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const addSubject = () => setSyllabus((s) => [...s, { name: '', chapters: [] }])
  const addChapter = (si) => setSyllabus((s) => { const next = [...s]; next[si].chapters.push({ name: '', topics: [] }); return next })
  const addTopic = (si, ci) => setSyllabus((s) => { const next = [...s]; next[si].chapters[ci].topics.push(''); return next })

  const setSub = (si, name) => setSyllabus((s) => { const n = [...s]; n[si] = { ...n[si], name }; return n })
  const setChap = (si, ci, name) => setSyllabus((s) => { const n = [...s]; n[si].chapters[ci] = { ...n[si].chapters[ci], name }; return n })
  const setTop = (si, ci, ti, v) => setSyllabus((s) => { const n = [...s]; n[si].chapters[ci].topics[ti] = v; return n })

  const delSub = (si) => setSyllabus((s) => s.filter((_, i) => i !== si))
  const delChap = (si, ci) => setSyllabus((s) => { const n = [...s]; n[si].chapters = n[si].chapters.filter((_, i) => i !== ci); return n })
  const delTop = (si, ci, ti) => setSyllabus((s) => { const n = [...s]; n[si].chapters[ci].topics = n[si].chapters[ci].topics.filter((_, i) => i !== ti); return n })

  return (
    <AdminLayout title="Syllabus Management">
      <div className="spread mb">
        <select className="select" style={{ width: 260 }} value={examId} onChange={(e) => setExamId(e.target.value)}>
          {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <button className="btn btn-primary" onClick={save} disabled={busy || !examId}>{busy ? 'Saving…' : 'Save syllabus'}</button>
      </div>
      <p className="tiny muted mb">Syllabus drives chapter-wise & topic-wise tests and weak-topic analytics. Question counts update automatically.</p>

      <div className="col">
        {syllabus.map((s, si) => (
          <div key={si} className="card">
            <div className="row">
              <input className="input" style={{ maxWidth: 300, fontWeight: 700 }} value={s.name} onChange={(e) => setSub(si, e.target.value)} placeholder="Subject name" />
              <button className="btn btn-sm btn-ghost" onClick={() => addChapter(si)}>+ Chapter</button>
              <button className="btn btn-sm btn-danger" onClick={() => delSub(si)}>Remove subject</button>
            </div>
            {s.chapters.map((c, ci) => (
              <div key={ci} className="mt" style={{ paddingLeft: 18, borderLeft: '2px solid var(--border)' }}>
                <div className="row">
                  <input className="input" style={{ maxWidth: 260 }} value={c.name} onChange={(e) => setChap(si, ci, e.target.value)} placeholder="Chapter name" />
                  <button className="btn btn-sm btn-ghost" onClick={() => addTopic(si, ci)}>+ Topic</button>
                  <button className="btn btn-sm btn-danger" onClick={() => delChap(si, ci)}>×</button>
                </div>
                <div className="row mt" style={{ gap: 6 }}>
                  {c.topics.map((t, ti) => (
                    <span key={ti} className="row" style={{ gap: 4 }}>
                      <input className="input" style={{ width: 180, padding: '5px 9px', fontSize: 13 }} value={t} onChange={(e) => setTop(si, ci, ti, e.target.value)} placeholder="topic" />
                      <button className="btn btn-sm btn-danger" onClick={() => delTop(si, ci, ti)}>×</button>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
      <button className="btn btn-ghost mt" onClick={addSubject}>+ Add subject</button>
    </AdminLayout>
  )
}
