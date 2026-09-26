import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { useToast } from '../../components/ui.jsx'

// One page to manage every paid add-on: on/off (kill-switch — hides it from
// the Plans page AND from student-facing nav/routes everywhere, not just
// the pricing card) + monthly/yearly price. Reads/writes the same generic
// /admin/settings key-value store AIConfig.jsx uses — this is just a
// dedicated, cleaner UI for the add-on subset of it.
const ADDON_FIELDS = [
  { id: 'aiPower', icon: '⚡', name: 'AI Power Pack', note: 'Up to 50 AI doubts/day (fair-use) + unlimited AI mocks + priority queue.', enabledKey: 'addons.aiPowerEnabled', monthlyKey: 'addons.aiPowerPriceMonthly', monthlyDefault: 29, yearlyKey: 'addons.aiPowerPrice', yearlyDefault: 199 },
  { id: 'aiMax', icon: '💎', name: 'AI Max', note: 'Top tier — includes Power + Voice + Smart Revision + Analytics Pro.', enabledKey: 'addons.aiMaxEnabled', monthlyKey: 'addons.aiMaxPriceMonthly', monthlyDefault: 49, yearlyKey: 'addons.aiMaxPrice', yearlyDefault: 399 },
  { id: 'voice', icon: '🎙️', name: 'Voice Doubts', note: 'Whisper speech-to-text doubts, fair-use daily limit.', enabledKey: 'addons.voiceEnabled', monthlyKey: 'addons.voicePriceMonthly', monthlyDefault: 15, yearlyKey: 'addons.voicePrice', yearlyDefault: 49 },
  { id: 'ca', icon: '📰', name: 'Current Affairs Pro', note: 'Daily AI current-affairs quiz.', enabledKey: 'addons.caEnabled', monthlyKey: 'addons.caPriceMonthly', monthlyDefault: 19, yearlyKey: 'addons.caPrice', yearlyDefault: 99 },
  { id: 'focus', icon: '🔥', name: 'AI Focus Areas', note: 'PYQ frequency-ranked priority topics.', enabledKey: 'addons.focusEnabled', monthlyKey: 'addons.focusPriceMonthly', monthlyDefault: 15, yearlyKey: 'addons.focusPrice', yearlyDefault: 79 },
  { id: 'smartRevision', icon: '🔁', name: 'Smart Revision Pack', note: 'AI revision mocks + flashcards + topic summaries.', enabledKey: 'addons.smartRevisionEnabled', monthlyKey: 'addons.smartRevisionPriceMonthly', monthlyDefault: 19, yearlyKey: 'addons.smartRevisionPriceYearly', yearlyDefault: 149 },
  { id: 'analyticsPro', icon: '📊', name: 'Analytics Pro', note: 'Weak-area heatmap + rank estimate + parent report.', enabledKey: 'addons.analyticsProEnabled', monthlyKey: 'addons.analyticsProPriceMonthly', monthlyDefault: 19, yearlyKey: 'addons.analyticsProPriceYearly', yearlyDefault: 149 }
]

export default function AdminAddons() {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => { api.get('/admin/settings').then((d) => setCfg(d.settings)).catch(() => {}) }, [])

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/admin/settings', cfg)
      toast('Add-on settings saved', 'ok')
    } catch (e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  if (!cfg) return <AdminLayout title="Add-ons"><div className="spin" /></AdminLayout>

  return (
    <AdminLayout title="🧩 Add-ons">
      <p className="small muted mb">
        Base plan (₹{cfg['monetization.price'] || 999}/year Data Retention) rahega minimal — sirf app access + rate limits.
        Baaki sab feature yahan se ON/OFF aur monthly/yearly price ke saath control hote hain. <b>OFF karne par wo feature Plans page se aur student-facing UI se — dono jagah se — hide ho jaata hai</b>, sirf pricing card se nahi.
      </p>

      {ADDON_FIELDS.map((a) => {
        const enabled = cfg[a.enabledKey] !== 'false'
        return (
          <div key={a.id} className="card mb">
            <div className="spread mb">
              <b>{a.icon} {a.name}</b>
              <label className="row small" style={{ alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" checked={enabled} onChange={(e) => set(a.enabledKey, e.target.checked ? 'true' : 'false')} />
                {enabled ? 'On — for sale' : 'Off — hidden everywhere'}
              </label>
            </div>
            <p className="tiny muted mb">{a.note}</p>
            <div className="field-row">
              <label className="field"><span>Monthly price (₹)</span>
                <input type="number" className="input" disabled={!enabled} value={cfg[a.monthlyKey] || a.monthlyDefault} onChange={(e) => set(a.monthlyKey, e.target.value)} />
              </label>
              <label className="field"><span>Yearly price (₹)</span>
                <input type="number" className="input" disabled={!enabled} value={cfg[a.yearlyKey] || a.yearlyDefault} onChange={(e) => set(a.yearlyKey, e.target.value)} />
              </label>
            </div>
          </div>
        )
      })}

      <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save add-on pricing'}</button>
    </AdminLayout>
  )
}
