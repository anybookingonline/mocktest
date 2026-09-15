import React, { useEffect, useState } from 'react'

// ---------------------------------------------------------------------------
// Guided platform tour. Shows once per role (student/admin) on first login —
// a compact step-by-step "kya kahan hai, kaise chalao" walkthrough. The
// sidebar "?" button reopens it anytime. Progress is per-device localStorage
// (per-account would need an API column; device-level is enough here).
// ---------------------------------------------------------------------------

const STUDENT_STEPS = [
  {
    icon: '🎯', title: 'Pehla kadam: apna target exam set karo',
    body: 'Dashboard par aapka target exam sabse upar dikhta hai. Sab practice, tests aur rankings usi exam ke hisaab se dikhengi. Galat exam set hai? Dusre exam ke card par click karo — wo naya target ban jayega.',
    tip: 'Signup ke waqt jo exam chuna tha wahi default hota hai.'
  },
  {
    icon: '✏️', title: 'Practice — roz ka abhyas',
    body: 'Chapter-wise aur topic-wise questions. Sirf sahi-galat nahi: har question ke baad instant solution, aur bookmark icon se mushkil sawal save karte jao.',
    tip: 'Bookmarked questions 🔖 page par revision ke liye jamte hain.'
  },
  {
    icon: '⏱️', title: 'Mock Tests — asli exam ka feel',
    body: 'Timer, pace dashboard, negative marking — sab asli exam jaisa. Galat jawab par test pause hokar AI tutor solution samjhata hai, phir wahi se continue. "Generate AI Full Mock" se naya paper turant ban jata hai.',
    tip: 'Time-per-question live adjust hota hai — pace dashboard dhyan me rakho.'
  },
  {
    icon: '🧠', title: 'Adaptive Practice — AI aapki level jaanta hai',
    body: 'Sahi jawab par mushkil badhegi, galat par aasan. Aapke weak topics apne aap pakde jaate hain aur wahi questions zyada aayenge. Topic select karke bhi specific practice kar sakte ho.',
    tip: 'Streak maintain rakho — consistency adaptive engine ko better data deti hai.'
  },
  {
    icon: '🔁', title: 'AI Revision — bhoolna band',
    body: 'Jo topics galat kiye, wo 1-3-7-14-30 din ke cycle me apne aap wapas aayenge. Revision page par roz ka plan ready milta hai: "aaj ye revise karo".',
    tip: 'Telegram bot linked hai to roz reminder bhi aayega.'
  },
  {
    icon: '⚔️', title: 'Battles & Groups — padhai ko social banao',
    body: '1v1 Battles me doston se ELO duel khelo (3 free/day). Groups me squad banao — 2 paid members hue to 1 dost ki chat seat FREE. Har action par points milte hain: Newbie se Legend tak level up karo.',
    tip: 'Points/level profile me dikhta hai — har test, battle, doubt contribute karta hai.'
  },
  {
    icon: '🏆', title: 'Rankings & Analytics — apni position jaano',
    body: 'All-India Rank percentile ke saath, exam-wise leaderboard, chapter-wise accuracy, weak-topic analysis aur score trends. Data dekh ke hi next move banao.',
    tip: 'Analytics ka weak-topics section hi aapka syllabus priority list hai.'
  },
  {
    icon: '🔒', title: 'Data Retention — aapka data aapka',
    body: 'Free users ka attempt history limited rakha jata hai. Plans page se plan lete hi poora history + AI Power Pack features unlock ho jate hain.',
    tip: 'Plans page par sirf live add-ons dikhte hain — admin jo ON kare wahi.'
  }
]

