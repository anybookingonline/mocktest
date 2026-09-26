import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { BrandLogo } from '../../context/BrandingContext.jsx'
import { ToastProvider } from '../../components/ui.jsx'

// Dedicated admin login — reachable even while maintenance mode is ON.
// Deliberately hardcoded in ENGLISH (owner-facing ops page, not student UX),
// and kept outside the normal language switching on purpose.
function InnerAdminLogin() {
  const { login } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const u = await login(email, password)
      nav(u.role === 'admin' ? '/admin' : '/')
    } catch (err) {
      setError(err.message || 'Login failed')
    } finally { setBusy(false) }
  }

  return (
    <div style={{
      minHeight: '100vh', width: '100%', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', padding: 24,
      background: 'radial-gradient(1200px 600px at 50% -10%, var(--bg2), var(--bg) 60%)', color: 'var(--text)'
    }}>
      <div style={{ marginBottom: 24 }}><BrandLogo size={36} /></div>

      <div className="card" style={{ width: '100%', maxWidth: 380, padding: 28 }}>
        <h1 style={{ fontSize: 22, margin: '0 0 4px', fontWeight: 800 }}>Staff Login</h1>
        <p className="tiny muted" style={{ margin: '0 0 18px' }}>
          Owner &amp; admin access — works during maintenance mode. Students cannot log in here.
        </p>

        <form onSubmit={submit}>
          <label className="field"><span>Email</span>
            <input className="input" type="email" autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="admin@aisepadho.com" required autoFocus />
          </label>
          <label className="field"><span>Password</span>
            <input className="input" type="password" autoComplete="current-password" value={password}
              onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
          </label>
          {error && <p className="tiny" style={{ color: 'var(--red)', marginTop: 8 }}>{error}</p>}
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in to Admin'}
          </button>
        </form>

        <p className="tiny muted" style={{ margin: '14px 0 0', textAlign: 'center' }}>
          After login, maintenance can be turned OFF in Admin → Settings.
        </p>
      </div>
    </div>
  )
}

export default function AdminLogin() {
  return <ToastProvider><InnerAdminLogin /></ToastProvider>
}
