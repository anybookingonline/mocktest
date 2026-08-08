import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../components/ui.jsx'
import { Brand } from '../../components/Layout.jsx'

export function Splash() {
  return (
    <div className="auth-wrap">
      <div className="col" style={{ alignItems: 'center' }}>
        <Brand />
        <div className="spin" style={{ width: 28, height: 28 }} />
      </div>
    </div>
  )
}

export function AuthShell({ children, title, subtitle }) {
  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <Brand />
        <h1 style={{ marginTop: 18 }}>{title}</h1>
        <p className="muted small mb">{subtitle}</p>
        {children}
      </div>
    </div>
  )
}

export function LoginPage() {
  const { login } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const u = await login(email, password)
      toast('Welcome back!', 'ok')
      nav(u.role === 'admin' ? '/admin' : '/')
    } catch (err) {
      toast(err.message, 'err')
    } finally { setBusy(false) }
  }

  return (
    <AuthShell title="Welcome back" subtitle="Log in to continue your preparation">
      <form onSubmit={submit}>
        <label className="field"><span>Email</span>
          <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </label>
        <label className="field"><span>Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        </label>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Logging in…' : 'Log In'}</button>
      </form>
      <div className="row mt" style={{ justifyContent: 'center' }}>
        <span className="tiny">New here?</span>
        <a href="/register" onClick={(e) => { e.preventDefault(); nav('/register') }}>Create account</a>
      </div>
      <hr className="divider" />
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => { setEmail('student@examai.app'); setPassword('student123'); toast('Demo student filled') }}>Demo Student</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setEmail('admin@examai.app'); setPassword('admin123'); toast('Demo admin filled') }}>Demo Admin</button>
      </div>
    </AuthShell>
  )
}

export function RegisterPage() {
  const { register } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [target, setTarget] = useState('JEE Main')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await register(name, email, password, target)
      toast('Account created!', 'ok')
      nav('/')
    } catch (err) {
      toast(err.message, 'err')
    } finally { setBusy(false) }
  }

  return (
    <AuthShell title="Create your account" subtitle="Start free AI-powered practice today">
      <form onSubmit={submit}>
        <label className="field"><span>Full name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field"><span>Email</span>
          <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field"><span>Password</span>
          <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 6 characters" required />
        </label>
        <label className="field"><span>Target exam</span>
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {['JEE Main', 'NEET UG', 'UPSC CSE', 'SSC CGL', 'Banking PO', 'CAT', 'GATE', 'CUET UG'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </label>
        <button className="btn btn-accent" style={{ width: '100%' }} disabled={busy}>{busy ? 'Creating…' : 'Sign Up'}</button>
      </form>
      <div className="row mt" style={{ justifyContent: 'center' }}>
        <span className="tiny">Already registered?</span>
        <a href="/login" onClick={(e) => { e.preventDefault(); nav('/login') }}>Log in</a>
      </div>
    </AuthShell>
  )
}