const ADMIN_STEPS = [
  {
    icon: '🚀', title: 'Day-1 setup: exam + syllabus',
    body: 'Exams page par exam banao (duration, marking). Syllabus me subject → chapter → topic tree banao. Questions inhi se map hote hain, isliye ye skeleton sabse pehle.',
    tip: 'Seed data pehle se 8 exams ke saath aata hai — use edit karo ya naya banao.'
  },
  {
    icon: '❓', title: 'Question bank do tarike se bharta hai',
    body: '1) AI Config me DeepSeek/Gemini key daalo — AI questions khud banata hai. 2) PDF Import par koi bhi PYQ PDF upload karo (scanned bhi) — Gemini Vision sab questions nikal leta hai. Dono ek hi bank me jate hain.',
    tip: 'Same PDF dobara upload karne par dedup hash se bach jata hai.'
  },
  {
    icon: '🤖', title: 'AI Config = platform ka dimaag',
    body: 'Provider + API keys + fallback chain yahan. "Test connection" se verify karo. Feature toggles bhi yahin hain: Groups, Battles, Voice, Telegram — ON karte hi student nav me dikhte hain, OFF par hidden + API 403.',
    tip: 'AI down ho to fallback chain apne aap agli provider par switch karti hai.'
  },
  {
    icon: '🎁', title: 'Pricing aur deals yahan se chalte hain',
    body: 'AI Config me add-on pricing (price/validity) set karo — ON wale hi Plans page par dikhte hain. Free-seat deal builder se group deal tune karo: "kitne paid → kitne free" ek click me.',
    tip: 'Kill-switch design: koi bhi feature bina redeploy ON/OFF.'
  },
  {
    icon: '🏫', title: 'B2B: school/coaching onboard karo',
    body: 'Institutes page par institute banao → invite code milega → us code se students register hote hi institute me jud jaate hain. Sub-admin (owner) ko login banao — wo sirf apne students dekh sakta hai, platform nahi.',
    tip: 'Bulk CSV se poora classroom ek baar me create ho jata hai.'
  },
  {
    icon: '📈', title: 'Users, Payments, Analytics',
    body: 'Users me sab accounts + manual plan activate. Payments me QR/proof verify karke mark-paid karo. Analytics se platform-wide health: exams, questions, daily activity.',
    tip: 'Retention page ka data batata hai kaun free user plan ke layak hai.'
  },
  {
    icon: '⚙️', title: 'Branding — aapka naam sab jagah',
    body: 'Settings me platform name, tagline, logo, support email set karo — landing, login, tab title, Telegram bot, sab jagah white-label ho jata hai. Domain + Telegram webhook ka setup launch-runbook.md me step-by-step hai.',
    tip: 'Support email Schools page ke CTA buttons me bhi use hota hai.'
  }
]

export default function Tour({ role = 'student', autoOpen = false, force = false, onClose }) {
  const steps = role === 'admin' ? ADMIN_STEPS : STUDENT_STEPS
  const storageKey = `aisepadho_tour_${role}`
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)

  useEffect(() => {
    let seen = false
    try { seen = localStorage.getItem(storageKey) === 'done' } catch { /* ignore */ }
    if (autoOpen && (force || !seen)) setOpen(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, force])

  const close = (markDone = true) => {
    setOpen(false)
    if (markDone) { try { localStorage.setItem(storageKey, 'done') } catch { /* ignore */ } }
    onClose?.()
  }
  const step = steps[Math.min(i, steps.length - 1)]
  if (!open) return null

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={() => close(true)}>
      <div className="card" style={{ maxWidth: 520, width: '100%', cursor: 'default' }} onClick={(e) => e.stopPropagation()}>
        <div className="spread mb">
          <span style={{ fontSize: 30 }}>{step.icon}</span>
          <span className="tiny muted">Step {i + 1}/{steps.length}</span>
        </div>
        <b style={{ display: 'block', fontSize: 17, marginBottom: 8 }}>{step.title}</b>
        <p className="small" style={{ lineHeight: 1.8 }}>{step.body}</p>
        <div className="card muted-bg" style={{ border: 'none', padding: '8px 12px', marginTop: 10 }}>
          <span className="tiny">💡 {step.tip}</span>
        </div>
        <div className="spread mt">
          <button className="btn btn-ghost btn-sm" onClick={() => close(true)}>Skip tour</button>
          <div className="row" style={{ gap: 8 }}>
            {i > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setI(i - 1)}>←</button>}
            {i < steps.length - 1
              ? <button className="btn btn-primary btn-sm" onClick={() => setI(i + 1)}>Next →</button>
              : <button className="btn btn-accent btn-sm" onClick={() => close(true)}>✓ Done</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
