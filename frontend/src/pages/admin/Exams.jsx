import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Modal, useToast, fmtDate } from '../../components/ui.jsx'

const BLANK = { code: '', name: '', description: '', icon: '🎯', duration_minutes: 180, total_questions: 100, marks_per_question: 4, negative_marks: 1, subjects: [] }

export default function AdminExams() {
  const toast = useToast()
  const [exams, setExams] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(BLANK)
  const [saving, setSaving] = useState(false)

  const load = () => { api.get('/exams').then((d) => setExams(d.exams)).catch(() => {}) }
  useEffect(load, [])

  const open = (exam) => {
    if (exam) {
      let subjects = []
      try { subjects = JSON.parse(exam.subjects_json || '[]').map((s) => (typeof s === 'string' ? { name: s, chapters: [] } : s)) } catch { subjects = [] }
      setForm({ ...exam, subjects })
    } else setForm(BLANK)
    setModal(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      if (form.id) await api.put(`/exams/${form.id}`, form)
      else await api.post('/exams', form)
      toast('Exam saved', 'ok')
      setModal(false)
      load()
    } catch (e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  const remove = async (id) => {
    if (!confirm('Delete this exam and all its questions? This cannot be undone.')) return
    try { await api.del(`/exams/${id}`); toast('Deleted'); load() } catch (e) { toast(e.message, 'err') }
  }

  const updateSubject = (i, name) => {
    setForm((f) => {
      const subjects = [...f.subjects]
      subjects[i] = { ...subjects[i], name }
      return { ...f, subjects }
    })
  }

  return (
    <AdminLayout title="Exam Management">
      <div className="spread mb">
        <p className="small muted">Exams drive the entire platform — question bank, mock tests, and rankings are grouped by exam.</p>
        <button className="btn btn-primary" onClick={() => open(null)}>+ New Exam</button>
      </div>
      <div className="grid grid-3">
        {exams.map((e) => (
          <div key={e.id} className="card hover">
            <div className="spread mb">
              <div style={{ fontSize: 26 }}>{e.icon || '🎯'}</div>
              <div className="row"><Badge kind={e.is_active ? 'green' : 'gray'}>{e.is_active ? 'Active' : 'Inactive'}</Badge></div>
            </div>
            <b>{e.name}</b>
            <div className="tiny" style={{ margin: '4px 0 8px' }}>{e.code} · created {fmtDate(e.created_at)}</div>
            <p className="tiny muted">{e.description}</p>
            <div className="row mt">
              <span className="chip">{e.total_questions} Q</span>
              <span className="chip">{e.duration_minutes} min</span>
              <span className="chip">+{e.marks_per_question} / -{e.negative_marks}</span>
            </div>
            <div className="row mt">
              <button className="btn btn-sm btn-ghost" style={{ flex: 1 }} onClick={() => open(e)}>Edit</button>
              <button className="btn btn-sm btn-danger" onClick={() => remove(e.id)}>Delete</button>
            </div>
          </div>
        ))}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit exam' : 'New exam'}
        footer={<>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save exam'}</button>
        </>}>
        <div className="col">
          <div className="field-row">
            <label className="field"><span>Code (unique)</span><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="JEE-MAIN" /></label>
            <label className="field"><span>Icon</span><input className="input" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} /></label>
          </div>
          <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Description</span><textarea className="input" rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
          <div className="field-row">
            <label className="field"><span>Duration (minutes)</span><input className="input" type="number" value={form.duration_minutes} onChange={(e) => setForm({ ...form, duration_minutes: e.target.value })} /></label>
            <label className="field"><span>Total questions</span><input className="input" type="number" value={form.total_questions} onChange={(e) => setForm({ ...form, total_questions: e.target.value })} /></label>
            <label className="field"><span>Marks / question</span><input className="input" type="number" step="0.5" value={form.marks_per_question} onChange={(e) => setForm({ ...form, marks_per_question: e.target.value })} /></label>
            <label className="field"><span>Negative marks</span><input className="input" type="number" step="0.25" value={form.negative_marks} onChange={(e) => setForm({ ...form, negative_marks: e.target.value })} /></label>
          </div>
          <b className="small">Subjects (names only — add chapters in the Syllabus tab)</b>
          {form.subjects.map((s, i) => (
            <div key={i} className="row">
              <input className="input" value={s.name} onChange={(e) => updateSubject(i, e.target.value)} style={{ flex: 1 }} />
              <button className="btn btn-sm btn-danger" onClick={() => setForm((f) => ({ ...f, subjects: f.subjects.filter((_, j) => j !== i) }))}>×</button>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={() => setForm((f) => ({ ...f, subjects: [...f.subjects, { name: '', chapters: [] }] }))}>+ Add subject</button>
        </div>
      </Modal>
    </AdminLayout>
  )
}
