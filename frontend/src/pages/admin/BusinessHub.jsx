import React, { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { useToast } from '../../components/ui.jsx'
import { PaymentsPanel } from './Payments.jsx'
import { AddonsPanel } from './AdminAddons.jsx'
import { CouponsPanel } from './Coupons.jsx'
import { MarketingPanel } from './Marketing.jsx'
import { PlanPricingPanel, GatewaysPanel } from './Settings.jsx'

// ---------------------------------------------------------------------------
// Business Hub — one page for everything that earns or promotes money:
// Payments & refunds, Add-ons pricing, Coupons, Marketing Studio and the
// monetization subset of Settings (plan pricing + gateways). Institutes (B2B)
// stays a separate page on purpose — it's a different workflow (orgs, not
// revenue plumbing). Each section keeps its own working save button; the tab
// deep-links via ?tab= so nav items can point straight at a section.
// ---------------------------------------------------------------------------
const TABS = [
  { id: 'payments', label: '💳 Payments & Retention', desc: 'Manual activations, refunds, recent payments, active retention plans.' },
  { id: 'addons', label: '🧩 Add-ons', desc: 'AI Power / AI Max / Voice / CA Pro / Focus / Smart Revision / Analytics Pro — on/off + pricing.' },
  { id: 'pricing', label: '💰 Plan Pricing', desc: 'Base plan price, retention days, free hold window.' },
  { id: 'gateways', label: '🏦 Payment Gateways', desc: 'Razorpay / Stripe / PhonePe / Custom QR keys and enablement.' },
  { id: 'coupons', label: '🎟️ Coupons', desc: 'Campaign codes with source attribution (Instagram / Telegram / YouTube…).' },
  { id: 'marketing', label: '📣 Marketing Studio', desc: 'AI content calendar, quick assets, school outreach, rollout stats.' }
]

export default function BusinessHub() {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') || 'payments'
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
    }).catch((e) => toast(e.message, 'err'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (!cfg) return <AdminLayout title="Business Hub"><div className="spin" /></AdminLayout>

  const set = (k) => (e) => setCfg({ ...cfg, [k]: e.target.value })

  const saveCfg = async () => {
    try {
      const payload = { ...cfg, 'monetization.gateways': JSON.stringify(gateways) }
      if (fileBuf) { payload['qr.qrImage'] = fileBuf; setFileBuf(null) }
      await api.put('/admin/settings', payload)
      toast('Saved ✅', 'ok')
    } catch (e) { toast(e.message, 'err') }
  }

  const toggleGateway = (id) => {
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

  const active = TABS.find((t) => t.id === tab) || TABS[0]

  return (
    <AdminLayout title="💼 Business Hub">
      <p className="muted small mb">
        Paisa-related sab kuch ek jagah — payments, plans, add-ons, coupons aur marketing.
        Har section apna save button rakhta hai. School/Institute (B2B) alag page par hai: <a href="/admin/institutes">Institutes →</a>
      </p>

      <div className="row mb" style={{ gap: 8, flexWrap: 'wrap' }}>
        {TABS.map((t) => (
          <button key={t.id}
            className={`btn btn-sm ${tab === t.id ? 'btn-accent' : 'btn-ghost'}`}
            onClick={() => setParams(t.id === 'payments' ? {} : { tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="tiny muted mb">{active.desc}</p>

      {tab === 'payments' && <PaymentsPanel />}
      {tab === 'addons' && <AddonsPanel />}
      {tab === 'pricing' && <PlanPricingPanel cfg={cfg} set={set} save={saveCfg} />}
      {tab === 'gateways' && <GatewaysPanel cfg={cfg} set={set} gateways={gateways} toggleGateway={toggleGateway} renderField={renderField} save={saveCfg} fileBuf={fileBuf} onFile={onFile} />}
      {tab === 'coupons' && <CouponsPanel />}
      {tab === 'marketing' && <MarketingPanel />}
    </AdminLayout>
  )
}
