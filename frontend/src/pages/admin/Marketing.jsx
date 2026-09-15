import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { useToast, Empty } from '../../components/ui.jsx'

// ---------------------------------------------------------------------------
// Marketing Studio — AI growth engine for the platform admin. Content calendar,
// one-click assets, B2B outreach sequences, rollout stats. Uses the platform's
// existing AI keys; nothing new to configure.
// ---------------------------------------------------------------------------

const TABS = [
  { id: 'content', label: '📅 Content Calendar' },
  { id: 'assets', label: '⚡ Quick Assets' },
  { id: 'outreach', label: '🏫 School Outreach' },
  { id: 'stats', label: '📊 Rollout Stats' }
]

const ASSET_TYPES = [
  { id: 'reel_script', label: '🎬 Reel script' },
  { id: 'whatsapp_broadcast', label: '💬 WhatsApp broadcast' },
  { id: 'winner_post', label: '🏆 Winner post (real leaderboard)' },
  { id: 'exam_tips', label: '💡 Exam tips post' }
]

const SOURCES = ['instagram', 'telegram', 'youtube', 'x', 'whatsapp']

function CopyBlock({ label, text }) {
  return (
    <div className="mb" style={{ background: 'var(--panel, #111827)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px' }}>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
        <span className="tiny muted">{label}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(text).then(() => {}, () => {})}>📋 Copy</button>
      </div>
      <pre style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', fontSize: 13 }}>{text}</pre>
    </div>
  )
}

