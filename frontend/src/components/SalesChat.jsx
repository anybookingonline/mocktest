import React, { useEffect, useRef, useState } from 'react'
import { useBranding } from '../context/BrandingContext.jsx'

// ---------------------------------------------------------------------------
// Public sales-support chat bubble for the marketing site (Landing + Schools).
// Floats bottom-right; talks to /api/marketing/chat (rate-limited, no auth).
// Mirrors the visitor's language, never invents prices (server injects facts).
// White-label: the header name follows the resolved branding (platform name
// via Settings, or the institute's branding on their domain / ?sch= invite).
// ---------------------------------------------------------------------------

const GREETING = { role: 'assistant', content: 'Namaste! 👋 Main aapki kaise help kar sakta hoon — fees, free trial, coupon codes, ya school ke liye plan?', quick: ['Fees kitni hai?', 'Free trial?', 'School/coaching plan?'] }

export default function SalesChat() {
  const { platformName } = useBranding()
  const [open, setOpen] = useState(false)
  const [msgs, setMsgs] = useState([GREETING])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [unread, setUnread] = useState(true)
  const endRef = useRef(null)

  useEffect(() => { if (open && endRef.current) endRef.current.scrollIntoView({ behavior: 'smooth' }) }, [msgs, open])

  const send = async (text) => {
    const content = String(text || '').trim()
    if (!content || busy) return
    const next = [...msgs, { role: 'user', content }]
    setMsgs(next)
    setInput('')
    setBusy(true)
    try {
      const r = await fetch('/api/marketing/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next.slice(1).map(({ role, content: c }) => ({ role, content: c })) })
      })
      const d = await r.json()
      setMsgs((m) => [...m, { role: 'assistant', content: d.reply || d.error || 'Thodi dikkat — dobara try karo 😊', quick: d.quick || [], escalate: Boolean(d.escalate) }])
    } catch {
      setMsgs((m) => [...m, { role: 'assistant', content: 'Network issue lag raha hai — thodi der baad try karo 😊', quick: [] }])
    }
    setBusy(false)
  }

  const last = msgs[msgs.length - 1]

  return (
    <>
      {/* Launcher bubble */}
      {!open && (
        <button
          onClick={() => { setOpen(true); setUnread(false) }}
          aria-label="Chat with sales support"
          style={{
            position: 'fixed', bottom: 'calc(16px + env(safe-area-inset-bottom, 0px))', right: 'calc(16px + env(safe-area-inset-right, 0px))', zIndex: 60,
            width: 56, height: 56, borderRadius: '50%', border: 'none',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff',
            fontSize: 24, cursor: 'pointer', boxShadow: '0 8px 24px rgba(99,102,241,.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          💬
          {unread && <span style={{ position: 'absolute', top: -2, right: -2, width: 14, height: 14, borderRadius: '50%', background: '#ef4444', border: '2px solid #fff' }} />}
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div style={{
          position: 'fixed', bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', right: 'calc(12px + env(safe-area-inset-right, 0px))', left: 'auto', zIndex: 60,
          // Hard clamp inside the visual viewport: never wider/taller than what's
          // on screen (100dvh for PWA standalone + iOS URL-bar behavior), so the
          // helper can never push the page into horizontal scroll or sit off-screen.
          width: 'min(360px, calc(100vw - 24px))', maxWidth: 'calc(100vw - 24px)',
          height: 'min(520px, calc(100dvh - 88px))', maxHeight: 'calc(100dvh - 88px)',
          background: 'var(--panel, #111827)', border: '1px solid var(--border, #273049)',
          borderRadius: 16, boxShadow: '0 16px 48px rgba(0,0,0,.45)',
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
          // long words / URLs inside messages can't blow out the panel width
          wordBreak: 'break-word', overflowWrap: 'anywhere'
        }}>
          {/* Header */}
          <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border, #273049)', display: 'flex', alignItems: 'center', gap: 10, background: 'linear-gradient(135deg, rgba(99,102,241,.15), rgba(139,92,246,.15))' }}>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>🤖</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, fontSize: 14 }}>{platformName || 'Aisepadho'} Helper</div>
              <div className="tiny muted" style={{ fontSize: 11 }}>Sales & support · online</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close chat" style={{ background: 'none', border: 'none', color: 'var(--muted, #94a3b8)', fontSize: 18, cursor: 'pointer' }}>✕</button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '85%' }}>
              <div style={{
                padding: '9px 13px', borderRadius: 14, fontSize: 13.5, lineHeight: 1.5,
                background: m.role === 'user' ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'var(--bg, #0b0f1a)',
                color: m.role === 'user' ? '#fff' : 'var(--text, #e5e7eb)',
                border: m.role === 'user' ? 'none' : '1px solid var(--border, #273049)',
                borderBottomRightRadius: m.role === 'user' ? 4 : 14,
                borderBottomLeftRadius: m.role === 'user' ? 14 : 4,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowWrap: 'anywhere'
              }}>{m.content}</div>
                {m.escalate && (
                  <div className="tiny" style={{ marginTop: 6, padding: '6px 10px', borderRadius: 10, background: 'rgba(16,185,129,.12)', border: '1px solid rgba(16,185,129,.35)', fontSize: 11.5 }}>
                    ✅ School lead captured — humari team aapko 24 ghante me contact karegi.
                  </div>
                )}
                {m.role === 'assistant' && (m.quick || []).length > 0 && i === msgs.length - 1 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                    {m.quick.map((q) => (
                      <button key={q} onClick={() => send(q)} style={{
                        fontSize: 12, padding: '5px 11px', borderRadius: 999, cursor: 'pointer',
                        background: 'transparent', border: '1px solid var(--border, #273049)', color: 'var(--text, #e5e7eb)'
                      }}>{q}</button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="tiny muted" style={{ alignSelf: 'flex-start' }}>typing…</div>}
            <div ref={endRef} />
          </div>

          {/* Input */}
          <div style={{ padding: 10, borderTop: '1px solid var(--border, #273049)', display: 'flex', gap: 8 }}>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') send(input) }}
              placeholder="Apna sawal likho…"
              style={{ flex: 1, minWidth: 0, background: 'var(--bg, #0b0f1a)', border: '1px solid var(--border, #273049)', borderRadius: 10, padding: '9px 12px', color: 'var(--text, #e5e7eb)', fontSize: 13.5, outline: 'none' }}
            />
            <button onClick={() => send(input)} disabled={busy || !input.trim()} aria-label="Send message" style={{
              width: 38, borderRadius: 10, border: 'none', cursor: 'pointer',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)', color: '#fff', fontSize: 15
            }}>➤</button>
          </div>
        </div>
      )}
    </>
  )
}
