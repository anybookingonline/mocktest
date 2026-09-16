import React, { useEffect, useRef, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Modal, useToast, fmtDate } from '../../components/ui.jsx'

// Institute sub-admin dashboard — the white-label control room. Everything is
// hard-scoped server-side to the logged-in admin's institute.
export default function InstituteDashboard() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [students, setStudents] = useState([])
  const [invites, setInvites] = useState([])
  const [branding, setBranding] = useState({ platform_name: '', tagline: '', primary_color: '', accent_color: '' })
  const [csvModal, setCsvModal] = useState(false)
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)
  // School self-serve PDF import (monthly quota-gated, server enforces)
  const [pdf, setPdf] = useState(null) // { imports, quota, usedThisMonth }
  const [pdfExams, setPdfExams] = useState([])
  const [pdfExamId, setPdfExamId] = useState('')
  const [pdfFile, setPdfFile] = useState(null)
  const [pdfBusy, setPdfBusy] = useState(false)
  const pdfFileRef = useRef(null)
  // Phase 3: extracted-questions review queue
  const [review, setReview] = useState(null) // { import, questions }
  const [reviewBusy, setReviewBusy] = useState(false)

  const load = () => {
    api.get('/institutes/me').then((d) => {
      setData(d)
      const inst = d.institute
      setBranding({
        platform_name: inst.platform_name || inst.name || '',
        tagline: inst.tagline || '',
        primary_color: inst.primary_color || '',
        accent_color: inst.accent_color || ''
      })
    }).catch((e) => toast(e.message, 'err'))
    api.get('/institutes/me/students').then((d) => setStudents(d.students || [])).catch(() => {})
    api.get('/institutes/me/invites').then((d) => setInvites(d.invites || [])).catch(() => {})
    api.get('/institutes/me/pdf-imports').then(setPdf).catch(() => {})
  }
  useEffect(() => {
    load()
    api.get('/exams').then((d) => setPdfExams(d.exams || [])).catch(() => {})
  }, [])
  // Poll import status while anything is queued/processing
  useEffect(() => {
    if (!pdf?.imports?.some((i) => i.status === 'processing' || i.status === 'queued')) return
    const t = setInterval(() => api.get('/institutes/me/pdf-imports').then(setPdf).catch(() => {}), 6000)
    return () => clearInterval(t)
  }, [pdf])

  const newInvite = async () => {
    setBusy(true)
    try {
      const d = await api.post('/institutes/me/invites', { label: 'Student batch' })
      toast(`Invite code: ${d.code} — students ko ye code register karte waqt dena`, 'ok')
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const saveBranding = async () => {
    setBusy(true)
    try {
      await api.put('/institutes/me/branding', branding)
      toast('Branding saved — students ko aapke naam/colors se dikhega', 'ok')
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const uploadPdf = async () => {
    if (!pdfFile) return toast('Choose a PDF file', 'err')
    if (!pdfExamId) return toast('Select the exam/class this paper belongs to', 'err')
    setPdfBusy(true)
    try {
      const d = await api.upload('/institutes/me/pdf-import', pdfFile, { examId: pdfExamId })
      toast(d.reused ? (d.message || 'Paper already imported') : (d.message || 'Upload accepted — processing'), 'ok')
      setPdfFile(null)
      if (pdfFileRef.current) pdfFileRef.current.value = ''
      api.get('/institutes/me/pdf-imports').then(setPdf).catch(() => {})
    } catch (e) { toast(e.message, 'err') } finally { setPdfBusy(false) }
  }

  // Review queue actions: approve/reject selected (or all pending) staged questions
  const doReview = async (importId, action, ids = []) => {
    setReviewBusy(true)
    try {
      const d = await api.post(`/institutes/me/pdf-imports/${importId}/review`, { action, ids })
      toast(d.message || 'Done', 'ok')
      const fresh = await api.get(`/institutes/me/pdf-imports/${importId}/questions`)
      setReview(fresh)
      api.get('/institutes/me/pdf-imports').then(setPdf).catch(() => {})
    } catch (e) { toast(e.message, 'err') } finally { setReviewBusy(false) }
  }

  const openReview = async (importId) => {
    try {
      const d = await api.get(`/institutes/me/pdf-imports/${importId}/questions`)
      setReview(d)
    } catch (e) { toast(e.message, 'err') }
  }

  const uploadCsv = async () => {
    if (!csv.trim()) return
    setBusy(true)
    try {
      const d = await api.post('/institutes/me/students/bulk', { csv })
      toast(`${d.created} students created${d.skipped?.length ? `, ${d.skipped.length} skipped` : ''}`, 'ok')
      setCsvModal(false); setCsv(''); load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  if (!data) return <AdminLayout title="Institute"><div className="spin" /></AdminLayout>
  const inst = data.institute
  const stats = data.stats

  return (
    <AdminLayout title={`🏫 ${inst.platform_name || inst.name}`}>
      <div className="grid grid-4 mb">
        <div className="stat card"><span className="label">Students</span><span className="value">{stats.students}</span><span className="sub">{stats.activeLast7} active last 7d</span></div>
        <div className="stat card"><span className="label">Tests completed</span><span className="value">{stats.testsCompleted}</span></div>
        <div className="stat card"><span className="label">Avg accuracy</span><span className="value">{stats.avgAccuracy}%</span></div>
        <div className="stat card"><span className="label">Plan</span><span className="value" style={{ fontSize: 18 }}>{inst.plan}</span><span className="sub">till {fmtDate(inst.plan_until)}</span></div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <b className="mb" style={{ display: 'block' }}>🎨 Aapka Branding (white-label)</b>
          <p className="tiny muted mb">Ye naam aur colors students ko app me dikhte hain.</p>
          <label className="field"><span>App name</span><input className="input" value={branding.platform_name} onChange={(e) => setBranding({ ...branding, platform_name: e.target.value })} /></label>
          <label className="field"><span>Tagline</span><input className="input" value={branding.tagline} onChange={(e) => setBranding({ ...branding, tagline: e.target.value })} placeholder="Sunrise ke saath selection pakka" /></label>
          <div className="field-row">
            <label className="field"><span>Primary color</span><input className="input" type="color" value={branding.primary_color || '#6366f1'} onChange={(e) => setBranding({ ...branding, primary_color: e.target.value })} /></label>
            <label className="field"><span>Accent color</span><input className="input" type="color" value={branding.accent_color || '#22d3ee'} onChange={(e) => setBranding({ ...branding, accent_color: e.target.value })} /></label>
          </div>
          <button className="btn btn-primary btn-sm" onClick={saveBranding} disabled={busy}>Save branding</button>
        </div>

        <div className="card">
          <div className="spread mb">
            <b>🎫 Invite codes</b>
            <button className="btn btn-ghost btn-sm" onClick={newInvite} disabled={busy}>+ New code</button>
          </div>
          <p className="tiny muted mb">Students register karte waqt ye code daalte hain — automatically aapke institute me add ho jate hain.</p>
          {!invites.length && <p className="tiny muted">Pehla code banao.</p>}
          {invites.map((v) => (
            <div key={v.id} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
              <b>{v.code}</b>
              <span className="row">
                <span className="chip">used: {v.used_count}{v.max_uses ? `/${v.max_uses}` : ''}</span>
                <Badge kind={v.is_active ? 'green' : 'gray'}>{v.is_active ? 'active' : 'paused'}</Badge>
              </span>
            </div>
          ))}
          <hr className="divider" />
          <div className="spread">
            <b className="small">Bulk CSV import</b>
            <button className="btn btn-ghost btn-sm" onClick={() => setCsvModal(true)}>⬆ Import</button>
          </div>
        </div>
      </div>

      <div className="card mt">
        <div className="spread mb">
          <b>📄 Apne exam papers import karo (PDF → Question Bank)</b>
          {pdf && (
            <span className="chip">{pdf.quota ? `Monthly quota: ${pdf.usedThisMonth}/${pdf.quota} papers` : 'Upload disabled — platform admin se quota activate karwaye'}</span>
          )}
        </div>
        <p className="tiny muted mb">
          Apne Class/Subject ke unit tests, term papers ya coaching modules upload karo — AI (Gemini Vision)
          scanned/low-quality PDFs se bhi questions nikal leta hai aur practice/mock/battles sab me use hone lagte hain.
          Same paper dobara upload karne par quota nahi lagta (dedup).
        </p>
        {pdf?.quota ? (
          <div className="row mb" style={{ flexWrap: 'wrap', gap: 10 }}>
            <select className="select" style={{ maxWidth: 260 }} value={pdfExamId} onChange={(e) => setPdfExamId(e.target.value)}>
              <option value="">Exam/Class chuno…</option>
              {pdfExams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
            <input ref={pdfFileRef} type="file" accept="application/pdf" className="input" style={{ maxWidth: 280 }} onChange={(e) => setPdfFile(e.target.files?.[0] || null)} />
            <button className="btn btn-primary btn-sm" onClick={uploadPdf} disabled={pdfBusy}>{pdfBusy ? 'Uploading…' : '⬆ Import paper'}</button>
          </div>
        ) : null}
        {pdf?.imports?.length > 0 && (
          <table className="tbl">
            <thead><tr><th>File</th><th>Status</th><th>Questions</th><th>When</th><th></th></tr></thead>
            <tbody>
              {pdf.imports.map((im) => {
                const pending = pdf.pendingByImport?.[im.id] || 0
                return (
                  <tr key={im.id}>
                    <td className="small">{im.filename}</td>
                    <td>
                      <Badge kind={pending > 0 ? 'amber' : im.status === 'completed' ? 'green' : im.status === 'failed' ? 'red' : 'amber'}>
                        {pending > 0 ? `review (${pending})` : im.status}
                      </Badge>
                      {im.error ? <span className="tiny muted" style={{ marginLeft: 6 }}>{String(im.error).slice(0, 80)}</span> : null}
                    </td>
                    <td>{im.questions_created ?? 0}</td>
                    <td className="tiny">{fmtDate(im.created_at)}</td>
                    <td>
                      {pending > 0 && (
                        <button className="btn btn-ghost btn-sm" onClick={() => openReview(im.id)}>🔎 Review</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}

        {/* Phase 3: extracted-questions review queue */}
        {review && (
          <div className="card mt" style={{ background: 'var(--bg2)' }}>
            <div className="spread mb">
              <b>🔎 Review queue — {review.import?.filename}</b>
              <button className="btn btn-ghost btn-sm" onClick={() => setReview(null)}>✕ Close</button>
            </div>
            <p className="tiny muted mb">
              AI ne ye questions nikale hain. Check karo — galat/unreadable wale reject karo,
              sahi wale approve karke exam bank me publish karo. Sirf approved questions students ko dikhenge.
            </p>
            <div className="row mb" style={{ gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" disabled={reviewBusy}
                onClick={() => doReview(review.import.id, 'approve')}>
                ✅ Approve all (non-duplicate)
              </button>
              <button className="btn btn-ghost btn-sm" disabled={reviewBusy}
                onClick={() => doReview(review.import.id, 'reject')}>
                🗑 Reject all pending
              </button>
            </div>
            {review.questions?.length === 0 && <p className="tiny muted">Is import ke liye koi staged question nahi hai.</p>}
            {(review.questions || []).map((q) => (
              <div key={q.id} style={{ padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
                <div className="spread">
                  <span className="small" style={{ flex: 1 }}>
                    <b>Q{q.id}.</b> {String(q.question_text || '').slice(0, 180)}{String(q.question_text || '').length > 180 ? '…' : ''}
                  </span>
                  <span className="row" style={{ gap: 6 }}>
                    {q.duplicate ? <Badge kind="gray">duplicate</Badge> : null}
                    <Badge kind={q.status === 'approved' ? 'green' : q.status === 'rejected' ? 'red' : 'amber'}>{q.status}</Badge>
                    {q.status === 'pending' && (
                      <>
                        <button className="btn btn-ghost btn-sm" disabled={reviewBusy}
                          onClick={() => doReview(review.import.id, 'approve', [q.id])}>✓</button>
                        <button className="btn btn-ghost btn-sm" disabled={reviewBusy}
                          onClick={() => doReview(review.import.id, 'reject', [q.id])}>✕</button>
                      </>
                    )}
                  </span>
                </div>
                <div className="tiny muted" style={{ marginTop: 4 }}>
                  {q.subject ? `${q.subject}` : '—'}{q.chapter ? ` › ${q.chapter}` : ''}{q.topic ? ` › ${q.topic}` : ''}
                  {q.correct_answer ? ` · Ans: ${String(q.correct_answer).slice(0, 30)}` : ''}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card mt">
        <b className="mb" style={{ display: 'block' }}>👥 Students ({students.length})</b>
        {students.length === 0 && <p className="tiny muted">Invite code share karo ya CSV import karo.</p>}
        {students.length > 0 && (
          <table className="tbl">
            <thead><tr><th>Name</th><th>Email</th><th>Tests</th><th>Avg score</th><th>Accuracy</th><th>Joined</th></tr></thead>
            <tbody>
              {students.map((s) => (
                <tr key={s.id}><td>{s.name}</td><td className="tiny">{s.email}</td><td>{s.tests_taken}</td><td>{s.avg_score}</td><td>{s.avg_accuracy}%</td><td className="tiny">{fmtDate(s.created_at)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {stats.weakTopics?.length > 0 && (
        <div className="card mt">
          <b className="mb" style={{ display: 'block' }}>📉 Weak topics (institute-wide)</b>
          {stats.weakTopics.map((w, i) => (
            <div key={i} className="spread" style={{ padding: '6px 0' }}>
              <span className="small">{w.topic} <span className="tiny muted">({w.subject})</span></span>
              <Badge kind={w.accuracy < 40 ? 'red' : 'amber'}>{w.accuracy}%</Badge>
            </div>
          ))}
        </div>
      )}

      <Modal open={csvModal} onClose={() => setCsvModal(false)} title="⬆ Bulk CSV Import"
        footer={<><button className="btn btn-ghost" onClick={() => setCsvModal(false)}>Cancel</button><button className="btn btn-primary" onClick={uploadCsv} disabled={busy}>Import</button></>}>
        <p className="tiny muted mb">Ek line per student: <code>name,email,password</code></p>
        <textarea className="input" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} />
      </Modal>
    </AdminLayout>
  )
}
