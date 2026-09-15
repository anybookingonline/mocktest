import React, { useEffect, useMemo, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { useToast, Empty, Badge } from '../../components/ui.jsx'

// ---------------------------------------------------------------------------
// Coupons manager — campaign codes for the social-media rollout. Presets,
// source attribution stats, and live usage per code. No JSON anywhere.
// ---------------------------------------------------------------------------

const PRESETS = [
  { label: '🎁 7 din free', desc: 'Retention trial — signup offer', patch: { kind: 'retention', days: 7 } },
  { label: '📅 30 din pro', desc: 'Monthly giveaway / contest prize', patch: { kind: 'retention', days: 30 } },
  { label: '⚡ AI Power 30 din', desc: 'AI Power Pack add-on trial', patch: { kind: 'addon', addonId: 'ai_power', days: 30 } },
  { label: '📰 Current Affairs 30 din', desc: 'CA Pro add-on trial', patch: { kind: 'addon', addonId: 'current_affairs', days: 30 } }
]

const SOURCE_CHIPS = [
  { label: '📸 Instagram', value: 'instagram' },
  { label: '✈️ Telegram', value: 'telegram' },
  { label: '▶️ YouTube', value: 'youtube' },
  { label: '🐦 X / Twitter', value: 'x' },
  { label: '👋 WhatsApp', value: 'whatsapp' }
]

export default function Coupons() {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [addons, setAddons] = useState([])
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState({
    code: '', kind: 'retention', addonId: 'ai_power', days: 7,
    source: 'instagram', maxUses: 0, perUserLimit: 1, expiresAt: ''
  })

  const load = () => {
    api.get('/coupons/admin/list').then(setData).catch((e) => toast(e.message, 'err'))
  }
  useEffect(() => {
    load()
    api.get('/coupons/admin/addons').then((d) => setAddons(d.addons || [])).catch(() => {})
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const create = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { ...form, maxUses: Number(form.maxUses) || 0, perUserLimit: Number(form.perUserLimit) || 1 }
      if (!body.expiresAt) delete body.expiresAt
      const c = await api.post('/coupons/admin', body)
      toast(`Coupon ${c.code} created 🎟️`, 'ok')
      setForm((f) => ({ ...f, code: '' }))
      load()
    } catch (err) { toast(err.message, 'err') }
    setBusy(false)
  }

  const toggle = async (c) => {
    try {
      await api.put(`/coupons/admin/${c.id}`, { is_active: !c.is_active })
      load()
    } catch (err) { toast(err.message, 'err') }
  }
  const remove = async (c) => {
    if (!window.confirm(`Delete coupon ${c.code}? Redemptions already granted stay active.`)) return
    try {
      await api.del(`/coupons/admin/${c.id}`)
      toast('Deleted', 'ok')
      load()
    } catch (err) { toast(err.message, 'err') }
  }

  const coupons = data?.coupons || []
  const bySource = data?.bySource || []
  const summary = useMemo(() => {
    const totalRedemptions = coupons.reduce((a, c) => a + (Number(c.redemptions) || 0), 0)
    const activeCodes = coupons.filter((c) => Number(c.is_active)).length
    return { totalRedemptions, activeCodes }
  }, [coupons])

  const applyPreset = (p) => setForm((f) => ({ ...f, ...p.patch }))

  return (
    <AdminLayout title="🎟️ Coupons (Rollout Campaigns)">
      <p className="muted small mb">
        Social-media campaigns ke liye codes banao. Har code ka source tag rakhta hai —
        yahan se pata chalega kaunsa platform (Instagram/Telegram/YouTube) sabse zyada users la raha hai.
        Coupon se mili days existing plan ke <b>upar extend</b> hoti hain, replace nahi karti.
      </p>

      {/* -------- Create form -------- */}
      <form onSubmit={create} className="card mb" style={{ maxWidth: 860 }}>
        <b className="mb" style={{ display: 'block' }}>Naya coupon banao</b>

        <div className="mb" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {PRESETS.map((p) => (
            <button key={p.label} type="button" className="btn btn-ghost btn-sm" title={p.desc}
              onClick={() => applyPreset(p)}>{p.label}</button>
          ))}
        </div>

        <div className="field-row">
          <label className="field"><span>Code *</span>
            <input className="input" placeholder="INSTA500" value={form.code} onChange={set('code')} required
              style={{ textTransform: 'uppercase', letterSpacing: 1 }} />
          </label>
          <label className="field"><span>Kya milega</span>
            <select className="input" value={form.kind} onChange={set('kind')}>
              <option value="retention">📅 Data Retention (pro plan)</option>
              <option value="addon">⚡ Add-on pack</option>
            </select>
          </label>
          {form.kind === 'addon' ? (
            <label className="field"><span>Add-on</span>
              <select className="input" value={form.addonId} onChange={set('addonId')}>
                {addons.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          ) : null}
          <label className="field"><span>Kitne din</span>
            <input className="input" type="number" min="1" max="3650" value={form.days} onChange={set('days')} />
          </label>
        </div>

        <div className="field-row">
          <label className="field"><span>Campaign source</span>
            <select className="input" value={form.source} onChange={set('source')}>
              {SOURCE_CHIPS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              <option value="">— other / none —</option>
            </select>
          </label>
          <label className="field"><span>Max total uses (0 = unlimited)</span>
            <input className="input" type="number" min="0" value={form.maxUses} onChange={set('maxUses')} />
          </label>
          <label className="field"><span>Per-user limit</span>
            <input className="input" type="number" min="1" value={form.perUserLimit} onChange={set('perUserLimit')} />
          </label>
          <label className="field"><span>Expires on (optional)</span>
            <input className="input" type="date" value={form.expiresAt} onChange={set('expiresAt')} />
          </label>
        </div>

        <button className="btn btn-accent mt" disabled={busy}>
          {busy ? 'Creating…' : '🎟️ Create coupon'}
        </button>
      </form>

      {/* -------- Campaign attribution -------- */}
      {bySource.length > 0 && (
        <div className="card mb" style={{ maxWidth: 860 }}>
          <b className="mb" style={{ display: 'block' }}>📊 Campaign performance (source-wise)</b>
          <table className="table">
            <thead><tr><th>Source</th><th>Codes</th><th>Redemptions</th><th>Unique users</th></tr></thead>
            <tbody>
              {bySource.map((s) => (
                <tr key={s.source}>
                  <td><b>{s.source}</b></td>
                  <td>{s.codes}</td>
                  <td>{s.redemptions}</td>
                  <td>{s.uniqueUsers}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted mt">Jis source ke sabse zyada unique users hain, agla budget wahi lena — data-driven rollout.</p>
        </div>
      )}

      {/* -------- List -------- */}
      <div className="card" style={{ maxWidth: 980 }}>
        <div className="row mb" style={{ justifyContent: 'space-between' }}>
          <b>All coupons</b>
          <span className="tiny muted">{summary.activeCodes} active · {summary.totalRedemptions} total redemptions</span>
        </div>
        {coupons.length === 0 ? (
          <Empty title="Koi coupon nahi" text="Upar wale form se pehla campaign code banao." />
        ) : (
          <table className="table">
            <thead>
              <tr><th>Code</th><th>Grant</th><th>Source</th><th>Used</th><th>Limit</th><th>Expiry</th><th>Status</th><th></th></tr>
            </thead>
            <tbody>
              {coupons.map((c) => {
                const full = c.max_uses > 0 && Number(c.used_count) >= Number(c.max_uses)
                const expired = c.expires_at && new Date(c.expires_at.replace(' ', 'T') + 'Z').getTime() < Date.now()
                return (
                  <tr key={c.id}>
                    <td><b style={{ letterSpacing: 1 }}>{c.code}</b></td>
                    <td>{c.kind === 'addon' ? `⚡ ${c.addon_id} · ${c.days}d` : `📅 Retention · ${c.days}d`}</td>
                    <td>{c.source || '—'}</td>
                    <td>{c.used_count}{c.max_uses > 0 ? ` / ${c.max_uses}` : ' / ∞'}</td>
                    <td>{c.per_user_limit}/user</td>
                    <td className="tiny">{c.expires_at ? c.expires_at.slice(0, 10) : '—'}</td>
                    <td>
                      {Number(c.is_active) && !full && !expired ? <Badge kind="ok">active</Badge>
                        : full ? <Badge kind="warn">fully used</Badge>
                        : expired ? <Badge kind="warn">expired</Badge>
                        : <Badge kind="gray">paused</Badge>}
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => toggle(c)}>{Number(c.is_active) ? 'Pause' : 'Resume'}</button>{' '}
                      <button className="btn btn-ghost btn-sm" onClick={() => remove(c)}>🗑️</button>
                    </td>
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
