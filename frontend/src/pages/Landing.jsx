import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { BrandLogo, useBranding } from '../context/BrandingContext.jsx'
import { useLang, LangSwitcher } from '../context/LangContext.jsx'

const EXAMS = [
  { code: 'JEE-MAIN', icon: '⚙️', label: 'JEE Main', noteKey: 'ex.jee' },
  { code: 'NEET', icon: '🧬', label: 'NEET UG', noteKey: 'ex.neet' },
  { code: 'UPSC-CSE', icon: '🏛️', label: 'UPSC CSE', noteKey: 'ex.upsc' },
  { code: 'SSC-CGL', icon: '📚', label: 'SSC CGL', noteKey: 'ex.ssc' },
  { code: 'BANK-PO', icon: '🏦', label: 'Banking PO', noteKey: 'ex.bank' },
  { code: 'CAT', icon: '🐱', label: 'CAT', noteKey: 'ex.cat' },
  { code: 'GATE', icon: '🔧', label: 'GATE', noteKey: 'ex.gate' },
  { code: 'CUET', icon: '🎓', label: 'CUET UG', noteKey: 'ex.cuet' }
]

// Core features (originals) — all copy lives in LangContext per language
const FEATURES = [
  { icon: '🤖', titleKey: 'cf.qbank.t', textKey: 'cf.qbank.d' },
  { icon: '📄', titleKey: 'cf.pyq.t', textKey: 'cf.pyq.d' },
  { icon: '⏱️', titleKey: 'cf.sim.t', textKey: 'cf.sim.d' },
  { icon: '💡', titleKey: 'cf.doubt.t', textKey: 'cf.doubt.d' },
  { icon: '🧠', titleKey: 'cf.adaptive.t', textKey: 'cf.adaptive.d' },
  { icon: '📈', titleKey: 'cf.analytics.t', textKey: 'cf.analytics.d' }
]

// NEW — the engagement & social layer (Phase 4 highlights)
const NEW_FEATURES = [
  { icon: '⚔️', titleKey: 'nf.battles.t', textKey: 'nf.battles.d', tag: 'NEW' },
  { icon: '👥', titleKey: 'nf.groups.t', textKey: 'nf.groups.d', tag: 'NEW' },
  { icon: '🔥', titleKey: 'nf.focus.t', textKey: 'nf.focus.d', tag: 'NEW' },
  { icon: '🔁', titleKey: 'nf.revision.t', textKey: 'nf.revision.d', tag: 'NEW' },
  { icon: '🎯', titleKey: 'nf.loop.t', textKey: 'nf.loop.d', tag: 'NEW' },
  { icon: '🇮🇳', titleKey: 'nf.air.t', textKey: 'nf.air.d', tag: 'NEW' },
  { icon: '📰', titleKey: 'nf.ca.t', textKey: 'nf.ca.d', tag: 'NEW' },
  { icon: '💬', titleKey: 'nf.tg.t', textKey: 'nf.tg.d', tag: 'NEW' },
  { icon: '📲', titleKey: 'nf.pwa.t', textKey: 'nf.pwa.d', tag: 'NEW' }
]

// Power-ups — optional paid add-ons (pricing admin-controlled, so never hardcoded here)
const POWERUPS = [
  { icon: '⚡', titleKey: 'pu.power.t', textKey: 'pu.power.d' },
  { icon: '🎙️', titleKey: 'pu.voice.t', textKey: 'pu.voice.d' },
  { icon: '📰', titleKey: 'pu.ca.t', textKey: 'pu.ca.d' },
  { icon: '🔥', titleKey: 'pu.focus.t', textKey: 'pu.focus.d' }
]

