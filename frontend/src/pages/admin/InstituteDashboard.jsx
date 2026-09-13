import React, { useEffect, useState } from 'react'
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
  }
  useEffect(() => { load() }, [])

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