export default function Marketing() {
  const toast = useToast()
  const [tab, setTab] = useState('content')
  const [busy, setBusy] = useState(false)
  const [calendar, setCalendar] = useState(null)
  const [assetOut, setAssetOut] = useState(null)
  const [outreachOut, setOutreachOut] = useState(null)
  const [stats, setStats] = useState(null)

  const [cal, setCal] = useState({ source: 'instagram', couponCode: '', examFocus: 'SSC/Banking', language: 'hinglish' })
  const [asset, setAsset] = useState({ type: 'reel_script', topic: '', language: 'hinglish' })
  const [reach, setReach] = useState({ instituteName: '', kind: 'coaching', city: '', contactName: '', notes: '', language: 'hinglish' })

  useEffect(() => { api.get('/marketing/stats').then(setStats).catch(() => {}) }, [])
  const set = (setter) => (k) => (e) => setter((f) => ({ ...f, [k]: e.target.value }))

  const genCalendar = async () => {
    setBusy(true)
    try { setCalendar(await api.post('/marketing/calendar', cal)); toast('Calendar ready ✅', 'ok') }
    catch (e) { toast(e.message, 'err') }
    setBusy(false)
  }
  const genAsset = async () => {
    setBusy(true)
    try { setAssetOut(await api.post('/marketing/asset', { type: asset.type, payload: asset })); toast('Asset ready ✅', 'ok') }
    catch (e) { toast(e.message, 'err') }
    setBusy(false)
  }
  const genOutreach = async () => {
    if (!reach.instituteName.trim()) return toast('Institute ka naam likho', 'err')
    setBusy(true)
    try { setOutreachOut(await api.post('/marketing/outreach', reach)); toast('Sequence ready ✅', 'ok') }
    catch (e) { toast(e.message, 'err') }
    setBusy(false)
  }

  const renderCalendar = () => {
    const days = calendar?.days || []
    return (
      <div>
        <div className="card mb" style={{ maxWidth: 860 }}>
          <b className="mb" style={{ display: 'block' }}>Is hafte ka plan</b>
          <div className="field-row">
            <label className="field"><span>Platform</span>
              <select className="input" value={cal.source} onChange={set(setCal)('source')}>
                {SOURCES.map((s) => <option key={s} value={s}>📸 {s}</option>)}
              </select>
            </label>
            <label className="field"><span>Coupon code (optional)</span>
              <input className="input" value={cal.couponCode} onChange={set(setCal)('couponCode')} placeholder="INSTA7" style={{ textTransform: 'uppercase' }} />
            </label>
            <label className="field"><span>Exam focus</span>
              <input className="input" value={cal.examFocus} onChange={set(setCal)('examFocus')} placeholder="SSC/Banking" />
            </label>
            <label className="field"><span>Language</span>
              <select className="input" value={cal.language} onChange={set(setCal)('language')}>
                <option value="hinglish">Hinglish</option><option value="english">English</option><option value="hindi">हिंदी</option>
              </select>
            </label>
          </div>
          <button className="btn btn-accent mt" onClick={genCalendar} disabled={busy}>{busy ? 'Generating…' : '🪄 7-day calendar banao'}</button>
          <p className="tiny muted mt">Tip: pehle Coupons page se code banao, phir wahi code yahan plug karo — campaign + content ek saath aligned.</p>
        </div>
        {days.map((d) => (
          <div key={d.day} className="card mb" style={{ maxWidth: 860 }}>
            <div className="spread mb">
              <b>Day {d.day} · {String(d.format || 'post').toUpperCase()}</b>
              <button className="btn btn-ghost btn-sm" onClick={() => navigator.clipboard.writeText(`${d.hook || ''}\n\n${d.caption || ''}\n\n${(d.hashtags || []).join(' ')}`)}>📋 Copy full</button>
            </div>
            <p className="small"><b>Hook:</b> {d.hook}</p>
            <CopyBlock label="Caption" text={d.caption || ''} />
            {(d.hashtags || []).length > 0 && <p className="tiny muted">{(d.hashtags || []).join(' ')}</p>}
            <p className="tiny">🎯 CTA: {d.cta}</p>
          </div>
        ))}
      </div>
    )
  }

  const renderAssets = () => (
    <div>
      <div className="card mb" style={{ maxWidth: 860 }}>
        <b className="mb" style={{ display: 'block' }}>Single asset generator</b>
        <div className="field-row">
          <label className="field"><span>Type</span>
            <select className="input" value={asset.type} onChange={set(setAsset)('type')}>
              {ASSET_TYPES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </label>
          <label className="field"><span>Topic (optional)</span>
            <input className="input" value={asset.topic} onChange={set(setAsset)('topic')} placeholder="SSC CGL tier-2 me time management" />
          </label>
          <label className="field"><span>Language</span>
            <select className="input" value={asset.language} onChange={set(setAsset)('language')}>
              <option value="hinglish">Hinglish</option><option value="english">English</option><option value="hindi">हिंदी</option>
            </select>
          </label>
        </div>
        <button className="btn btn-accent mt" onClick={genAsset} disabled={busy}>{busy ? 'Generating…' : '⚡ Generate'}</button>
        {asset.type === 'winner_post' && <p className="tiny muted mt">🏆 Winner post real leaderboard se top 5 khud utha lega — naame points ke saath.</p>}
      </div>
      {assetOut && (
        <div className="card mb" style={{ maxWidth: 860 }}>
          {Object.entries(assetOut).map(([k, v]) => (
            <CopyBlock key={k} label={k} text={typeof v === 'string' ? v : JSON.stringify(v, null, 2)} />
          ))}
        </div>
      )}
    </div>
  )

  const renderOutreach = () => (
    <div>
      <div className="card mb" style={{ maxWidth: 860 }}>
        <b className="mb" style={{ display: 'block' }}>🏫 School/Coaching outreach sequence</b>
        <div className="field-row">
          <label className="field"><span>Institute name *</span>
            <input className="input" value={reach.instituteName} onChange={set(setReach)('instituteName')} placeholder="Sunrise Academy" />
          </label>
          <label className="field"><span>Type</span>
            <select className="input" value={reach.kind} onChange={set(setReach)('kind')}>
              <option value="coaching">📚 Coaching</option><option value="school">🏫 School</option>
            </select>
          </label>
          <label className="field"><span>City</span>
            <input className="input" value={reach.city} onChange={set(setReach)('city')} placeholder="Jaipur" />
          </label>
          <label className="field"><span>Contact name</span>
            <input className="input" value={reach.contactName} onChange={set(setReach)('contactName')} placeholder="Director Sharma ji" />
          </label>
        </div>
        <label className="field" style={{ maxWidth: 720 }}>
          <span>Notes (jo tum jaante ho — AI usko personalize karega)</span>
          <input className="input" value={reach.notes} onChange={set(setReach)('notes')} placeholder="Unke paas 400 students hain, abhi paper wale app use karte hain" />
        </label>
        <div className="field-row mt">
          <label className="field"><span>Language</span>
            <select className="input" value={reach.language} onChange={set(setReach)('language')}>
              <option value="hinglish">Hinglish</option><option value="english">English</option><option value="hindi">हिंदी</option>
            </select>
          </label>
        </div>
        <button className="btn btn-accent mt" onClick={genOutreach} disabled={busy}>{busy ? 'Generating…' : '✉️ 4-touch sequence + objection sheet banao'}</button>
      </div>
      {outreachOut && (
        <div className="card mb" style={{ maxWidth: 860 }}>
          {(outreachOut.touches || []).map((tch) => (
            <CopyBlock key={tch.n} label={`Touch ${tch.n} · ${tch.channel}${tch.subject ? ` · Subject: ${tch.subject}` : ''}`} text={tch.body || ''} />
          ))}
          {(outreachOut.objection_cheatsheet || []).length > 0 && (
            <>
              <b className="small mt" style={{ display: 'block' }}>🛡️ Objection cheat-sheet</b>
              {outreachOut.objection_cheatsheet.map((o, i) => (
                <p key={i} className="small mb" style={{ marginBottom: 6 }}><b>“{o.objection}”</b><br />{o.reply}</p>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )

  const renderStats = () => (
    <div className="card" style={{ maxWidth: 860 }}>
      <b className="mb" style={{ display: 'block' }}>📊 Rollout snapshot</b>
      {stats ? (
        <div className="grid grid-3">
          {[
            { l: 'Total students', v: stats.totalUsers, i: '👥' },
            { l: 'Signups (7 din)', v: stats.signups7d, i: '📈' },
            { l: 'Active coupons', v: stats.activeCoupons, i: '🎟️' },
            { l: 'Coupon redemptions', v: stats.couponRedemptions, i: '✅' },
            { l: 'Sales chat messages', v: stats.chatCalls, i: '💬' },
            { l: 'Marketing AI calls', v: stats.marketingCalls, i: '🪄' }
          ].map((s) => (
            <div key={s.l} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 26 }}>{s.i}</div>
              <div style={{ fontSize: 28, fontWeight: 800 }}>{s.v}</div>
              <div className="tiny muted">{s.l}</div>
            </div>
          ))}
        </div>
      ) : <Empty title="Loading stats…" />}
      <p className="tiny muted mt">Chat messages = marketing-site widget se aaye conversations. School leads widget par "escalate" karte hi aapko follow-up karna hai — 30 min ke andar reply = conversion double.</p>
    </div>
  )

  return (
    <AdminLayout title="📣 Marketing Studio">
      <p className="muted small mb">
        Aapka AI growth engine — content, outreach aur sales-support, sab aapke existing AI keys par.
        Har cheez <b>review karke</b> post karo; AI draft deta hai, aapki authenticity hi convert karti hai.
      </p>
      <div className="row mb" style={{ gap: 8 }}>
        {TABS.map((t) => (
          <button key={t.id} className={`btn btn-sm ${tab === t.id ? 'btn-accent' : 'btn-ghost'}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
      </div>
      {tab === 'content' && renderCalendar()}
      {tab === 'assets' && renderAssets()}
      {tab === 'outreach' && renderOutreach()}
      {tab === 'stats' && renderStats()}
    </AdminLayout>
  )
}
