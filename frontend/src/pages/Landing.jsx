import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { BrandLogo, useBranding } from '../context/BrandingContext.jsx'
import { useLang, LangSwitcher } from '../context/LangContext.jsx'

const EXAMS = [
  { code: 'JEE-MAIN', icon: '⚙️', label: 'JEE Main', note: 'Engineering' },
  { code: 'NEET', icon: '🧬', label: 'NEET UG', note: 'Medical' },
  { code: 'UPSC-CSE', icon: '🏛️', label: 'UPSC CSE', note: 'Civil Services' },
  { code: 'SSC-CGL', icon: '📚', label: 'SSC CGL', note: 'Staff Selection' },
  { code: 'BANK-PO', icon: '🏦', label: 'Banking PO', note: 'IBPS / SBI' },
  { code: 'CAT', icon: '🐱', label: 'CAT', note: 'MBA Entrance' },
  { code: 'GATE', icon: '🔧', label: 'GATE', note: 'Engineering PG' },
  { code: 'CUET', icon: '🎓', label: 'CUET UG', note: 'University Entrance' }
]

// Core features (originals)
const FEATURES = [
  { icon: '🤖', title: 'AI Question Bank', text: 'Unlimited AI-generated questions via DeepSeek with Gemini fallback — fresh sets every time.' },
  { icon: '📄', title: 'Previous Year Papers', text: 'Admins upload any PDF — even scanned — and Gemini Vision extracts every question once, forever reusable.' },
  { icon: '⏱️', title: 'Real Exam Simulation', text: 'Dynamic timer that recalibrates time-per-question live, with speed, pace, accuracy & completion predictions.' },
  { icon: '💡', title: 'Instant Doubt Solving', text: 'Wrong answer? The test pauses and an AI tutor explains the solution before you continue.' },
  { icon: '🧠', title: 'Adaptive Practice', text: 'Difficulty adjusts to your performance. Weak topics are auto-detected and targeted.' },
  { icon: '📈', title: 'Deep Analytics', text: 'Chapter-wise accuracy, weak-topic analysis, personalized recommendations and rankings.' }
]

// NEW — the engagement & social layer (Phase 4 highlights)
const NEW_FEATURES = [
  { icon: '⚔️', title: '1v1 Quiz Battles', text: 'Dost ko invite code bhejo ya quick-match khelo — 30-second rounds, speed bonus, aur ELO rating ladder. Har jeet par leaderboard me chamko.', tag: 'NEW' },
  { icon: '👥', title: 'Group Study + Discussions', text: 'Apni squad banao, join-code se bulao, discuss karo. Deal bhi hai — 2 members plan lein to 1 dost ka seat FREE.', tag: 'NEW' },
  { icon: '🔥', title: 'AI Focus Areas', text: 'Pichhle saalon ke papers ka data scan — kaunsa topic baar-baar poocha jata hai, last year kab aaya. Smart prioritization.', tag: 'NEW' },
  { icon: '🔁', title: 'Spaced Revision', text: 'Bhoolne ka science: har topic apne box me, 1-3-7-14-30 din ke cycle par. "Aaj ye revise karo" roz ka plan + Telegram reminder.', tag: 'NEW' },
  { icon: '🎯', title: 'Doubt → Practice Loop', text: 'Har solved doubt se AI 3 similar questions banata hai — turant practice test. Jo doubt aaya, wo pakka fix.', tag: 'NEW' },
  { icon: '🇮🇳', title: 'All-India Rank + Points', text: 'AIR #? of thousands — percentile ke saath. Har action par points (test, battle, doubt, group), levels aur recognition wall.', tag: 'NEW' },
  { icon: '📰', title: 'Current Affairs Pro', text: 'AI roz 10 MCQs banata hai — pichhle 7 din ki ASLI news se (real headlines, purani knowledge nahi), aapke target exam ke hisaab se. UPSC/Banking/SSC walon ka daily habit.', tag: 'NEW' },
  { icon: '💬', title: 'Telegram Tutor', text: 'Doubts, revision reminders aur welcome messages — sab Telegram par. App kholne ki bhi zaroorat nahi, bot hi coach ban jata hai.', tag: 'NEW' },
  { icon: '📲', title: 'Installable App (PWA)', text: 'Browser se ek tap me phone par install — home screen icon, fast loading, no Play Store wait. Jaise native app, update apne aap.', tag: 'NEW' }
]

