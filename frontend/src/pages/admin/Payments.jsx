import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast } from '../../components/ui.jsx'

export default function AdminPayments() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [email, setEmail] = useState('')
  const [days, setDays] = useState(365)

  const reload = () => api.get('/payments/admin/status').then(setData).catch(() => {})

  useEffect(() => { reload() }, [])

  const activate = async () => {
    if (!email) return toast('Enter a user email', 'err')
    try {
      await api.post('/payments/admin/activate', { email, days })
      toast('Retention activated', 'ok')
      setEmail('')
      reload()
    } catch (e) { toast(e.message, 'err') }
  }

  const markPaid = async (id) => {
    try {
      await api.post('/payments/admin/mark-paid', { paymentId: id })
      toast('Payment marked paid, retention activated', 'ok')
      reload()
    } catch (e) { toast(e.message, 'err') }
  }

  const fmt = (s) => s ? new Date(s.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

  return (
    <AdminLayout title="Payments & Retention">
      <div className="card mb" style={{ maxWidth: 560 }}>
        <b className="small mb" style={{ display: 'block' }}>Manual activation (offline billing)</b>
        <div className="row">
          <input className="input" style={{ flex: 2 }} placeholder="user@email.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input type="number" className="input" style={{ flex: 1 }} value={days} onChange={(e) => setDays(e.target.value)} />
          <button className="btn btn-primary" onClick={activate}>Activate</button>
        </div>
        <p className="tiny muted">Extends retention for the given user by the number of days (default 365).</p>
      </div>

      <div className="card mb">
        <b className="small mb" style={{ display: 'block' }}>Recent payments {data?.pendingCount > 0 && <span className="tiny muted">· {data.pendingCount} pending</span>}</b>
        {!data ? <div className="spin" /> : data.payments.length === 0 ? <p className="tiny muted">No payments yet.</p> : (
          <table className="table">
            <thead><tr><th>ID</th><th>User</th><th>Amount</th><th>Gateway</th><th>Ref / UTR</th><th>Proof</th><th>Status</th><th>Created</th><th /></tr></thead>
            <tbody>
              {data.payments.map((p) => (
                <tr key={p.id}>
                  <td>#{p.id}</td>
                  <td>{p.email}</td>
                  <td>{p.currency} {p.amount}</td>
                  <td><Badge kind="purple">{p.provider}</Badge></td>
                  <td className="small muted">{p.txn_ref ? `UTR ${p.txn_ref}${p.payer_name ? ` (${p.payer_name})` : ''}` : p.provider_ref || '—'}</td>
                  <td>
                    {p.payment_proof ? (
                      <a href={p.payment_proof} target="_blank" rel="noreferrer" title="Open screenshot">
                        <img src={p.payment_proof} alt="payment proof" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)', cursor: 'zoom-in' }} />
                      </a>
                    ) : <span className="tiny muted">—</span>}
                  </td>
                  <td><Badge kind={p.status === 'success' ? 'green' : p.status === 'pending' ? 'amber' : 'red'}>{p.status}</Badge></td>
                  <td className="small muted">{fmt(p.created_at)}</td>
                  <td>
                    {p.status === 'pending' && (p.provider === 'qr' || p.provider === 'phonepe') && (
                      <button className="btn btn-primary btn-sm" onClick={() => markPaid(p.id)}>Mark paid</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <b className="small mb" style={{ display: 'block' }}>Active retentions</b>
        {!data ? <div className="spin" /> : data.retentions.length === 0 ? <p className="tiny muted">No retention plans sold yet.</p> : (
          <table className="table">
            <thead><tr><th>User</th><th>Plan</th><th>Held until</th><th>Status</th></tr></thead>
            <tbody>
              {data.retentions.map((r, i) => {
                const active = new Date(r.retain_until.replace(' ', 'T') + 'Z').getTime() > Date.now()
                return (
                  <tr key={i}>
                    <td>{r.email}</td>
                    <td>{r.plan}</td>
                    <td>{fmt(r.retain_until)}</td>
                    <td><Badge kind={active ? 'green' : 'red'}>{active ? 'Active' : 'Expired'}</Badge></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </AdminLayout>
  )
}