export default function Landing() {
  const nav = useNavigate()
  const brand = useBranding()
  const { t } = useLang()
  const tagline = brand.tagline || 'Padho. Test do. Aage badho.'
  const [stats, setStats] = useState(null)

  useEffect(() => {
    api.get('/health').then((d) => setStats({ questions: d.questions })).catch(() => {})
  }, [])

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <BrandLogo />
        <div className="spacer" />
        <LangSwitcher />
        <button className="btn btn-ghost btn-sm" onClick={() => nav('/login')}>{t('cta.login')}</button>
        <button className="btn btn-primary btn-sm" onClick={() => nav('/register')}>{t('cta.signup')}</button>
      </header>

      <div className="hero">
        <div className="pill mb">
          {stats ? <span className="chip">{stats.questions}+ {t('chip.qready')}</span> : null}
          <span className="chip">{t('chip.exams')}</span>
          <span className="chip">{t('chip.social')}</span>
          <span className="chip">{t('chip.ca')}</span>
          <span className="chip">{t('chip.tg')}</span>
        </div>
        <h1>{t('hero.h1a')}<br /><span>{t('hero.h1b')}</span></h1>
        <p>{tagline}. {t('hero.sub')}</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" style={{ padding: '13px 26px' }} onClick={() => nav('/register')}>{t('cta.start')}</button>
          <button className="btn btn-ghost" style={{ padding: '13px 26px' }} onClick={() => nav('/schools')}>{t('cta.schools')}</button>
        </div>
      </div>

      <div className="content" style={{ maxWidth: 1100 }}>
        <div className="grid grid-4 mb">
          {EXAMS.map((e) => (
            <div key={e.code} className="card hover" onClick={() => nav('/register')} style={{ cursor: 'pointer', textAlign: 'center' }}>
              <div style={{ fontSize: 30 }}>{e.icon}</div>
              <b style={{ display: 'block', marginTop: 6 }}>{e.label}</b>
              <div className="tiny">{t(e.noteKey)}</div>
            </div>
          ))}
        </div>

        {/* NEW features first — bigger cards with tag */}
        <h2 className="mb" style={{ textAlign: 'center' }}>{t('hero.new')} <span style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{t('sec.new.b')}</span></h2>
        <div className="grid grid-3 mb">
          {NEW_FEATURES.map((f) => (
            <div key={f.titleKey} className="card" style={{ borderColor: 'rgba(99,102,241,0.4)' }}>
              <div className="spread mb" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 26 }}>{f.icon}</span>
                <span className="badge purple">{f.tag}</span>
              </div>
              <b>{t(f.titleKey)}</b>
              <p className="small muted" style={{ marginTop: 6 }}>{t(f.textKey)}</p>
            </div>
          ))}
        </div>

        <h2 className="mb" style={{ textAlign: 'center' }}>{t('hero.core')}</h2>
        <div className="grid grid-3 mb">
          {FEATURES.map((f) => (
            <div key={f.titleKey} className="card">
              <div style={{ fontSize: 26, marginBottom: 8 }}>{f.icon}</div>
              <b>{t(f.titleKey)}</b>
              <p className="small muted" style={{ marginTop: 6 }}>{t(f.textKey)}</p>
            </div>
          ))}
        </div>

        {/* Power-ups — optional add-ons */}
        <h2 className="mb" style={{ textAlign: 'center' }}>{t('sec.power.a')} <span style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{t('cta.powerups')}</span></h2>
        <p className="small muted mb" style={{ textAlign: 'center' }}>{t('sec.power.sub')}</p>
        <div className="grid grid-4 mb">
          {POWERUPS.map((p) => (
            <div key={p.titleKey} className="card">
              <div style={{ fontSize: 24 }}>{p.icon}</div>
              <b className="small" style={{ display: 'block', marginTop: 6 }}>{t(p.titleKey)}</b>
              <p className="tiny muted" style={{ marginTop: 6 }}>{t(p.textKey)}</p>
            </div>
          ))}
        </div>

        {/* Social proof strip — engagement mechanics */}
        <div className="card muted-bg mb" style={{ border: 'none' }}>
          <div className="grid grid-3" style={{ textAlign: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 28 }}>⭐</div>
              <b className="small">{t('sp.points.t')}</b>
              <p className="tiny muted">{t('sp.points.d')}</p>
            </div>
            <div>
              <div style={{ fontSize: 28 }}>🏆</div>
              <b className="small">{t('sp.lb.t')}</b>
              <p className="tiny muted">{t('sp.lb.d')}</p>
            </div>
            <div>
              <div style={{ fontSize: 28 }}>🎁</div>
              <b className="small">{t('sp.deals.t')}</b>
              <p className="tiny muted">{t('sp.deals.d')}</p>
            </div>
          </div>
        </div>

        <div className="card muted-bg mb" style={{ border: 'none', textAlign: 'center' }}>
          <b>{t('b2b.title').replace('{brand}', brand.platformName || 'Aisepadho')}</b>
          <p className="small muted mt">{t('b2b.sub')}</p>
          <div className="row mt" style={{ justifyContent: 'center' }}>
            <button className="btn btn-accent" onClick={() => nav('/schools')}>🏫 {t('cta.guruline')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
