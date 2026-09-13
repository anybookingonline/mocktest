import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Empty, Modal, useToast, fmtDate } from '../../components/ui.jsx'

// White-label B2B (platform admin view): institutes, sub-admins, invite
// codes, bulk CSV students, per-institute stats. Sub-admins get the same
// dashboard scoped to their institute at /admin/institute.
export default function AdminInstitutes() {
  const toast = useToast()
  const [institutes, setInstitutes] = useState([])
  const [selected, setSelected] = useState(null) // { institute, stats }
  const [students, setStudents] = useState([])
  const [invites, setInvites] = useState([])
  const [createModal, setCreateModal] = useState(false)
  const [subModal, setSubModal] = useState(false)
  const [csvModal, setCsvModal] = useState(false)
  const [form, setForm] = useState({ name: '', contactEmail: '', planDays: 30 })
  const [subForm, setSubForm] = useState({ name: '', email: '', password: '' })
  const [csv, setCsv] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/institutes/admin/institutes').then((d) => setInstitutes(d.institutes || [])).catch((e) => toast(e.message, 'err'))
  useEffect(() => { load() }, [])

  const open = async (inst) => {
    try {
      const [me, st, inv] = await Promise.all([
        api.get(`/institutes/admin/institutes/${inst.id}/stats`),
        api.get(`/institutes/admin/institutes/${inst.id}/students`),
        api.get(`/institutes/admin/institutes/${inst.id}/invites`)
      ])
      setSelected({ institute: { ...inst, ...me }, stats: me, })
      setStudents(st.students || [])
      setInvites(inv.invites || [])
    } catch (e) { toast(e.message, 'err') }
  }

  const create = async () => {
    if (!form.name.trim()) return toast('Institute name required', 'err')
    setBusy(true)
    try {
      const d = await api.post('/institutes/admin/institutes', form)
      toast(`Institute created — code ${d.code}`, 'ok')
      setCreateModal(false)
      setForm({ name: '', contactEmail: '', planDays: 30 })
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const addSubAdmin = async () => {
    if (!subForm.email || !subForm.password) return toast('Email + password required', 'err')
    setBusy(true)
    try {
      await api.post(`/institutes/admin/institutes/${selected.institute.id}/subadmin`, subForm)
      toast('Sub-admin created — credentials ko institute ko de dein', 'ok')
      setSubModal(false)
      setSubForm({ name: '', email: '', password: '' })
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const newInvite = async () => {
    setBusy(true)
    try {
      const d = await api.post(`/institutes/admin/institutes/${selected.institute.id}/invites`, { label: 'Student batch' })
      toast(`Invite code: ${d.code}`, 'ok')
      open(selected.institute)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const uploadCsv = async () => {
    if (!csv.trim()) return
    setBusy(true)
    try {
      const d = await api.post(`/institutes/me/students/bulk?instituteId=${selected.institute.id}`, { csv })
      toast(`${d.created} students created${d.skipped?.length ? `, ${d.skipped.length} skipped (already exist)` : ''}`, 'ok')
      setCsvModal(false)
      setCsv('')
      open(selected.institute)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <AdminLayout title="🏫 Institutes (White-label B2B)">
      <div className="card mb spread">
        <div>
          <b>Coaching & School white-label clients</b>
          <p className="tiny muted">Har institute ko apna branding, invite codes, sub-admin aur analytics milta hai. Sub-admin sirf apne students dekh/manage kar sakta hai.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreateModal(true)}>+ New Institute</button>
      </div>

      {!institutes.length && <Empty title="Koi institute nahi" text="Pehla white-label client add karo — 30-din trial ke saath." />}

      <div className="grid grid-3">
        {institutes.map((i) => (
          <div key={i.id} className={`card hover ${selected?.institute?.id === i.id ? 'active' : ''}`} onClick={() => open(i)} style={{ cursor: 'pointer' }}>
            <div className="spread mb">
              <b>{i.platform_name || i.name}</b>
              <Badge kind={i.status === 'active' ? 'green' : 'amber'}>{i.plan}</Badge>
            </div>
            <div className="tiny muted">{i.contact_email || '—'}</div>
            <div className="row mt">
              <span className="chip">{i.students} students</span>
              <span className="chip">{i.invites} invites</span>
              <span className="chip">till {fmtDate(i.plan_until)}</span>
            </div>
          </div>
        ))}
      </div>

      {selected && (
        <>
          <hr className="divider" />
          <h3 style={{ marginBottom: 12 }}>{selected.institute.platform_name || selected.institute.name}</h3>
          <div className="grid grid-4 mb">
            <div className="stat card"><span className="label">Students</span><span className="value">{selected.stats.students}</span></div>
            <div className="stat card"><span className="label">Active (7d)</span><span className="value">{selected.stats.activeLast7}</span></div>
            <div className="stat card"><span className="label">Tests completed</span><span className="value">{selected.stats.testsCompleted}</span></div>
            <div className="stat card"><span className="label">Avg accuracy</span><span className="value">{selected.stats.avgAccuracy}%</span></div>
          </div>

          <div className="card mb">
            <div className="spread mb">
              <b>Invite codes</b>
              <button className="btn btn-ghost btn-sm" onClick={newInvite} disabled={busy}>+ New invite code</button>
            </div>
            {!invites.length && <p className="tiny muted">Students register karte waqt ye code daalte hain — auto institute se link ho jate hain.</p>}
            {invites.map((v) => (
              <div key={v.id} className="spread" style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                <span><b>{v.code}</b> <span className="tiny muted">{v.label}</span></span>
                <span className="row">
                  <span className="chip">used: {v.used_count}{v.max_uses ? `/${v.max_uses}` : ''}</span>
                  <Badge kind={v.is_active ? 'green' : 'gray'}>{v.is_active ? 'active' : 'paused'}</Badge>
                  <button className="btn btn-ghost btn-sm" onClick={async () => { await api.post(`/institutes/me/invites/${v.id}/toggle?instituteId=${selected.institute.id}`, {}); open(selected.institute) }}>
                    {v.is_active ? 'Pause' : 'Resume'}
                  </button>
                </span>
              </div>
            ))}
          </div>

          <div className="card mb">
            <div className="spread mb">
              <b>Students ({students.length})</b>
              <div className="row">
                <button className="btn btn-ghost btn-sm" onClick={() => setCsvModal(true)}>⬆ Bulk CSV import</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setSubModal(true)}>+ Sub-admin</button>
              </div>
            </div>
            {students.length > 0 && (
              <table className="tbl">
                <thead><tr><th>Name</th><th>Email</th><th>Tests</th><th>Avg score</th><th>Accuracy</th><th>Joined</th></tr></thead>
                <tbody>
                  {students.slice(0, 20).map((s) => (
                    <tr key={s.id}><td>{s.name}</td><td className="tiny">{s.email}</td><td>{s.tests_taken}</td><td>{s.avg_score}</td><td>{s.avg_accuracy}%</td><td className="tiny">{fmtDate(s.created_at)}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {selected.stats.weakTopics?.length > 0 && (
            <div className="card mb">
              <b className="mb" style={{ display: 'block' }}>📉 Institute-wide weak topics (parents/report ke liye)</b>
              {selected.stats.weakTopics.map((w, i) => (
                <div key={i} className="spread" style={{ padding: '6px 0' }}>
                  <span className="small">{w.topic} <span className="tiny muted">({w.subject})</span></span>
                  <Badge kind={w.accuracy < 40 ? 'red' : 'amber'}>{w.accuracy}%</Badge>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      <Modal open={createModal} onClose={() => setCreateModal(false)} title="🏫 New Institute"
        footer={<><button className="btn btn-ghost" onClick={() => setCreateModal(false)}>Cancel</button><button className="btn btn-primary" onClick={create} disabled={busy}>Create</button></>}>
        <label className="field"><span>Institute name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sunrise Coaching Classes" /></label>
        <label className="field"><span>Contact email</span><input className="input" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="owner@sunrise.com" /></label>
        <label className="field"><span>Trial days</span><input type="number" className="input" value={form.planDays} onChange={(e) => setForm({ ...form, planDays: e.target.value })} /></label>
      </Modal>

      <Modal open={subModal} onClose={() => setSubModal(false)} title="👤 Institute Sub-Admin"
        footer={<><button className="btn btn-ghost" onClick={() => setSubModal(false)}>Cancel</button><button className="btn btn-primary" onClick={addSubAdmin} disabled={busy}>Create</button></>}>
        <p className="tiny muted mb">Sub-admin ko sirf is institute ke students dikhte hain — apna login milega.</p>
        <label className="field"><span>Name</span><input className="input" value={subForm.name} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} /></label>
        <label className="field"><span>Email</span><input className="input" value={subForm.email} onChange={(e) => setSubForm({ ...subForm, email: e.target.value })} /></label>
        <label className="field"><span>Password</span><input className="input" value={subForm.password} onChange={(e) => setSubForm({ ...subForm, password: e.target.value })} /></label>
      </Modal>

      <Modal open={csvModal} onClose={() => setCsvModal(false)} title="⬆ Bulk CSV Import"
        footer={<><button className="btn btn-ghost" onClick={() => setCsvModal(false)}>Cancel</button><button className="btn btn-primary" onClick={uploadCsv} disabled={busy}>Import</button></>}>
        <p className="tiny muted mb">Ek line per student: <code>name,email,password</code> (header optional).</p>
        <textarea className="input" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={`Aarav Sharma,aarav@x.com,pass123\nDiya Patel,diya@x.com,pass123`} />
      </Modal>
    </AdminLayout>
  )
}
