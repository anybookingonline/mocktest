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

// Content-only panels — reused inside the Business Hub tabs.
export function PlanPricingPanel({ cfg, set, save }) {
  return (
    <div className="card" style={{ maxWidth: 720 }}>
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
      <b className="small mb" style={{ display: 'block' }}>🤖 AI doubt limits (daily caps)</b>
      <div className="row">
        <label className="field" style={{ flex: 1 }}><span>Free users — doubts/day</span>
          <input type="number" min="1" className="input" value={cfg['monetization.freeDoubtsPerDay'] || 15} onChange={set('monetization.freeDoubtsPerDay')} />
        </label>
        <label className="field" style={{ flex: 1 }}><span>Paid users — doubts/day (fair-use)</span>
          <input type="number" min="1" className="input" value={cfg['monetization.paidDoubtsPerDay'] || 50} onChange={set('monetization.paidDoubtsPerDay')} />
        </label>
      </div>
      <p className="tiny muted mb">Ye caps /ai/doubt, /ai/doubt/socratic, /ai/photo-solve aur Telegram doubts — sab par live lagte hain. Student-facing Plans page bhi inhi values se free-vs-paid comparison dikhata hai. Add-on (AI Power etc.) lena optional hai — base plan lene wale bhi paid cap me aate hain.</p>
      <button className="btn btn-primary" onClick={save}>Save plan pricing</button>
    </div>
  )
}

