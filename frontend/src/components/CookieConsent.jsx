import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

// ---------------------------------------------------------------------------
// Cookie / local-storage consent banner. The app itself only uses local
// storage for essential things today (auth token, language) — no third-party
// tracking cookies are set. This still records the visitor's choice (as the
// Cookie Policy promises) so that if/when a non-essential tracker (ads,
// analytics) is ever added, it can check hasCookieConsent('nonEssential')
// before doing anything.
// ---------------------------------------------------------------------------

const KEY = 'aisepadho_cookie_consent'

export function getCookieConsent() {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

export function hasCookieConsent(kind = 'nonEssential') {
  const c = getCookieConsent()
  if (!c) return false
  return kind === 'essential' ? true : c.choice === 'all'
}

function saveConsent(choice) {
  try { localStorage.setItem(KEY, JSON.stringify({ choice, at: new Date().toISOString() })) } catch { /* storage blocked */ }
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setVisible(!getCookieConsent())
    // "Manage cookie preferences" links (footer) fire this to reopen the banner.
    const reopen = () => setVisible(true)
    window.addEventListener('cookie-consent:manage', reopen)
    return () => window.removeEventListener('cookie-consent:manage', reopen)
  }, [])

  if (!visible) return null

  const choose = (choice) => { saveConsent(choice); setVisible(false) }

  return (
    <div role="dialog" aria-label="Cookie preferences" style={{
      position: 'fixed', left: 12, right: 12, bottom: 12, zIndex: 200,
      maxWidth: 640, margin: '0 auto',
      background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 14,
      boxShadow: '0 10px 30px rgba(0,0,0,0.35)', padding: '16px 18px'
    }}>
      <p className="small" style={{ margin: 0, lineHeight: 1.6 }}>
        🍪 We use your browser's local storage for essential things like staying signed in. If we ever add optional analytics or ads, we'll only switch them on if you choose "Accept all".{' '}
        <Link to="/cookie-policy">Cookie Policy</Link>
      </p>
      <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-ghost btn-sm" onClick={() => choose('essential')}>Essential only</button>
        <button className="btn btn-accent btn-sm" onClick={() => choose('all')}>Accept all</button>
      </div>
    </div>
  )
}
