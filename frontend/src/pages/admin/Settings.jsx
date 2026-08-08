import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { useToast } from '../../components/ui.jsx'

const GATEWAY_META = [
  { id: 'razorpay', label: 'Razorpay', desc: 'Cards / UPI / NetBanking (India)' },
  { id: 'stripe', label: 'Stripe', desc: 'International cards' },
  { id: 'phonepe', label: 'PhonePe', desc: 'UPI via PhonePe PG' },
  { id: 'qr', label: 'Custom QR', desc: 'Scan-and-pay UPI QR (manual verify)' }
]

const GATEWAY_FIELDS = {
  razorpay: [['razorpay.keyId', 'Key ID', 'text', 'rzp_live_...'], ['razorpay.keySecret', 'Key Secret', 'password', '']],
  stripe: [['stripe.secretKey', 'Secret key', 'password', ''], ['stripe.webhookSecret', 'Webhook secret', 'password', '']],
  phonepe: [['phonepe.merchantId', 'Merchant ID', 'text', ''], ['phonepe.saltKey', 'Salt Key', 'password', ''], ['phonepe.saltIndex', 'Salt Index', 'text', '1'], ['phonepe.env', 'Environment', 'select', 'PROD', ['PROD', 'UAT']], ['phonepe.baseUrl', 'Base URL (optional override)', 'text', '']],
  qr: [['qr.upiId', 'UPI ID (e.g. name@okhdfc)', 'text', ''], ['qr.holderName', 'Account / business name', 'text', ''], ['qr.qrImage', 'QR image (data URL from upload)', 'file'], ['qr.note', 'Payment note (e.g. "Send ₹499 and enter the UTR below")', 'text', '']]
}

export default function AdminSettings() {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  const [gateways, setGateways] = useState(['razorpay'])
  const [fileBuf, setFileBuf] = useState(null)

  useEffect(() => {
    api.get('/admin/settings').then((d) => {
      const s = d.settings
      let g = ['razorpay']
      try { const arr = JSON.parse(s['monetization.gateways']); if (Array.isArray(arr) && arr.length) g = arr } catch { /* keep default */ }
      setGateways(g)
      setCfg(s)
    }).catch(() => {})
  }, [])

  const save = async () => {
    try {
      const payload = { ...cfg, 'monetization.gateways': JSON.stringify(gateways) }
      if (fileBuf) {
        payload['qr.qrImage'] = fileBuf
        setFileBuf(null)
      }
      await api.put('/admin/settings', payload)
      toast('Settings saved', 'ok')
    } catch (e) { toast(e.message, 'err') }
  }

  if (!cfg) return <AdminLayout title="Settings"><div className="spin" /></AdminLayout>

  const set = (k) => (e) => setCfg({ ...cfg, [k]: e.target.value })
  const toggle = (id) => {
    setGateways((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    const r = new FileReader()
    r.onload = () => setFileBuf(r.result)
    r.readAsDataURL(f)
  }

  const renderField = ([key, label, type, placeholder, options]) => {
    if (type === 'select') {
      return (
        <label className="field" key={key}><span>{label}</span>
          <select className="input" value={cfg[key]} onChange={set(key)}>
            {(options || []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
      )
    }
    if (type === 'file') {
      return (
        <label className="field" key={key}><span>{label}</span>
          <input type="file" accept="image/*" className="input" onChange={onFile} />
          {cfg[key] && <p className="tiny muted">QR image set ✓ <a href="#" onClick={(e) => { e.preventDefault(); setCfg({ ...cfg, [key]: '' }) }}>remove</a></p>}
        </label>
      )
    }
    return (
      <label className="field" key={key}><span>{label}</span>
        <input type={type} className="input" value={cfg[key]} placeholder={placeholder} onChange={set(key)} />
      </label>
    )
  }

  return (
    <AdminLayout title="Platform Settings">
      <div className="card" style={{ maxWidth: 720 }}>
        <b className="small mb" style={{ display: 'block' }}>Platform branding</b>
        <label className="field"><span>Platform name</span>
          <input className="input" value={cfg['platform.name']} onChange={set('platform.name')} />
        </label>
        <label className="field"><span>Tagline</span>
          <input className="input" value={cfg['platform.tagline']} onChange={set('platform.tagline')} />
        </label>
        <hr className="divider" />
        <b className="small mb" style={{ display: 'block' }}>Plan pricing</b>
        <div className="row">
          <label className="field" style={{ flex: 1 }}><span>Plan price</span>
            <input type="number" className="input" value={cfg['monetization.price']} onChange={set('monetization.price')} />
          </label>
          <label className="field" style={{ flex: 1 }}><span>Currency</span>
            <input className="input" value={cfg['monetization.currency']} placeholder="INR" onChange={set('monetization.currency')} />
          </label>
          <label className="field" style={{ flex: 1 }}><span>Retention days (paid)</span>
            <input type="number" className="input" value={cfg['monetization.retentionDays']} onChange={set('monetization.retentionDays')} />
          </label>
          <label className="field" style={{ flex: 1 }}><span>Free hold (hours)</span>
            <input type="number" className="input" value={cfg['monetization.freeHoldHours']} onChange={set('monetization.freeHoldHours')} />
          </label>
        </div>
        <p className="tiny muted mb">Free users' data is automatically deleted after the free hold window. Paid users' data is kept for the retention period.</p>
        <hr className="divider" />
        <b className="small mb" style={{ display: 'block' }}>Payment gateways — enable one or more</b>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {GATEWAY_META.map((g) => (
            <label key={g.id} className="chip" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: gateways.includes(g.id) ? 'var(--accent)' : '', color: gateways.includes(g.id) ? '#fff' : '' }}>
              <input type="checkbox" checked={gateways.includes(g.id)} onChange={() => toggle(g.id)} />
              {g.label}
            </label>
          ))}
        </div>
        <p className="tiny muted mb">Tick the gateways you want students to pay with. Configure each gateway's keys below.</p>

        {gateways.map((g) => (
          <div key={g} className="card" style={{ margin: '10px 0', padding: 14 }}>
            <b className="small mb" style={{ display: 'block' }}>
              {GATEWAY_META.find((x) => x.id === g)?.label}
              <span className="tiny muted"> — {GATEWAY_META.find((x) => x.id === g)?.desc}</span>
            </b>
            {GATEWAY_FIELDS[g]?.map(renderField)}
          </div>
        ))}

        {gateways.length === 0 && <p className="tiny muted mb">No gateways enabled — students will not be able to purchase. Enable at least one.</p>}

        <hr className="divider" />
        <div className="row mb">
          <span className="chip">Schema version: 2.2.0</span>
          <span className="chip">Unified question schema: AI + PYQ</span>
          <span className="chip">Storage: PostgreSQL</span>
        </div>
        <button className="btn btn-primary" onClick={save}>Save settings</button>
      </div>
    </AdminLayout>
  )
}
