import React, { useEffect, useState } from 'react'
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom'
import { useAuth } from '../../context/AuthContext.jsx'
import { useToast } from '../../components/ui.jsx'
import { Brand } from '../../components/Layout.jsx'
import { useLang, LangSwitcher } from '../../context/LangContext.jsx'
import { api } from '../../api/client.js'

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
      {/* Language switcher — logged-out users bhi EN/Hinglish/हिं choose kar sakte hain */}
      <div style={{ position: 'fixed', top: 14, right: 14, zIndex: 50 }}>
        <LangSwitcher />
      </div>
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
  const { t } = useLang()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const u = await login(email, password)
      toast(t('auth.toast.welcome'), 'ok')
      nav(u.role === 'admin' ? '/admin' : '/')
    } catch (err) {
      toast(err.message, 'err')
    } finally { setBusy(false) }
  }

  return (
    <AuthShell title={t('auth.login.t')} subtitle={t('auth.login.s')}>
      <form onSubmit={submit}>
        <label className="field"><span>{t('auth.email')}</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </label>
        <label className="field"><span>{t('auth.password')}</span>
          <input className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        </label>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? t('auth.logging') : t('auth.login.btn')}</button>
      </form>
      <div className="row mt" style={{ justifyContent: 'center' }}>
        <span className="tiny">{t('auth.newhere')}</span>
        <a href="/register" onClick={(e) => { e.preventDefault(); nav('/register') }}>{t('auth.create')}</a>
      </div>
      <div className="row mt" style={{ justifyContent: 'center' }}>
        <a href="/forgot-password" className="tiny muted" onClick={(e) => { e.preventDefault(); nav('/forgot-password') }}>Password bhool gaye?</a>
      </div>
    </AuthShell>
  )
}

export function ForgotPasswordPage() {
  const toast = useToast()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const d = await api.post('/auth/forgot-password', { email })
      toast(d.message || 'Reset code bhej diya gaya — email check karo', 'ok')
      nav('/reset-password', { state: { email } })
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }

  return (
    <AuthShell title="Password reset" subtitle="Registered email par 6-digit code aayega">
      <form onSubmit={submit}>
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required />
        </label>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Bhej rahe hain…' : 'Reset code bhejo'}</button>
      </form>
      <div className="row mt" style={{ justifyContent: 'center' }}>
        <a href="/login" className="tiny" onClick={(e) => { e.preventDefault(); nav('/login') }}>← Login par wapas</a>
      </div>
    </AuthShell>
  )
}

export function ResetPasswordPage() {
  const toast = useToast()
  const nav = useNavigate()
  const loc = useLocation()
  const [email, setEmail] = useState(loc.state?.email || '')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const d = await api.post('/auth/reset-password', { email, code, password })
      toast(d.message || 'Password updated', 'ok')
      nav('/login')
    } catch (err) { toast(err.message, 'err') } finally { setBusy(false) }
  }

  return (
    <AuthShell title="Naya password set karo" subtitle="Email par aaya 6-digit code daalo">
      <form onSubmit={submit}>
        <label className="field"><span>Email</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field"><span>Reset code (6 digits)</span>
          <input className="input" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} placeholder="••••••" required />
        </label>
        <label className="field"><span>Naya password</span>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="min 6 characters" required />
        </label>
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Saving…' : 'Password reset karo'}</button>
      </form>
    </AuthShell>
  )
}

export function VerifyEmailPage() {
  const [params] = useSearchParams()
  const status = params.get('status')
  const nav = useNavigate()
  const ok = status === 'ok'
  return (
    <AuthShell title={ok ? 'Email verified ✅' : 'Verification fail'} subtitle={ok ? 'Ab aapka email confirm ho gaya' : 'Link invalid ya expire ho gaya'}>
      <div style={{ textAlign: 'center', fontSize: 46 }}>{ok ? '🎉' : '⚠️'}</div>
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 8 }} onClick={() => nav('/')}>Aisepadho kholo</button>
    </AuthShell>
  )
}

export function RegisterPage() {
  const { register } = useAuth()
  const toast = useToast()
  const nav = useNavigate()
  const { t } = useLang()
  const [params] = useSearchParams()
  const schCode = params.get('sch') || ''
  const [invite, setInvite] = useState(null) // { institute: { name } }
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [target, setTarget] = useState('JEE Main')
  const [targetOptions, setTargetOptions] = useState(['JEE Main', 'NEET UG', 'UPSC CSE', 'SSC CGL', 'Banking PO', 'CAT', 'GATE', 'CUET UG'])
  const [inviteCode, setInviteCode] = useState(schCode)
  const [busy, setBusy] = useState(false)

  // White-label B2B: /register?sch=SCH-XXXX validates the institute invite
  // code up-front and shows the student which institute they're joining.
  useEffect(() => {
    // Admin-created exams (school classes, coaching batches) appear automatically;
    // seed fallback keeps signup working even if the API is unreachable.
    api.get('/exams').then((d) => {
      const names = (d.exams || []).filter((e) => e.is_active).map((e) => e.name)
      if (names.length) {
        setTargetOptions(names)
        setTarget((cur) => (names.includes(cur) ? cur : names[0]))
      }
    }).catch(() => {})
    if (!schCode) return
    api.get(`/institutes/public/invite?code=${encodeURIComponent(schCode)}`)
      .then((d) => setInvite(d))
      .catch(() => setInvite({ valid: false }))
  }, [schCode])

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await register(name, email, password, target, inviteCode.trim() || undefined)
      toast(t('auth.toast.created'), 'ok')
      nav('/')
    } catch (err) {
      toast(err.message, 'err')
    } finally { setBusy(false) }
  }

  return (
    <AuthShell title={t('auth.reg.t')} subtitle={t('auth.reg.s')}>
      {schCode && invite && (
        <div className="mb" style={{ padding: '10px 14px', borderRadius: 10, border: `1px solid ${invite.valid ? 'var(--green)' : 'var(--red)'}`, background: 'var(--bg2)' }}>
          {invite.valid
            ? <span className="small">{t('auth.joining').replace('{inst}', invite.institute.name)}</span>
            : <span className="small" style={{ color: 'var(--red)' }}>{t('auth.invite.bad')}</span>}
        </div>
      )}
      <form onSubmit={submit}>
        <label className="field"><span>{t('auth.name')}</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field"><span>{t('auth.email')}</span>
          <input className="input" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label className="field"><span>{t('auth.password')}</span>
          <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('auth.min6')} required />
        </label>
        <label className="field"><span>{t('auth.target')}</span>
          <select className="select" value={target} onChange={(e) => setTarget(e.target.value)}>
            {targetOptions.map((x) => <option key={x}>{x}</option>)}
</select>
        </label>
        {!schCode && (
          <label className="field"><span>{t('auth.invite')}</span>
            <input className="input" value={inviteCode} onChange={(e) => setInviteCode(e.target.value)} placeholder="SCH-XXXX" />
          </label>
        )}
        <button className="btn btn-accent" style={{ width: '100%' }} disabled={busy}>{busy ? t('auth.creating') : t('auth.signup')}</button>
      </form>
      <div className="row mt" style={{ justifyContent: 'center' }}>
        <span className="tiny">{t('auth.already')}</span>
        <a href="/login" onClick={(e) => { e.preventDefault(); nav('/login') }}>{t('auth.login.btn')}</a>
      </div>
    </AuthShell>
  )
}
