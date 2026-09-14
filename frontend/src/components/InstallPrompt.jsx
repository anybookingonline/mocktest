import React, { useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// PWA install experience.
// - Android/Chrome: the browser fires `beforeinstallprompt`; we capture it and
//   show a native-feeling card with an Install button. Auto-appears on mobile
//   a few seconds after landing, so students get the "add to home screen"
//   nudge without anyone hunting through browser menus.
// - iOS Safari: no prompt API exists; show a one-time hint explaining the
//   Share → "Add to Home Screen" flow.
// - Dismissed state persists in localStorage (re-asks after 14 days).
// ---------------------------------------------------------------------------
const DISMISS_KEY = 'pwa-install-dismissed'
const REASK_DAYS = 14
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [showIosHint, setShowIosHint] = useState(false)
  const [installed, setInstalled] = useState(false)

  useEffect(() => {
    if (isStandalone()) return // already installed — never nag
    const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0)
    const dismissedRecently = dismissedAt && Date.now() - dismissedAt < REASK_DAYS * 86400000

    const onPrompt = (e) => {
      e.preventDefault()
      setDeferred(e)
    }
    const onInstalled = () => { setInstalled(true); setDeferred(null); setShowIosHint(false) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)

    const ua = window.navigator.userAgent || ''
    const isIos = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios/i.test(ua)
    const timer = setTimeout(() => {
      if (dismissedRecently) return
      if (isIos) setShowIosHint(true)
      // Android: the card renders as soon as `deferred` arrives — usually
      // within the first seconds of the session.
    }, 4000)

    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
      clearTimeout(timer)
    }
  }, [])

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()))
    setDeferred(null)
    setShowIosHint(false)
  }

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice?.catch(() => {})
    setDeferred(null)
  }

  if (installed) return null

  if (deferred) {
    return (
      <div className="card" style={{
        position: 'fixed', bottom: 16, left: 16, right: 16, maxWidth: 420, zIndex: 60,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)', border: '1px solid rgba(99,102,241,0.4)'
      }}>
        <div className="spread">
          <div className="row" style={{ gap: 12 }}>
            <img src="/icon-192.png" alt="Aisepadho" width={44} height={44} style={{ borderRadius: 10 }} />
            <div>
              <b className="small">Aisepadho app install karo</b>
              <div className="tiny muted">Offline revision, faster loading, home-screen shortcut.</div>
            </div>
          </div>
        </div>
        <div className="row mt" style={{ justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>Abhi nahi</button>
          <button className="btn btn-primary btn-sm" onClick={install}>📲 Install</button>
        </div>
      </div>
    )
  }

  if (showIosHint) {
    return (
      <div className="card" style={{
        position: 'fixed', bottom: 16, left: 16, right: 16, maxWidth: 420, zIndex: 60,
        boxShadow: '0 12px 40px rgba(0,0,0,0.45)', border: '1px solid rgba(99,102,241,0.4)'
      }}>
        <div className="row" style={{ gap: 12 }}>
          <img src="/apple-touch-icon.png" alt="Aisepadho" width={44} height={44} style={{ borderRadius: 10 }} />
          <div>
            <b className="small">iPhone/iPad? Home screen par add karo</b>
            <div className="tiny muted">Safari me <b>Share ⬆️</b> → <b>"Add to Home Screen"</b> dabao — app ki tarah khulega.</div>
          </div>
        </div>
        <div className="row mt" style={{ justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={dismiss}>Samajh gaya</button>
        </div>
      </div>
    )
  }

  return null
}
