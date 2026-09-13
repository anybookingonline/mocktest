import React from 'react'
import { useNavigate } from 'react-router-dom'
import { Brand } from '../components/Layout.jsx'

// Public sales/presentation page for schools & coaching institutes (B2B white-label).
// Designed to be opened on a projector during a school pitch.
const PILLARS = [
  {
    icon: '🏫', title: 'Aapka brand, hamara engine',
    points: ['School ka logo, naam aur rang — students ko school ka app dikhega', 'Apna subdomain: yourschool.examai.app (ya apna domain)', 'School ka apna admin panel — full control']
  },
  {
    icon: '📝', title: 'Tests, aapke hisaab se',
    points: ['Teachers apne papers upload karein (PDF) — AI sab questions nikal leta hai', 'Chapter-wise practice, mock tests, previous-year papers', 'Adaptive AI practice — har student ki capability ke hisaab se questions']
  },
  {
    icon: '📊', title: 'Parents ko real data',
    points: ['Har student ka weak-topic report — subject, chapter, topic level tak', 'Class-level analytics: kis chapter me poora class weak hai', 'Progress reports print/share karne ke liye — PTM ka sabse bada proof']
  },
  {
    icon: '🛡️', title: 'Data safe, zero headache',
    points: ['Encrypted cloud storage (no local files to lose)', 'Students ka data sirf school ke controls me', 'Setup 1 din me — teachers ko 30 min training ka PDF guide']
  }
]

const NUMBERS = [
  { v: '8+', l: 'Exams supported out of the box' },
  { v: 'AI', l: 'Unlimited question generation' },
  { v: '1 din', l: 'Setup & go-live' },
  { v: '₹0', l: 'Pilot cost for 30 days' }
]

const STEPS = [
  { n: 1, t: 'Free 30-day pilot', d: 'Ek class (max 60 students) ke saath poora platform — free. Koi card, koi contract nahi.' },
  { n: 2, t: 'Teachers onboard', d: 'Aapke teachers papers upload karte hain aur tests assign karte hain. Hum 30-minute walkthrough dete hain.' },
  { n: 3, t: 'Parents see results', d: 'Weekly progress reports — school ka logo ke saath. PTM me yehi sabse zyada pasand aata hai.' },
  { n: 4, t: 'Go full school', d: 'Pilot pasand aaye to annual plan — per-student pricing, school-wide rollout.' }
]

export default function Schools() {
  const nav = useNavigate()
  return (
    <div style={{ minHeight: '100vh' }}>
      <header className="topbar">
        <Brand />
        <div className="spacer" />
        <span className="chip">For Schools & Coaching Institutes</span>
        <button className="btn btn-ghost btn-sm" onClick={() => nav('/')}>← Student app</button>
      </header>

      <div className="hero">
        <div className="pill mb">
          <span className="chip">🏫 White-label platform</span>
          <span className="chip">Free 30-day pilot</span>
          <span className="chip">Setup in 1 day</span>
        </div>
        <h1>Apne School ka Apna<br /><span>AI Test Platform</span></h1>
        <p>
          AI question generation, previous-year paper digitization, real-exam simulation aur parent-ready
          progress reports — sab aapke school ke brand ke saath. Students app use karte hain,
          aap control me rehte hain.
        </p>
        <div className="row" style={{ justifyContent: 'center' }}>
          <button className="btn btn-primary" style={{ padding: '13px 26px' }} onClick={() => { window.location.href = 'mailto:sales@examai.app?subject=School%20Pilot%20Request&body=School%20name%3A%20%0ACity%3A%20%0AStudents%20(approx)%3A%20%0APhone%3A%20' }}>
            Book a free pilot
          </button>
          <button className="btn btn-ghost" style={{ padding: '13px 26px' }} onClick={() => nav('/register')}>Try the student app first</button>
        </div>
      </div>

      <div className="content" style={{ maxWidth: 1100 }}>
        <div className="grid grid-4 mb">
          {NUMBERS.map((n) => (
            <div key={n.l} className="card" style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 34, fontWeight: 800, background: 'linear-gradient(90deg, var(--accent), var(--accent2))', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{n.v}</div>
              <div className="tiny">{n.l}</div>
            </div>
          ))}
        </div>

        <h2 className="mb" style={{ textAlign: 'center' }}>School ko kya milta hai</h2>
        <div className="grid grid-2 mb">
          {PILLARS.map((p) => (
            <div key={p.title} className="card">
              <div className="row mb">
                <span style={{ fontSize: 28 }}>{p.icon}</span>
                <b>{p.title}</b>
              </div>
              <ul className="small muted" style={{ paddingLeft: 18, lineHeight: 2 }}>
                {p.points.map((pt) => <li key={pt}>{pt}</li>)}
              </ul>
            </div>
          ))}
        </div>

        <h2 className="mb" style={{ textAlign: 'center' }}>Shuru kaise hota hai</h2>
        <div className="grid grid-4 mb">
          {STEPS.map((s) => (
            <div key={s.n} className="card hover">
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--accent2))', color: '#fff', fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>{s.n}</div>
              <b className="small" style={{ display: 'block', marginBottom: 4 }}>{s.t}</b>
              <p className="tiny muted">{s.d}</p>
            </div>
          ))}
        </div>

        <div className="card muted-bg mb" style={{ border: 'none' }}>
          <div className="spread">
            <div>
              <b>Pricing — simple, per student</b>
              <p className="small muted mt">
                ₹50–100 / student / year (school size ke hisaab se) · ya ₹25k–1L / year fixed.<br />
                Coaching institutes: ₹5k–25k / month. Pilot ke dauran <b>₹0</b>.
              </p>
            </div>
            <button className="btn btn-accent" onClick={() => { window.location.href = 'mailto:sales@examai.app?subject=School%20Pilot%20Request' }}>
              Request pilot →
            </button>
          </div>
        </div>

        <div className="card mb" style={{ textAlign: 'center' }}>
          <b className="small">Ek FAQ — jo har principal poochta hai</b>
          <div className="grid grid-2 mt" style={{ textAlign: 'left' }}>
            <div>
              <b className="small">📱 Students ko naya app download karna padega?</b>
              <p className="tiny muted">Nahi — browser me chalta hai, phone/laptop dono par. Install optional hai (PWA).</p>
            </div>
            <div>
              <b className="small">🧑‍🏫 Teachers ko technical knowledge chahiye?</b>
              <p className="tiny muted">Bas PDF upload karna aana chahiye — AI baaki sab karta hai.</p>
            </div>
            <div>
              <b className="small">🔒 Students ka data kahan jaata hai?</b>
              <p className="tiny muted">Encrypted cloud storage. School ke control se bahar share nahi hota.</p>
            </div>
            <div>
              <b className="small">🇮🇳 Hindi me bhi?</b>
              <p className="tiny muted">Haan — doubts Hindi/Hinglish me pooche ja sakte hain (voice bhi).</p>
            </div>
          </div>
        </div>
      </div>

      <footer className="tiny muted" style={{ textAlign: 'center', padding: '30px 0 40px' }}>
        ExamAI — AI-Powered Test Practice · <a href="mailto:sales@examai.app">sales@examai.app</a>
      </footer>
    </div>
  )
}