// Power-ups — optional paid add-ons (pricing admin-controlled, isliye page par hardcoded nahi)
const POWERUPS = [
  { icon: '⚡', title: 'AI Power Pack', text: 'AI generation ka full boost — unlimited fresh questions, priority generation, tougher sets jab ready ho.' },
  { icon: '🎙️', title: 'Voice Doubts', text: 'Bolkar sawal poocho — Hindi/English voice input, AI bolke jawab de. Haath busy ho to bhi padhai chalti hai.' },
  { icon: '📰', title: 'Current Affairs Pro', text: 'Daily 10 AI MCQs real news se — exam-scoped, aaj ke headlines par based.' },
  { icon: '🔥', title: 'AI Focus Areas', text: 'Pichhle saalon ke papers scan — kaunsa topic baar-baar aata hai, wahi pehle master karo.' }
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
          {stats ? <span className="chip">{stats.questions}+ AI & PYQ questions ready</span> : null}
          <span className="chip">8 exams supported</span>
          <span className="chip">Battles, Groups & AIR rankings</span>
          <span className="chip">Daily AI current affairs</span>
          <span className="chip">Telegram tutor + installable app</span>
        </div>
        <h1>Master Every Exam with<br /><span>AI-Powered Practice</span></h1>
        <p>{tagline}. Mock tests, adaptive learning, PYQ papers, real exam simulation — plus 1v1 battles, group study, spaced revision, daily current affairs from real news, a Telegram tutor and an All-India leaderboard that makes prep addictive.</p>
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
              <div className="tiny">{e.note}</div>
            </div>
          ))}
        </div>

        {/* NEW features first — bigger cards with tag */}
        <h2 className="mb" style={{ textAlign: 'center' }}>Ab sirf practice nahi — <span style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>competition, community aur consistency</span></h2>
        <div className="grid grid-3 mb">
          {NEW_FEATURES.map((f) => (
            <div key={f.title} className="card" style={{ borderColor: 'rgba(99,102,241,0.4)' }}>
              <div className="spread mb" style={{ marginBottom: 8 }}>
                <span style={{ fontSize: 26 }}>{f.icon}</span>
                <span className="badge purple">{f.tag}</span>
              </div>
              <b>{f.title}</b>
              <p className="small muted" style={{ marginTop: 6 }}>{f.text}</p>
            </div>
          ))}
        </div>

        <h2 className="mb" style={{ textAlign: 'center' }}>Everything an aspirant needs</h2>
        <div className="grid grid-3 mb">
          {FEATURES.map((f) => (
            <div key={f.title} className="card">
              <div style={{ fontSize: 26, marginBottom: 8 }}>{f.icon}</div>
              <b>{f.title}</b>
              <p className="small muted" style={{ marginTop: 6 }}>{f.text}</p>
            </div>
          ))}
        </div>

        {/* Power-ups — optional add-ons */}
        <h2 className="mb" style={{ textAlign: 'center' }}>Jab basic master ho jaye — <span style={{ background: 'linear-gradient(90deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>Power-ups unlock karo</span></h2>
        <p className="small muted mb" style={{ textAlign: 'center' }}>Optional add-ons — free plan me poora core milta hai, power-ups unko aur tez karte hain.</p>
        <div className="grid grid-4 mb">
          {POWERUPS.map((p) => (
            <div key={p.title} className="card">
              <div style={{ fontSize: 24 }}>{p.icon}</div>
              <b className="small" style={{ display: 'block', marginTop: 6 }}>{p.title}</b>
              <p className="tiny muted" style={{ marginTop: 6 }}>{p.text}</p>
            </div>
          ))}
        </div>

        {/* Social proof strip — engagement mechanics */}
        <div className="card muted-bg mb" style={{ border: 'none' }}>
          <div className="grid grid-3" style={{ textAlign: 'center', gap: 12 }}>
            <div>
              <div style={{ fontSize: 28 }}>⭐</div>
              <b className="small">Points & Levels</b>
              <p className="tiny muted">Har action par recognition — Newbie se Legend tak</p>
            </div>
            <div>
              <div style={{ fontSize: 28 }}>🏆</div>
              <b className="small">Leaderboards</b>
              <p className="tiny muted">AIR, exam rank aur ELO battle ladder</p>
            </div>
            <div>
              <div style={{ fontSize: 28 }}>🎁</div>
              <b className="small">Group Deals</b>
              <p className="tiny muted">Dosto ke saath plan lo — ek seat free</p>
            </div>
          </div>
        </div>

        <div className="card muted-bg mb" style={{ border: 'none', textAlign: 'center' }}>
          <b>Run your school or coaching on {brand.platformName} — students aur teachers dono ke liye</b>
          <p className="small muted mt">White-label AI test platform — your brand, your tests, AI for your teachers (Teach Kits, Classroom Live Quiz, Soft Skills) aur parent-ready progress reports. Free 30-day pilot.</p>
          <div className="row mt" style={{ justifyContent: 'center' }}>
            <button className="btn btn-accent" onClick={() => nav('/schools')}>🏫 {t('cta.guruline')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