export function GatewaysPanel({ cfg, set, gateways, toggleGateway, renderField, save, fileBuf, onFile }) {
  return (
    <div className="card" style={{ maxWidth: 720 }}>
      <b className="small mb" style={{ display: 'block' }}>Payment gateways — enable one or more</b>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {GATEWAY_META.map((g) => (
          <label key={g.id} className="chip" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', background: gateways.includes(g.id) ? 'var(--accent)' : '', color: gateways.includes(g.id) ? '#fff' : '' }}>
            <input type="checkbox" checked={gateways.includes(g.id)} onChange={() => toggleGateway(g.id)} />
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
      <button className="btn btn-primary" onClick={save}>Save gateway settings</button>
    </div>
  )
}

export default function AdminSettings() {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  const [gateways, setGateways] = useState(['razorpay'])
  const [fileBuf, setFileBuf] = useState(null)
  const [storage, setStorage] = useState(null)
  const [b2Testing, setB2Testing] = useState(false)
  const [b2Result, setB2Result] = useState(null)
  const [maintOn, setMaintOn] = useState(false)
  const [maintBusy, setMaintBusy] = useState(false)

  useEffect(() => {
    api.get('/admin/settings').then((d) => {
      const s = d.settings
      let g = ['razorpay']
      try { const arr = JSON.parse(s['monetization.gateways']); if (Array.isArray(arr) && arr.length) g = arr } catch { /* keep default */ }
      setGateways(g)
      setCfg(s)
    }).catch(() => {})
    api.get('/admin/storage').then((d) => setStorage(d.storage)).catch(() => {})
    api.get('/admin/maintenance').then((d) => setMaintOn(!!d.enabled)).catch(() => {})
  }, [])

  // Instant effect: flip the flag server-side immediately so students see the
  // maintenance page within seconds (the app polls /api/meta/status every 30s).
  const toggleMaintenance = async () => {
    const next = !maintOn
    setMaintBusy(true)
    try {
      await api.put('/admin/settings', {
        'maintenance.enabled': next,
        'maintenance.message': cfg?.['maintenance.message'] || '',
        'maintenance.eta': cfg?.['maintenance.eta'] || ''
      })
      setMaintOn(next)
      toast(next ? '🛠️ Maintenance mode ON — students ko maintenance page dikh raha hoga' : '✅ Maintenance mode OFF — app wapas live hai', next ? 'ok' : 'ok')
    } catch (e) { toast(e.message, 'err') } finally { setMaintBusy(false) }
  }

  const testB2 = async () => {
    setB2Testing(true); setB2Result(null)
    try {
      // save first so freshly typed keys are what we test
      const payload = { ...cfg, 'monetization.gateways': JSON.stringify(gateways) }
      await api.put('/admin/settings', payload)
      const r = await api.post('/admin/storage/test', {})
      setB2Result(r)
      toast(r.ok ? 'B2 connection OK — upload/download/delete sab pass ✅' : 'B2 test fail — steps dekho', r.ok ? 'ok' : 'err')
      api.get('/admin/storage').then((d) => setStorage(d.storage)).catch(() => {})
    } catch (e) { toast(e.message, 'err') } finally { setB2Testing(false) }
  }

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
        <div className="spread" style={{ alignItems: 'center', marginBottom: 8 }}>
          <b className="small" style={{ display: 'block' }}>🛠️ Maintenance mode</b>
          <span className="chip" style={{
            background: maintOn ? 'rgba(248,113,113,0.15)' : 'rgba(74,222,128,0.12)',
            color: maintOn ? '#f87171' : '#4ade80', border: 'none', fontWeight: 700
          }}>{maintOn ? '● MAINTENANCE ON' : '● LIVE'}</span>
        </div>
        <p className="tiny muted mb">ON karte hi saare students aur visitors ko maintenance landing page dikhne lagega — aap (admin) app me hi rahoge, sab kuch test kar sakte ho. Updates deploy karne, DB migrate karne ya server restart ke liye use karo.</p>
        <div className="field-row">
          <label className="field"><span>Message (optional — page par dikhta hai)</span>
            <input className="input" placeholder="Naye features add kar rahe hain — thodi der me wapas!" value={cfg['maintenance.message'] || ''} onChange={set('maintenance.message')} maxLength={300} />
          </label>
          <label className="field"><span>ETA (optional — e.g. 18:30)</span>
            <input className="input" placeholder="18:30" value={cfg['maintenance.eta'] || ''} onChange={set('maintenance.eta')} maxLength={10} />
          </label>
        </div>
        <div className="row" style={{ alignItems: 'center', gap: 12 }}>
          <button
            className="btn"
            style={maintOn ? { background: '#4ade80', color: '#052e16', fontWeight: 700 } : { background: '#f87171', color: '#fff', fontWeight: 700 }}
            onClick={toggleMaintenance}
            disabled={maintBusy}
          >
            {maintBusy ? 'Applying…' : maintOn ? '✅ Turn maintenance OFF' : '🛠️ Turn maintenance ON'}
          </button>
          <span className="tiny muted">Toggle dabate hi message/ETA bhi isi form se save ho jate hain — page par turant dikhte hain.</span>
        </div>
        <hr className="divider" />
        <b className="small mb" style={{ display: 'block' }}>Platform branding (poore app me live rebrand hota hai)</b>
        <label className="field"><span>App / platform name</span>
          <input className="input" value={cfg['platform.name']} onChange={set('platform.name')} placeholder="Aisepadho" />
        </label>
        <label className="field"><span>Tagline</span>
          <input className="input" value={cfg['platform.tagline']} onChange={set('platform.tagline')} placeholder="Padho. Test do. Aage badho." />
        </label>
        <div className="field-row">
          <label className="field"><span>Logo URL (png/svg — tab title + sidebar)</span>
            <input className="input" value={cfg['platform.logoUrl']} placeholder="https://…/logo.png" onChange={set('platform.logoUrl')} />
          </label>
          <label className="field"><span>Apna domain (e.g. https://aisepadho.com)</span>
            <input className="input" value={cfg['platform.domain']} placeholder="https://aisepadho.com" onChange={set('platform.domain')} />
          </label>
        </div>
        <label className="field"><span>Support email (footer + parent reports)</span>
          <input className="input" value={cfg['platform.supportEmail']} placeholder="support@aisepadho.com" onChange={set('platform.supportEmail')} />
        </label>
        <p className="tiny muted mb">Name save karte hi app ka tab-title, favicon, sidebar logo, Telegram bot aur public pages naye brand me aa jate hain — koi redeploy nahi chahiye.</p>
        <hr className="divider" />
        <b className="small mb" style={{ display: 'block' }}>🗄️ Storage — Backblaze B2 (PDF/PYQ papers + payment proofs)</b>
        <p className="tiny muted mb">Mode: <b>{storage?.mode === 'b2' ? `B2 ✅ (${storage.source === 'env' ? 'env vars' : 'yahan se set'})` : 'local disk (dev mode)'}</b>{storage?.bucket ? <> · bucket: <code>{storage.bucket}</code></> : null}. B2 set hone par har PDF aur payment-proof encrypted B2 par archive hota hai — server restart par bhi safe. Env vars (B2_KEY_ID…) diye hain to ye fields khaali chhod do — env priority rakhta hai.</p>
        <div className="field-row">
          <label className="field"><span>Key ID (Backblaze → App Keys)</span>
            <input className="input" type="text" placeholder="0039…" value={cfg['b2.keyId'] || ''} onChange={set('b2.keyId')} />
          </label>
          <label className="field"><span>Application Key (keep secret)</span>
            <input className="input" type="password" placeholder="K0039…" value={cfg['b2.appKey'] || ''} onChange={set('b2.appKey')} />
          </label>
        </div>
        <div className="field-row">
          <label className="field"><span>Bucket ID (Bucket Details se)</span>
            <input className="input" placeholder="a1b2c3d4…" value={cfg['b2.bucketId'] || ''} onChange={set('b2.bucketId')} />
          </label>
          <label className="field"><span>Bucket name (optional — friendly URLs)</span>
            <input className="input" placeholder="aisepadho-files" value={cfg['b2.bucketName'] || ''} onChange={set('b2.bucketName')} />
          </label>
        </div>
        <label className="field"><span>Public base URL (optional custom CDN — full https:// URL)</span>
          <input className="input" placeholder="https://cdn.aisepadho.com" value={cfg['b2.publicBaseUrl'] || ''} onChange={set('b2.publicBaseUrl')} />
          <span className="tiny muted">Friendly URLs ke liye hi hai — storage ise ke bina bhi kaam karta hai (khali chhod sakte ho). Scheme ke bina bhi chalega, https:// auto lag jata hai.</span>
        </label>
        {b2Result && (
          <div className="card" style={{ margin: '10px 0', padding: 12 }}>
            {b2Result.steps?.map((s, i) => (
              <div key={i} className="spread tiny" style={{ padding: '3px 0' }}>
                <span>{s.ok ? '✅' : '❌'} {s.name}</span>
                <span className="muted" style={{ maxWidth: '60%', textAlign: 'right' }}>{s.info}</span>
              </div>
            ))}
          </div>
        )}
        <div className="row mb">
          <button className="btn btn-ghost btn-sm" onClick={testB2} disabled={b2Testing}>{b2Testing ? 'Testing…' : '🧪 Test B2 connection'}</button>
          <span className="tiny muted">Save ke baad test dabao — upload/download/delete ka live report milega (test file auto-delete).</span>
        </div>

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
        <b className="small mb" style={{ display: 'block' }}>📧 Email — transactional (Resend)</b>
        <p className="tiny muted mb">Mode: <b>{cfg['email.apiKey'] ? 'yahan se set ✅' : (storage?.mode ? '' : '')}</b>. Password reset, email verification, payment receipts + invoices isi se jaate hain. Env me <code>RESEND_API_KEY</code> diya hai to ye field khaali chhod do — env priority rakhta hai. From address aapke verified domain ka hona chahiye (Resend dashboard me domain add karo, warna onboarding@resend.dev fallback chalega).</p>
        <div className="field-row">
          <label className="field"><span>Resend API key (re_…)</span>
            <input className="input" type="password" placeholder="re_…" value={cfg['email.apiKey'] || ''} onChange={set('email.apiKey')} />
          </label>
          <label className="field"><span>From address</span>
            <input className="input" placeholder="Aisepadho <noreply@aisepadho.com>" value={cfg['email.from'] || ''} onChange={set('email.from')} />
          </label>
        </div>

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
