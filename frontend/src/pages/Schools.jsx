import React from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { BrandLogo, useBranding } from '../context/BrandingContext.jsx'
import { useLang, LangSwitcher } from '../context/LangContext.jsx'
import SalesChat from '../components/SalesChat.jsx'

// Public sales/presentation page for schools & coaching institutes (B2B white-label).
// Designed to be opened on a projector during a school pitch.
// Every string flows through LangContext t() — EN / Hinglish / हिंदी.
const PILLARS = [
  { icon: '🏫', k: 'pl1' },
  { icon: '📝', k: 'pl2' },
  { icon: '📊', k: 'pl3' },
  { icon: '🛡️', k: 'pl4' }
]

const GURU = [
  { icon: '📚', k: 'g1' },
  { icon: '🎮', k: 'g2' },
  { icon: '👍', k: 'g3' },
  { icon: '🌟', k: 'g4' }
]

const STEPS = [1, 2, 3, 4]
const FAQS = [1, 2, 3, 4, 5]

export default function Schools() {
  const nav = useNavigate()
  const brand = useBranding()
  const { t } = useLang()
  const mailto = `${brand.supportEmail || 'sales@aisepadho.com'}?subject=School%20Pilot%20Request&body=School%20name%3A%20%0ACity%3A%20%0AStudents%20(approx)%3A%20%0APhone%3A%20`

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <BrandLogo />
        <div className="spacer" />
        <LangSwitcher />
        <span className="chip">{t('sch.top.chip')}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => nav('/')}>{t('sch.back')}</button>
      </header>

      <div className="hero">
        <div className="pill mb">
          <span className="chip">{t('sch.chip.wl')}</span>
          <span className="chip">{t('sch.chip.guru')}</span>
          <span className="chip">{t('sch.chip.pilot')}</span>
          <span className="chip">{t('sch.chip.setup')}</span>
        </div>
        <h1>{t('sch.h1a')}<br /><span>{t('sch.h1b')}</span></h1>
        <p>
          {t('sch.hero.p').split('###').map((chunk, i) => i === 1 ? <b key="b">{chunk}</b> : chunk)}
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" style={{ padding: '13px 26px' }} onClick={() => { window.location.href = `mailto:${mailto}` }}>
            {t('cta.pilot')}
          </button>
          <button className="btn btn-ghost" style={{ padding: '13px 26px' }} onClick={() => nav('/register')}>{t('cta.tryfirst')}</button>
        </div>
      </div>

      <div className="content" style={{ maxWidth: 1100 }}>
        <div className="grid grid-4 mb">
          {['exams', 'ai', 'setup', 'pilot'].map((k) => (
            <div key={k} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, fontWeight: 800, background: 'linear-gradient(90deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{t(`sch.num.${k}.v`)}</div>
              <div className="tiny">{t(`sch.num.${k}`)}</div>
            </div>
          ))}
        </div>

        <h2 className="mb" style={{ textAlign: 'center' }}>{t('sch.sec.pillars')}</h2>
        <div className="grid grid-2 mb">
          {PILLARS.map((p) => (
            <div key={p.k} className="card">
              <div className="row mb">
                <span style={{ fontSize: 28 }}>{p.icon}</span>
                <b>{t(`sch.${p.k}.t`)}</b>
              </div>
              <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 2 }}>
                {[1, 2, 3].map((i) => <li key={i}>{t(`sch.${p.k}.p${i}`)}</li>)}
              </ul>
            </div>
          ))}
        </div>

        <h2 className="mb" style={{ textAlign: 'center' }}>{t('sch.sec.guru.a')} <span style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{t('sch.sec.guru.b')}</span></h2>
        <p className="small muted mb" style={{ textAlign: 'center' }}>{t('sch.sec.guru.sub')}</p>
        <div className="grid grid-2 mb">
          {GURU.map((g) => (
            <div key={g.k} className="card" style={{ borderColor: 'rgba(99,102,241,0.4)' }}>
              <div className="row mb">
                <span style={{ fontSize: 28 }}>{g.icon}</span>
                <b>{t(`sch.${g.k}.t`)}</b>
              </div>
              <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 2 }}>
                {[1, 2, 3, 4].map((i) => t(`sch.${g.k}.p${i}`) !== `sch.${g.k}.p${i}` ? <li key={i}>{t(`sch.${g.k}.p${i}`)}</li> : null)}
              </ul>
            </div>
          ))}
        </div>

        <h2 className="mb" style={{ textAlign: 'center' }}>{t('sch.sec.steps')}</h2>
        <div className="grid grid-4 mb">
          {STEPS.map((n) => (
            <div key={n} className="card hover">
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent2))', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>{n}</div>
              <b className="small" style={{ display: 'block', marginBottom: 4 }}>{t(`sch.s${n}.t`)}</b>
              <p className="tiny muted">{t(`sch.s${n}.d`)}</p>
            </div>
          ))}
        </div>

        <div className="card muted-bg mb" style={{ border: 'none' }}>
          <div className="spread">
            <div>
              <b>{t('sch.pricing.t')}</b>
              <p className="small muted mt">
                {t('sch.pricing.d1')}<br />
                {t('sch.pricing.d2')} <b>{t('sch.pricing.free')}</b>.
              </p>
            </div>
            <button className="btn btn-accent" onClick={() => { window.location.href = `mailto:${brand.supportEmail || 'sales@aisepadho.com'}?subject=School%20Pilot%20Request` }}>
              {t('sch.pricing.cta')}
            </button>
          </div>
        </div>

        <div className="card mb" style={{ textAlign: 'center' }}>
          <b className="small">{t('sch.faq.t')}</b>
          <div className="grid grid-2 mt" style={{ textAlign: 'left' }}>
            {FAQS.map((n) => (
              <div key={n}>
                <b className="small">{t(`sch.f${n}.q`)}</b>
                <p className="tiny muted">{t(`sch.f${n}.a`)}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <footer className="tiny muted" style={{ textAlign: 'center', padding: '30px 0 40px' }}>
        {brand.platformName} — {t('sch.foot.tag')} · <a href={`mailto:${brand.supportEmail || 'sales@aisepadho.com'}`}>{brand.supportEmail || 'sales@aisepadho.com'}</a>
        <div className="mt">
          <Link to="/privacy-policy">Privacy Policy</Link> · <Link to="/terms-of-use">Terms of Use</Link> · <Link to="/refund-policy">Refund Policy</Link> · <Link to="/cookie-policy">Cookie Policy</Link>
        </div>
      </footer>
      {/* Sales chat — institute owners ask questions right on the pitch page */}
      <SalesChat />
    </div>
  )
}
