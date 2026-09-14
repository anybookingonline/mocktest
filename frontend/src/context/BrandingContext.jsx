import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

// ---------------------------------------------------------------------------
// White-label branding. One public API call resolves everything:
//   - platform admin's branding  (Settings → platform.name/tagline/logo/domain)
//   - OR an institute's branding (custom domain, or ?sch=INVITE on the shared
//     domain — e.g. a student opening a coaching's invite link)
// Anything rendered from here rebrands automatically when the admin saves.
// ---------------------------------------------------------------------------

const Ctx = createContext({ platformName: 'Aisepadho', tagline: 'Padho. Test do. Aage badho.' })

function hexToRgba(hex, alpha) {
  try {
    const h = String(hex).replace('#', '')
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null
    const n = parseInt(h, 16)
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`
  } catch { return null }
}

export function BrandingProvider({ children }) {
  const [branding, setBranding] = useState({ platformName: 'Aisepadho', tagline: 'Padho. Test do. Aage badho.' })

  const apply = useCallback((b) => {
    if (!b) return
    setBranding((prev) => ({ ...prev, ...b }))
    // Document title — the single most visible brand surface
    document.title = `${b.platformName || 'Aisepadho'} — ${b.tagline || 'AI-Powered Test Practice'}`
    // Favicon / logo
    try {
      const link = document.querySelector("link[rel~='icon']") || document.createElement('link')
      link.rel = 'icon'
      link.href = b.logoUrl || '/icon.svg'
      document.head.appendChild(link)
    } catch { /* SSR-less SPA, ignore */ }
    // Institute color overrides → CSS variables used by the whole stylesheet
    if (b.primaryColor) {
      document.documentElement.style.setProperty('--accent', b.primaryColor)
      const glow = hexToRgba(b.primaryColor, 0.14)
      if (glow) document.documentElement.style.setProperty('--accent-glow', glow)
    }
    if (b.accentColor) document.documentElement.style.setProperty('--accent2', b.accentColor)
  }, [])

  useEffect(() => {
    let live = true
    const params = new URLSearchParams(window.location.search)
    const sch = params.get('sch')
    const url = '/api/institutes/public/branding' + (sch ? `?sch=${encodeURIComponent(sch)}` : '')
    fetch(url).then((r) => r.json()).then((d) => { if (live) apply(d) }).catch(() => {})
    return () => { live = false }
  }, [apply])

  return <Ctx.Provider value={branding}>{children}</Ctx.Provider>
}

export function useBranding() {
  return useContext(Ctx)
}

// Big white-label friendly logo: institute/platform logo image when set,
// otherwise the built-in shield mark + brand name.
export function BrandLogo({ size = 34, showName = true }) {
  const b = useBranding()
  const name = b.platformName || 'Aisepadho'
  const [first, rest] = [name.charAt(0), name.slice(1)]
  return (
    <>
      {b.logoUrl
        ? <img src={b.logoUrl} alt={name} style={{ width: size, height: size, borderRadius: 9, objectFit: 'cover' }} />
        : (
          <svg viewBox="0 0 512 512" width={size} height={size}>
            <defs>
              <linearGradient id="brandg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="var(--accent, #6366f1)" />
                <stop offset="1" stopColor="var(--accent2, #22d3ee)" />
              </linearGradient>
            </defs>
            <rect width="512" height="512" rx="112" fill="#121a30" />
            <circle cx="256" cy="256" r="150" fill="url(#brandg)" opacity="0.92" />
            <path d="M256 150l92 54v108l-92 54-92-54V204z" fill="none" stroke="#0b0f1a" strokeWidth="16" strokeLinejoin="round" />
            <path d="M196 266l44 44 80-92" fill="none" stroke="#0b0f1a" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      {showName && <span>{first}<b>{rest}</b></span>}
    </>
  )
}
