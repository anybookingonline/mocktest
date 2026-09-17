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
  const [quotaVal, setQuotaVal] = useState('0')
  const [quotaSaving, setQuotaSaving] = useState(false)
  const [importVal, setImportVal] = useState('0')
  const [importSaving, setImportSaving] = useState(false)
  const [form, setForm] = useState({ name: '', contactEmail: '', planDays: 30, kind: 'coaching', aiDailyQuota: 0 })
  const [apiKey, setApiKey] = useState({ configured: false, enabled: false, prefix: null })
  const [apiKeyRaw, setApiKeyRaw] = useState(null) // shown ONCE right after mint
  const [apiKeyBusy, setApiKeyBusy] = useState(false)
  const [subForm, setSubForm] = useState({ name: '', email: '', password: '' })
  const [subCreds, setSubCreds] = useState(null)
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
      setQuotaVal(String(me.ai_daily_quota ?? 0))
      setImportVal(String(me.ai_import_quota ?? 0))
      setApiKeyRaw(null)
      api.get(`/institutes/admin/institutes/${inst.id}/api-key`).then((d) => setApiKey(d)).catch(() => setApiKey({ configured: false }))
    } catch (e) { toast(e.message, 'err') }
  }

  const mintApiKey = async () => {
    if (!confirm('Nayi API key banau? Purani key turant band ho jayegi (rotate).')) return
    setApiKeyBusy(true)
    try {
      const d = await api.post(`/institutes/admin/institutes/${selected.institute.id}/api-key`, {})
      setApiKeyRaw(d.raw)
      setApiKey({ configured: true, enabled: true, prefix: d.prefix })
      toast('API key generated — abhi copy kar lo, ye dobara nahi dikhegi', 'ok')
    } catch (e) { toast(e.message, 'err') } finally { setApiKeyBusy(false) }
  }

  const toggleApiKey = async () => {
    setApiKeyBusy(true)
    try {
      if (apiKey.enabled) {
        await api.del(`/institutes/admin/institutes/${selected.institute.id}/api-key`)
        toast('API key disable ho gayi')
      } else {
        await api.post(`/institutes/admin/institutes/${selected.institute.id}/api-key/enable`, {})
        toast('API key enable ho gayi', 'ok')
      }
      setApiKey((k) => ({ ...k, enabled: !k.enabled }))
    } catch (e) { toast(e.message, 'err') } finally { setApiKeyBusy(false) }
  }

  const create = async () => {
    if (!form.name.trim()) return toast('Institute name required', 'err')
    setBusy(true)
    try {
      const d = await api.post('/institutes/admin/institutes', form)
      toast(`Institute created — code ${d.code}`, 'ok')
      setCreateModal(false)
      setForm({ name: '', contactEmail: '', planDays: 30, kind: 'coaching', aiDailyQuota: 0 })
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const genPassword = () => {
    // Pronounceable-but-strong default: word + digits + symbol
    const words = ['Shikhar', 'Prayas', 'Neev', 'Unnati', 'Samarth', 'Pragati', 'Setu', 'Disha']
    const w = words[Math.floor(Math.random() * words.length)]
    const n = Math.floor(1000 + Math.random() * 9000)
    return `${w}@${n}`
  }

  const addSubAdmin = async () => {
    if (!subForm.email || !subForm.password) return toast('Email + password required', 'err')
    setBusy(true)
    try {
      const d = await api.post(`/institutes/admin/institutes/${selected.institute.id}/subadmin`, subForm)
      toast('Sub-admin created — credentials niche copy karke institute ko bhejein', 'ok')
      setSubCreds({ email: subForm.email, password: subForm.password, institute: selected.institute.platform_name || selected.institute.name })
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

  const saveQuota = async () => {
    setQuotaSaving(true)
    try {
      await api.put(`/institutes/admin/institutes/${selected.institute.id}/ai-quota`, { aiDailyQuota: Number(quotaVal) || 0 })
      toast(Number(quotaVal) > 0 ? `AI quota saved — ${quotaVal} doubts/day (institute-wide)` : 'AI quota removed — unlimited', 'ok')
      open(selected.institute)
    } catch (e) { toast(e.message, 'err') } finally { setQuotaSaving(false) }
  }

  const saveImportQuota = async () => {
    setImportSaving(true)
    try {
      await api.put(`/institutes/admin/institutes/${selected.institute.id}/import-quota`, { aiImportQuota: Math.round(Number(importVal)) || 0 })
      toast(Math.round(Number(importVal)) > 0 ? `Import quota saved — ${importVal} papers/month (school self-serve)` : 'Import quota OFF — school PDF upload disabled', 'ok')
      open(selected.institute)
    } catch (e) { toast(e.message, 'err') } finally { setImportSaving(false) }
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
              <span className={`chip ${i.kind === 'school' ? 'blue' : ''}`}>{i.kind === 'school' ? '🏫 School' : '📚 Coaching'}</span>
              <span className="chip">{i.students} students</span>
              <span className="chip">{i.invites} invites</span>
              <span className="chip">till {fmtDate(i.plan_until)}</span>
            </div>
            {(i.ai_import_quota > 0 || i.pdf_used_this_month > 0 || i.pdf_pending_review > 0) && (
              <div className="row mt" style={{ flexWrap: 'wrap', gap: 6 }}>
                {i.ai_import_quota > 0 ? (
                  <span className="chip" style={{ fontWeight: 600 }}>
                    📄 {i.pdf_used_this_month}/{i.ai_import_quota} imports
                  </span>
                ) : (
                  <span className="chip">📄 import OFF</span>
                )}
                {i.pdf_pending_review > 0 ? (
                  <Badge kind="amber">⏳ {i.pdf_pending_review} pending review</Badge>
                ) : (
                  <span className="chip">✓ {i.pdf_published_total} published</span>
                )}
              </div>
            )}
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
            <div className="spread">
              <div>
                <b>🛡️ Daily AI quota (pilot loss guardrail)</b>
                <p className="tiny muted" style={{ marginTop: 4, maxWidth: 520 }}>
                  Is institute ke saare students aaj ke din total itne AI doubts kar sakte hain.
                  Pilot/free month me quota ON rakho — worst-case AI bill kabhi cap se aage nahi jayega.
                  Paid plan par 0 = unlimited.
                </p>
              </div>
              <div className="row">
                <input type="number" min="0" className="input" style={{ width: 110 }} value={quotaVal} onChange={(e) => setQuotaVal(e.target.value)} />
                <button className="btn btn-ghost btn-sm" onClick={saveQuota} disabled={quotaSaving}>{quotaSaving ? 'Saving…' : 'Save quota'}</button>
              </div>
            </div>
          </div>

          <div className="card mb">
            <div className="spread">
              <div>
                <b>📄 Monthly PDF import quota (school self-serve)</b>
                <p className="tiny muted" style={{ marginTop: 4, maxWidth: 520 }}>
                  Sub-admin apne khud ke exam papers (Class 8/9/10 unit tests, term papers, modules) PDF se import kar payega —
                  har paper ~₹5–15 AI cost. 0 = upload disabled. Duplicate paper quota khata nahi hai.
                  Recommended: school plan par 20–50/month.
                </p>
              </div>
              <div className="row">
                <input type="number" min="0" className="input" style={{ width: 110 }} value={importVal} onChange={(e) => setImportVal(e.target.value)} />
                <button className="btn btn-ghost btn-sm" onClick={saveImportQuota} disabled={importSaving}>{importSaving ? 'Saving…' : 'Save quota'}</button>
              </div>
            </div>
          </div>

          <div className="card mb">
            <div className="spread">
              <div>
                <b>🔑 API Access (integrations)</b>
                <p className="tiny muted" style={{ marginTop: 4, maxWidth: 520 }}>
                  Is institute ke ERP/enrollment system ke liye server-to-server key.
                  Calls se students add/list aur PDF upload hota hai — quota aur review
                  pipeline waise hi lagti hai. Key sirf banate waqt dikhti hai (securely store karo).
                </p>
              </div>
              <div className="row">
                <button className="btn btn-ghost btn-sm" onClick={mintApiKey} disabled={apiKeyBusy}>
                  {apiKey.configured ? '🔄 Rotate key' : '+ Generate API key'}
                </button>
                {apiKey.configured && (
                  <button className="btn btn-ghost btn-sm" onClick={toggleApiKey} disabled={apiKeyBusy}>
                    {apiKey.enabled ? 'Disable' : 'Enable'}
                  </button>
                )}
              </div>
            </div>
            {apiKeyRaw && (
              <div className="mt" style={{ padding: '10px 12px', borderRadius: 10, background: 'rgba(16,185,129,.10)', border: '1px solid rgba(16,185,129,.35)' }}>
                <div className="tiny" style={{ marginBottom: 6 }}><b style={{ color: 'var(--green)' }}>⚠️ Ek hi baar dikhegi — abhi copy karo:</b></div>
                <div className="row">
                  <code className="small" style={{ wordBreak: 'break-all', flex: 1 }}>{apiKeyRaw}</code>
                  <button className="btn btn-sm btn-ghost" onClick={() => { navigator.clipboard?.writeText(apiKeyRaw); toast('Copied', 'ok') }}>📋 Copy</button>
                </div>
                <div className="tiny muted" style={{ marginTop: 6 }}>Use: header <code>X-API-Key: &lt;key&gt;</code> → endpoints <code>/api/institutes/ext/*</code></div>
              </div>
            )}
            {!apiKeyRaw && apiKey.configured && (
              <div className="row mt">
                <Badge kind={apiKey.enabled ? 'green' : 'gray'}>{apiKey.enabled ? 'active' : 'disabled'}</Badge>
                <span className="tiny muted">key: <code>{apiKey.prefix}…</code></span>
              </div>
            )}
          </div>

          <div className="card mb">
            <div className="spread mb">
              <b>📑 PDF Pipeline & Review queue</b>
              <span className="chip">Monthly usage: {selected.stats.pdf_used_this_month}/{selected.stats.ai_import_quota || 'OFF'}</span>
            </div>
            <div className="grid grid-4 mb">
              <div className="stat card"><span className="label">Imports this month</span><span className="value">{selected.stats.pdf_used_this_month}</span><span className="sub">quota {selected.stats.ai_import_quota || 'OFF'}</span></div>
              <div className="stat card"><span className="label">Total imports</span><span className="value">{selected.stats.pdf_imports_total}</span></div>
              <div className="stat card"><span className="label">Pending review</span><span className="value" style={{ color: selected.stats.pdf_pending_review > 0 ? 'var(--amber)' : undefined }}>{selected.stats.pdf_pending_review}</span><span className="sub">sub-admin approve karega</span></div>
              <div className="stat card"><span className="label">Published to bank</span><span className="value">{selected.stats.pdf_published_total}</span><span className="sub">approved questions</span></div>
            </div>
            {selected.stats.pdf_recent?.length > 0 && (
              <table className="tbl">
                <thead><tr><th>Recent papers</th><th>Status</th><th>Questions</th><th>When</th></tr></thead>
                <tbody>
                  {selected.stats.pdf_recent.map((im) => (
                    <tr key={im.id}>
                      <td className="small">{im.filename}</td>
                      <td><Badge kind={im.status === 'completed' ? 'green' : im.status === 'failed' ? 'red' : im.status === 'review' ? 'amber' : 'blue'}>{im.status}</Badge></td>
                      <td>{im.questions_created ?? 0}</td>
                      <td className="tiny">{fmtDate(im.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
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

          <div className="card mb">
            <b className="mb" style={{ display: 'block' }}>📋 Onboarding — 3 steps (institute ko bhejne ke liye)</b>
            {(() => {
              const active = invites.find((v) => v.is_active)
              const link = active ? `${window.location.origin}/register?sch=${active.code}` : null
              return (
                <>
                  <ol className="small" style={{ paddingLeft: 20, lineHeight: 2 }}>
                    <li><b>Student link share karo:</b> students is link se register karenge — auto is institute me add ho jayenge:</li>
                  </ol>
                  {link && (
                    <div className="spread" style={{ padding: '8px 10px', background: 'var(--panel2)', borderRadius: 8 }}>
                      <code className="tiny" style={{ wordBreak: 'break-all' }}>{link}</code>
                      <button className="btn btn-ghost btn-sm" onClick={() => { navigator.clipboard?.writeText(link); toast('Link copied — WhatsApp par share karo', 'ok') }}>📋 Copy</button>
                    </div>
                  )}
                  <ol className="small" start={2} style={{ paddingLeft: 20, lineHeight: 2 }}>
                    <li><b>CSV shortcut:</b> bade batch ke liye owner ko sub-admin login do — wo apne dashboard se seedha CSV import kar dega (name,email,password per line).</li>
                    <li><b>Telegram (optional):</b> students apne account ko bot se link kar len — phir doubts, revision reminders aur results sab Telegram par.</li>
                  </ol>
                </>
              )
            })()}
          </div>
        </>
      )}

      <Modal open={createModal} onClose={() => setCreateModal(false)} title="🏫 New Institute"
        footer={<><button className="btn btn-ghost" onClick={() => setCreateModal(false)}>Cancel</button><button className="btn btn-primary" onClick={create} disabled={busy}>Create</button></>}>
        <label className="field"><span>Institute name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Sunrise Coaching Classes" /></label>
        <label className="field"><span>Type</span>
          <select className="select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="coaching">📚 Coaching Institute</option>
            <option value="school">🏫 School</option>
          </select>
        </label>
        <label className="field"><span>Contact email</span><input className="input" value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} placeholder="owner@sunrise.com" /></label>
        <label className="field"><span>Trial days</span><input type="number" className="input" value={form.planDays} onChange={(e) => setForm({ ...form, planDays: e.target.value })} /></label>
        <label className="field"><span>Daily AI quota (0 = unlimited) — pilot ke dauran recommend: students × 15</span><input type="number" min="0" className="input" value={form.aiDailyQuota} onChange={(e) => setForm({ ...form, aiDailyQuota: e.target.value })} placeholder="0" /></label>
      </Modal>

      <Modal open={subModal} onClose={() => { setSubModal(false); setSubCreds(null) }} title="👤 Institute Sub-Admin"
        footer={subCreds
          ? <button className="btn btn-primary" onClick={() => { setSubModal(false); setSubCreds(null) }}>Done</button>
          : <><button className="btn btn-ghost" onClick={() => setSubModal(false)}>Cancel</button><button className="btn btn-primary" onClick={addSubAdmin} disabled={busy}>Create</button></>}>
        {subCreds ? (
          <>
            <p className="small mb">✅ Sub-admin ban gaya. Ye credentials <b>WhatsApp par bhej do</b> institute owner ko — baad me ye screen dobara nahi dikhegi:</p>
            <div className="card muted-bg" style={{ fontFamily: 'monospace', lineHeight: 2 }}>
              🌐 Login: <b>apni website ka /login</b><br />
              📧 Email: <b>{subCreds.email}</b><br />
              🔑 Password: <b>{subCreds.password}</b>
            </div>
            <p className="tiny muted mt">Login ke baad owner apna password /me page se change kar sakta hai. Isi credentials se wo /admin/institute par apna dashboard kholega.</p>
          </>
        ) : (
          <>
            <p className="tiny muted mb">Sub-admin ko sirf is institute ke students dikhte hain — apna login milega.</p>
            <label className="field"><span>Name</span><input className="input" value={subForm.name} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} /></label>
            <label className="field"><span>Email</span><input className="input" value={subForm.email} onChange={(e) => setSubForm({ ...subForm, email: e.target.value })} /></label>
            <label className="field"><span>Password</span>
              <div className="row">
                <input className="input" value={subForm.password} onChange={(e) => setSubForm({ ...subForm, password: e.target.value })} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSubForm({ ...subForm, password: genPassword() })}>🎲 Generate</button>
              </div>
            </label>
            <p className="tiny muted">Create hone ke baad credentials copy-karne ka card milega.</p>
          </>
        )}
      </Modal>

      <Modal open={csvModal} onClose={() => setCsvModal(false)} title="⬆ Bulk CSV Import"
        footer={<><button className="btn btn-ghost" onClick={() => setCsvModal(false)}>Cancel</button><button className="btn btn-primary" onClick={uploadCsv} disabled={busy}>Import</button></>}>
        <p className="tiny muted mb">Ek line per student: <code>name,email,password</code> (header optional).</p>
        <textarea className="input" rows={8} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={`Aarav Sharma,aarav@x.com,pass123\nDiya Patel,diya@x.com,pass123`} />
      </Modal>
    </AdminLayout>
  )
}
