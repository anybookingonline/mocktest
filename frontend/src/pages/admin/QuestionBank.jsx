import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Modal, useToast, diffBadge, fmtDate, qTypeLabel } from '../../components/ui.jsx'

export default function AdminQuestions() {
  const toast = useToast()
  const [exams, setExams] = useState([])
  const [filters, setFilters] = useState({ examId: '', source: '', difficulty: '', q: '' })
  const [data, setData] = useState(null)
  const [view, setView] = useState(null)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState(null)
  const [page, setPage] = useState(0)

  useEffect(() => { api.get('/exams').then((d) => setExams(d.exams)) }, [])

  const load = () => {
    const p = new URLSearchParams({ limit: 30, offset: page * 30 })
    if (filters.examId) p.set('examId', filters.examId)
    if (filters.source) p.set('source', filters.source)
    if (filters.difficulty) p.set('difficulty', filters.difficulty)
    if (filters.q) p.set('q', filters.q)
    api.get(`/questions?${p}`).then(setData).catch(() => {})
  }
  useEffect(load, [filters, page])

  const blank = () => ({
    examId: filters.examId || '', subjectId: '', chapterId: '', topicId: '',
    qtype: 'single', question: '', options: ['', '', '', ''], correct_answer: '', explanation: '',
    difficulty: 'medium', marks: 4, negative_marks: 1, estimated_time: 90, year: '', shift: '', tags: []
  })

  const openCreate = () => { setForm(blank()); setModal(true) }
  const openEdit = (q) => {
    setForm({ ...q, examId: q.exam_id, subjectId: q.subject_id, chapterId: q.chapter_id, topicId: q.topic_id, question: q.question_text, options: q.options, tags: q.tags, year: q.year || '', shift: q.shift || '' })
    setModal(true)
  }

  const save = async () => {
    if (!form.question) { toast('Question text required', 'err'); return }
    try {
      if (form.id) await api.put(`/questions/${form.id}`, form)
      else await api.post('/questions', form)
      toast('Question saved', 'ok'); setModal(false); load()
    } catch (e) { toast(e.message, 'err') }
  }

  const remove = async (id) => {
    if (!confirm('Delete this question?')) return
    try { await api.del(`/questions/${id}`); toast('Deleted'); load() } catch (e) { toast(e.message, 'err') }
  }

  return (
    <AdminLayout title="Question Bank">
      <div className="card mb">
        <div className="row">
          <select className="select" style={{ width: 190 }} value={filters.examId} onChange={(e) => { setFilters({ ...filters, examId: e.target.value }); setPage(0) }}>
            <option value="">All exams</option>
            {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <select className="select" style={{ width: 140 }} value={filters.source} onChange={(e) => { setFilters({ ...filters, source: e.target.value }); setPage(0) }}>
            <option value="">All sources</option>
            <option value="ai">AI generated</option>
            <option value="pdf">PDF / PYQ</option>
            <option value="manual">Manual</option>
          </select>
          <select className="select" style={{ width: 140 }} value={filters.difficulty} onChange={(e) => { setFilters({ ...filters, difficulty: e.target.value }); setPage(0) }}>
            <option value="">All difficulty</option>
            <option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option>
          </select>
          <input className="input" style={{ flex: 1, minWidth: 180 }} placeholder="Search question text, tags…" value={filters.q} onChange={(e) => { setFilters({ ...filters, q: e.target.value }); setPage(0) }} />
          <button className="btn btn-primary" onClick={openCreate}>+ Add Question</button>
        </div>
        {data && <p className="tiny mt">{data.total} questions · page {page + 1}</p>}
      </div>

      <div className="col">
        {data?.questions?.map((q) => (
          <div key={q.id} className="card" style={{ cursor: 'pointer' }} onClick={() => setView(q)}>
            <div className="spread mb">
              <div className="row">
                <Badge kind="blue">#{q.id}</Badge>
                <Badge kind={diffBadge(q.difficulty)}>{q.difficulty}</Badge>
                <Badge kind={q.source === 'pdf' ? 'green' : q.source === 'ai' ? 'purple' : 'gray'}>{q.source === 'pdf' ? '📄 PYQ' : q.source === 'ai' ? '🤖 AI' : 'Manual'}</Badge>
                <Badge kind="gray">{qTypeLabel(q.qtype)}</Badge>
                {q.year && <Badge kind="amber">{q.year}</Badge>}
              </div>
              <span className="tiny">{fmtDate(q.created_at)} · used {q.usage_count}×</span>
            </div>
            <div className="qtext small">{q.question_text}</div>
            <div className="row mt">
              <span className="chip">Ans: {q.correct_answer}</span>
              <span className="chip">{q.marks} marks / -{q.negative_marks}</span>
              {q.tags?.map((t) => <span key={t} className="chip">#{t}</span>)}
            </div>
          </div>
        ))}
      </div>
      {data && data.total > 30 && (
        <div className="row mt">
          <button className="btn btn-sm btn-ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>← Prev</button>
          <span className="tiny">page {page + 1} of {Math.ceil(data.total / 30)}</span>
          <button className="btn btn-sm btn-ghost" disabled={(page + 1) * 30 >= data.total} onClick={() => setPage(page + 1)}>Next →</button>
        </div>
      )}

      {view && (
        <Modal open onClose={() => setView(null)} title={`Question #${view.id}`}
          footer={<>
            <button className="btn btn-sm btn-danger" onClick={() => { remove(view.id); setView(null) }}>Delete</button>
            <button className="btn btn-sm btn-ghost" onClick={() => { openEdit(view); setView(null) }}>Edit</button>
          </>}>
          <div className="qtext">{view.question_text}</div>
          {view.options?.length > 0 && <div className="mt">{view.options.map((o) => {
            const key = o.split('.')[0]?.trim()
            return <div key={o} className={`option ${String(view.correct_answer).trim().toLowerCase() === String(key).toLowerCase() ? 'correct' : ''}`}><span className="key">{key}</span>{o.slice(o.indexOf('.') + 1).trim() || o}</div>
          })}</div>}
          {view.explanation && <div className="solution mt"><b>Explanation:</b><p className="small mt" style={{ whiteSpace: 'pre-wrap' }}>{view.explanation}</p></div>}
        </Modal>
      )}

      {modal && form && (
        <Modal open onClose={() => setModal(false)} title={form.id ? 'Edit question' : 'Add question'}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
            <button className="btn btn-primary" onClick={save}>Save question</button>
          </>}>
          <div className="col">
            <div className="field-row">
              <label className="field"><span>Exam</span>
                <select className="select" value={form.examId} onChange={(e) => setForm({ ...form, examId: e.target.value })}>
                  <option value="">Select…</option>{exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </label>
              <label className="field"><span>Type</span>
                <select className="select" value={form.qtype} onChange={(e) => setForm({ ...form, qtype: e.target.value })}>
                  {['single', 'multiple', 'numerical', 'integer'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
              <label className="field"><span>Difficulty</span>
                <select className="select" value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                  {['easy', 'medium', 'hard'].map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </label>
            </div>
            <label className="field"><span>Question text</span><textarea className="input" rows="3" value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} /></label>
            <label className="field"><span>Options (A./B./C./D.)</span>
              {form.options.map((o, i) => <input key={i} className="input mb" value={o} onChange={(e) => setForm({ ...form, options: form.options.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`Option ${String.fromCharCode(65 + i)}`} />)}
            </label>
            <div className="field-row">
              <label className="field"><span>Correct answer (letter/number)</span><input className="input" value={form.correct_answer} onChange={(e) => setForm({ ...form, correct_answer: e.target.value })} /></label>
              <label className="field"><span>Marks</span><input className="input" type="number" value={form.marks} onChange={(e) => setForm({ ...form, marks: e.target.value })} /></label>
              <label className="field"><span>Negative marks</span><input className="input" type="number" step="0.25" value={form.negative_marks} onChange={(e) => setForm({ ...form, negative_marks: e.target.value })} /></label>
              <label className="field"><span>Est. time (sec)</span><input className="input" type="number" value={form.estimated_time} onChange={(e) => setForm({ ...form, estimated_time: e.target.value })} /></label>
            </div>
            <div className="field-row">
              <label className="field"><span>Year</span><input className="input" value={form.year} onChange={(e) => setForm({ ...form, year: e.target.value })} /></label>
              <label className="field"><span>Shift</span><input className="input" value={form.shift} onChange={(e) => setForm({ ...form, shift: e.target.value })} /></label>
            </div>
            <label className="field"><span>Explanation</span><textarea className="input" rows="3" value={form.explanation} onChange={(e) => setForm({ ...form, explanation: e.target.value })} /></label>
          </div>
        </Modal>
      )}
    </AdminLayout>
  )
}
