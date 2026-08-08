import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client.js'
import { Brand } from '../components/Layout.jsx'

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

const FEATURES = [
  { icon: '🤖', title: 'AI Question Bank', text: 'Unlimited AI-generated questions via DeepSeek with Gemini fallback — fresh sets every time.' },
  { icon: '📄', title: 'Previous Year Papers', text: 'Admins upload any PDF — even scanned — and Gemini Vision extracts every question once, forever reusable.' },
  { icon: '⏱️', title: 'Real Exam Simulation', text: 'Dynamic timer that recalibrates time-per-question live, with speed, pace, accuracy & completion predictions.' },
  { icon: '💡', title: 'Instant Doubt Solving', text: 'Wrong answer? The test pauses and an AI tutor explains the solution before you continue.' },
  { icon: '🧠', title: 'Adaptive Practice', text: 'Difficulty adjusts to your performance. Weak topics are auto-detected and targeted.' },
  { icon: '📈', title: 'Deep Analytics', text: 'Chapter-wise accuracy, weak-topic analysis, personalized recommendations and rankings.' }
]

export default function Landing() {
  const nav = useNavigate()
  const [stats, setStats] = useState(null)

  useEffect(() => {
    api.get('/health').then((d) => setStats({ questions: d.questions })).catch(() => {})
  }, [])

  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <Brand />
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => nav('/login')}>Log in</button>
        <button className="btn btn-primary btn-sm" onClick={() => nav('/register')}>Sign up free</button>
      </header>

      <div className="hero">
        <div className="pill mb">
          {stats ? <span className="chip">{stats.questions}+ AI & PYQ questions ready</span> : null}
          <span className="chip">8 exams supported</span>
          <span className="chip">PWA-ready</span>
        </div>
        <h1>Master Every Exam with<br /><span>AI-Powered Practice</span></h1>
        <p>Mock tests, chapter-wise practice, adaptive learning, previous-year papers and a real exam simulation engine — for NEET, JEE, UPSC, SSC, Banking, CAT, GATE & CUET.</p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" style={{ padding: '13px 26px' }} onClick={() => nav('/register')}>Start practicing free</button>
          <button className="btn btn-ghost" style={{ padding: '13px 26px' }} onClick={() => nav('/login')}>View demo</button>
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

        <div className="card muted-bg mb" style={{ border: 'none', textAlign: 'center' }}>
          <b>Ready when you are.</b>
          <p className="small muted mt">Log in with the demo accounts or create your own — no payment needed.</p>
          <div className="row mt" style={{ justifyContent: 'center' }}>
            <span className="chip">student@examai.app / student123</span>
            <span className="chip">admin@examai.app / admin123</span>
          </div>
        </div>
      </div>
    </div>
  )
}
