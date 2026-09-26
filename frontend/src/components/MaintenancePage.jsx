import React, { useEffect, useRef, useState } from 'react'
import { BrandLogo, useBranding } from '../context/BrandingContext.jsx'
import { useLang } from '../context/LangContext.jsx'

// Full-screen maintenance landing page. Polls /api/meta/status and hard-
// reloads the moment maintenance lifts, so visitors land back in the live
// app without touching anything. Branded via the same white-label context
// the rest of the app uses (platform name, logo, admin-set copy).
export default function MaintenancePage() {
  const brand = useBranding()
  const { lang, t } = useLang()
  const [status, setStatus] = useState(null)
  const [email, setEmail] = useState('')
  const [notifyState, setNotifyState] = useState('idle') // idle | done | bad
  const [untilTs, setUntilTs] = useState(null)
  const [now, setNow] = useState(Date.now())
  const notifiedRef = useRef(false)

  const check = () =>
    fetch('/api/meta/status', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => {
        setStatus(d)
        if (d && d.enabled === false && !notifiedRef.current) {
          notifiedRef.current = true
          window.location.reload()
        }
      })
      .catch(() => {})

  useEffect(() => {
    check()
    const poll = setInterval(check, 30000)
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => { clearInterval(poll); clearInterval(tick) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Optional ETA: parse "HH:MM" (and "HH:MM AM/PM") into the next occurrence
  // today/tomorrow, then show a live countdown.
  useEffect(() => {
    if (!status?.eta) { setUntilTs(null); return }
    const m = String(status.eta).trim().match(/^(\d{1,2}):(\d{2})\s*(am|pm)?$/i)
    if (!m) { setUntilTs(null); return }
    let h = parseInt(m[1], 10)
    const min = parseInt(m[2], 10)
    const ap = m[3]?.toLowerCase()
    if (ap === 'pm' && h < 12) h += 12
    if (ap === 'am' && h === 12) h = 0
    const target = new Date()
    target.setHours(h, min, 0, 0)
    if (target.getTime() <= Date.now()) target.setDate(target.getDate() + 1)
    setUntilTs(target.getTime())
  }, [status?.eta])

  const isHi = lang === 'hi'
  const pad = (n) => String(n).padStart(2, '0')
  let countdown = null
  if (untilTs) {
    const s = Math.max(0, Math.floor((untilTs - now) / 1000))
    countdown = { h: Math.floor(s / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 }
  }

  const platformName = brand?.platformName || 'Aisepadho'
  const message = status?.message || ''
  const eta = status?.eta || ''

  const submitNotify = (e) => {
    e.preventDefault()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setNotifyState('bad'); return }
    setNotifyState('done')
  }

  const support = (document.querySelector('meta[name="support-email"]')?.content) || ''

  return (
    <div style={{
      minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center',
      background: 'radial-gradient(1200px 600px at 50% -10%, var(--bg2), var(--bg) 60%)', color: 'var(--text)'
    }}>
      {/* soft floating glow */}
      <div aria-hidden style={{
        position: 'fixed', top: '-140px', left: '50%', transform: 'translateX(-50%)',
        width: 520, height: 520, borderRadius: '50%', pointerEvents: 'none',
        background: 'radial-gradient(closest-side, var(--accent-glow, rgba(99,102,241,0.14)), transparent 70%)',
        filter: 'blur(6px)', animation: 'maintFloat 7s ease-in-out infinite'
      }} />

      <div style={{ marginBottom: 22, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <BrandLogo size={44} showName={false} />
      </div>

      <div style={{
        width: 78, height: 78, borderRadius: 24, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 34, background: 'var(--bg2)', border: '1px solid var(--border)', marginBottom: 20,
        animation: 'maintPulse 2.4s ease-in-out infinite'
      }}>🛠️</div>

      <h1 style={{ fontSize: 'clamp(26px, 5vw, 40px)', margin: '0 0 10px', fontWeight: 800, letterSpacing: '-0.5px' }}>
        {t('maint.title')}
      </h1>
      <p style={{ maxWidth: 560, margin: '0 auto 6px', lineHeight: 1.55, color: 'var(--text2, var(--text))', opacity: 0.85 }}>
        {(t('maint.sub') || '').replace('{brand}', platformName)}
      </p>

      {message && (
        <div className="card" style={{ maxWidth: 560, width: '100%', margin: '18px auto 0', padding: '14px 18px', fontSize: 14.5, lineHeight: 1.5 }}>
          {message}
        </div>
      )}

      <div className="row" style={{ justifyContent: 'center', marginTop: 16, flexWrap: 'wrap', gap: 8 }}>
        {eta && <span className="chip" title={t('maint.note')}>⏰ ETA: {eta}</span>}
        <span className="chip">🔒 {isHi ? 'आपका डेटा सुरक्षित है' : 'Aapka data safe hai'}</span>
      </div>

      {countdown && (
        <div className="row" style={{ justifyContent: 'center', marginTop: 18, gap: 10 }}>
          {[['H', countdown.h], ['M', countdown.m], ['S', countdown.s]].map(([u, v]) => (
            <div key={u} style={{
              minWidth: 64, padding: '10px 8px', borderRadius: 12, background: 'var(--bg2)',
              border: '1px solid var(--border)', textAlign: 'center'
            }}>
              <div style={{ fontSize: 22, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{pad(v)}</div>
              <div className="tiny muted">{u}</div>
            </div>
          ))}
        </div>
      )}

      <form onSubmit={submitNotify} style={{ maxWidth: 460, width: '100%', marginTop: 26 }}>
        {notifyState !== 'done' ? (
          <>
            <div className="field-row" style={{ alignItems: 'stretch' }}>
              <input
                className="input" type="email" value={email}
                placeholder={isHi ? 'apna@email.com' : 'apna@email.com'}
                onChange={(e) => { setEmail(e.target.value); if (notifyState === 'bad') setNotifyState('idle') }}
                style={{ flex: 1 }}
              />
              <button className="btn btn-primary" type="submit">{t('maint.cta')}</button>
            </div>
            {notifyState === 'bad' && <p className="tiny" style={{ color: '#f87171', marginTop: 8 }}>{t('maint.badEmail')}</p>}
          </>
        ) : (
          <div className="card" style={{ padding: '12px 16px', fontSize: 14 }}>✅ {t('maint.thanks')}</div>
        )}
      </form>

      <p className="tiny muted" style={{ marginTop: 26, opacity: 0.7 }}>
        {t('maint.pending')}
      </p>
      {/* Staff escape hatch: owner/admin can always sign in during maintenance.
          Deliberately unobtrusive — students won't notice or use it. */}
      <a href="/admin-login" className="tiny muted" style={{ marginTop: 10, opacity: 0.55, textDecoration: 'underline dotted' }}>
        {t('maint.staffLogin')}
      </a>
      <p className="tiny muted" style={{ marginTop: 6, opacity: 0.6 }}>
        {t('maint.contact')} {support ? <a href={`mailto:${support}`}>{support}</a> : <a href="mailto:support@aisepadho.com">support@aisepadho.com</a>}
      </p>

      <style>{`
        @keyframes maintPulse { 0%,100% { transform: scale(1); box-shadow: 0 0 0 0 var(--accent-glow, rgba(99,102,241,0.14)); } 50% { transform: scale(1.05); box-shadow: 0 0 0 14px transparent; } }
        @keyframes maintFloat { 0%,100% { transform: translateX(-50%) translateY(0); } 50% { transform: translateX(-50%) translateY(14px); } }
      `}</style>
    </div>
  )
}
