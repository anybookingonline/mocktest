import React, { createContext, useContext, useState } from 'react'

// ------------------------------ Toast ---------------------------------
const ToastCtx = createContext(() => {})
export function useToast() { return useContext(ToastCtx) }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const push = (msg, type = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, msg, type }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>{t.msg}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// ------------------------------ Modal ----------------------------------
export function Modal({ open, onClose, title, children, footer }) {
  if (!open) return null
  return (
    <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className="modal">
        {title && <h3 style={{ marginBottom: 16 }}>{title}</h3>}
        <div>{children}</div>
        {footer && <div className="row mt">{footer}</div>}
      </div>
    </div>
  )
}

export function Badge({ kind = 'gray', children }) {
  return <span className={`badge ${kind}`}>{children}</span>
}

export function Progress({ value, kind = '' }) {
  return (
    <div className={`progress ${kind}`}>
      <div style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  )
}

export function Empty({ title = 'Nothing here yet', text }) {
  return (
    <div className="empty">
      <div style={{ fontSize: 36, marginBottom: 10 }}>🔎</div>
      <b>{title}</b>
      {text && <p className="small muted" style={{ marginTop: 6 }}>{text}</p>}
    </div>
  )
}

export function Skeleton({ h = 120 }) {
  return <div className="skeleton" style={{ height: h }} />
}

// ------------------------------ helpers --------------------------------
export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

function parseDate(str) {
  if (!str) return null
  let s = String(str).trim()
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T') + 'Z'
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

export function fmtDate(str) {
  const d = parseDate(str)
  if (!d) return '-'
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function timeAgo(str) {
  const d = parseDate(str)
  if (!d) return '-'
  const diff = (Date.now() - d.getTime()) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function diffBadge(diff) {
  return { easy: 'green', medium: 'amber', hard: 'red' }[diff] || 'gray'
}

export function qTypeLabel(t) {
  return { single: 'MCQ', multiple: 'Multi', numerical: 'Numeric', integer: 'Integer' }[t] || t
}

export function statColor(v, invert = false) {
  if (invert) return v > 60 ? 'red' : v > 35 ? 'amber' : 'green'
  return v >= 75 ? 'green' : v >= 50 ? 'amber' : 'red'
}
