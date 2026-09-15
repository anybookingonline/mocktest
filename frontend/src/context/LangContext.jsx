import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

// ---------------------------------------------------------------------------
// UI language: English / Hinglish / हिंदी.
// - Persisted in localStorage ('lang'), reflected on <html lang> for a11y.
// - t(key) falls back to the English string when a translation is missing, so
//   a partial translation never renders [key] junk.
// - Question-language (English/Hindi bilingual exam papers) is separate —
//   Practice.jsx picks it per test and it flows to the AI generation prompt.
// - Every marketing landing-page string lives here too, so the switcher
//   changes the whole page (hero, features, power-ups, social proof, B2B).
// ---------------------------------------------------------------------------

const LANG_KEY = 'aisepadho_lang'
const LANGS = ['en', 'hinglish', 'hi']

function detect() {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved && LANGS.includes(saved)) return saved
  } catch { /* storage blocked */ }
  // First visit: default to Hinglish (platform's home turf), browser locale
  // can override for pure-English or Hindi users.
  const nav = (navigator.language || 'en').toLowerCase()
  if (nav.startsWith('hi')) return 'hi'
  return 'hinglish'
}

const strings = {
  en: {
    // — App nav (used in Layout/AuthPages) —
    'nav.dashboard': 'Dashboard', 'nav.practice': 'Practice', 'nav.tests': 'Mock Tests',
    'nav.adaptive': 'Adaptive Practice', 'nav.focus': 'AI Focus Areas', 'nav.ca': 'Current Affairs',
    'nav.doubts': 'Doubt Solving', 'nav.groups': 'Group Study', 'nav.battles': 'Quiz Battles',
    'nav.bookmarks': 'Bookmarked', 'nav.history': 'Test History', 'nav.retention': 'Data Retention',
    'nav.revision': 'AI Revision', 'nav.rankings': 'Rankings', 'nav.analytics': 'Analytics & Report',
    'lang.qhint': 'Question paper language', 'lang.qen': 'English', 'lang.qhi': 'हिंदी', 'lang.qboth': 'English + हिंदी (bilingual)',
    'cta.start': 'Start practicing free', 'cta.login': 'Log in', 'cta.signup': 'Sign up free',
    'cta.schools': 'For Schools →', 'cta.pilot': 'Book a free pilot', 'cta.tryfirst': 'Try the student app first',
    'cta.guruline': 'For Schools & Coaching →', 'cta.powerups': 'unlock the Power-ups',
    'common.showall': 'Show all exams', 'common.logout': 'Logout',

    // — Landing: hero —
    'hero.h1a': 'Master Every Exam with',
    'hero.h1b': 'AI-Powered Practice',
    'hero.sub': 'Mock tests, adaptive learning, PYQ papers, real exam simulation — plus 1v1 battles, group study, spaced revision, daily current affairs from real news, a Telegram tutor and an All-India leaderboard that makes prep addictive.',
    'hero.new': 'More than just practice —',
    'hero.core': 'Everything an aspirant needs',
    'chip.qready': 'AI & PYQ questions ready', 'chip.exams': '8 exams supported',
    'chip.social': 'Battles, Groups & AIR rankings', 'chip.ca': 'Daily AI current affairs',
    'chip.tg': 'Telegram tutor + installable app',

    // — Landing: exam cards —
    'ex.jee': 'Engineering', 'ex.neet': 'Medical', 'ex.upsc': 'Civil Services', 'ex.ssc': 'Staff Selection',
    'ex.bank': 'IBPS / SBI', 'ex.cat': 'MBA Entrance', 'ex.gate': 'Engineering PG', 'ex.cuet': 'University Entrance',

    // — Landing: NEW features —
    'sec.new.b': 'competition, community & consistency',
    'nf.battles.t': '1v1 Quiz Battles',
    'nf.battles.d': 'Send a friend an invite code or play a quick-match — 30-second rounds, speed bonus and an ELO rating ladder. Shine on the leaderboard with every win.',
    'nf.groups.t': 'Group Study + Discussions',
    'nf.groups.d': 'Build your squad, invite via join-code, discuss together. And there’s a deal — 2 members subscribe and the 3rd friend’s seat is FREE.',
    'nf.focus.t': 'AI Focus Areas',
    'nf.focus.d': 'Scans data from past years’ papers — which topic gets asked again and again, when it appeared last year. Smart prioritization.',
    'nf.revision.t': 'Spaced Revision',
    'nf.revision.d': 'The science of not forgetting: every topic in its own box on a 1-3-7-14-30 day cycle. A daily “revise this today” plan + Telegram reminder.',
    'nf.loop.t': 'Doubt → Practice Loop',
    'nf.loop.d': 'Every solved doubt generates 3 similar AI questions — an instant practice test. The doubt you had gets fixed for good.',
    'nf.air.t': 'All-India Rank + Points',
    'nf.air.d': 'AIR #? among thousands — with percentile. Points for every action (tests, battles, doubts, groups), levels and a recognition wall.',
    'nf.ca.t': 'Current Affairs Pro',
    'nf.ca.d': 'AI builds 10 MCQs every day — from the last 7 days of REAL news (real headlines, not stale knowledge), scoped to your target exam. The daily habit for UPSC/Banking/SSC aspirants.',
    'nf.tg.t': 'Telegram Tutor',
    'nf.tg.d': 'Doubts, revision reminders and welcome messages — all on Telegram. You don’t even need to open the app; the bot becomes your coach.',
    'nf.pwa.t': 'Installable App (PWA)',
    'nf.pwa.d': 'Install on your phone in one tap from the browser — home-screen icon, fast loading, no Play Store wait. Feels native, updates itself.',

    // — Landing: core features —
    'cf.qbank.t': 'AI Question Bank',
    'cf.qbank.d': 'Unlimited AI-generated questions via DeepSeek with Gemini fallback — fresh sets every time.',
    'cf.pyq.t': 'Previous Year Papers',
    'cf.pyq.d': 'Admins upload any PDF — even scanned — and Gemini Vision extracts every question once, forever reusable.',
    'cf.sim.t': 'Real Exam Simulation',
    'cf.sim.d': 'Dynamic timer that recalibrates time-per-question live, with speed, pace, accuracy & completion predictions.',
    'cf.doubt.t': 'Instant Doubt Solving',
    'cf.doubt.d': 'Wrong answer? The test pauses and an AI tutor explains the solution before you continue.',
    'cf.adaptive.t': 'Adaptive Practice',
    'cf.adaptive.d': 'Difficulty adjusts to your performance. Weak topics are auto-detected and targeted.',
    'cf.analytics.t': 'Deep Analytics',
    'cf.analytics.d': 'Chapter-wise accuracy, weak-topic analysis, personalized recommendations and rankings.',

    // — Landing: power-ups —
    'sec.power.a': 'Once you’ve mastered the basics —',
    'sec.power.sub': 'Optional add-ons — the free plan includes the full core; power-ups make it even faster.',
    'pu.power.t': 'AI Power Pack',
    'pu.power.d': 'The full AI generation boost — unlimited fresh questions, priority generation, tougher sets as soon as they’re ready.',
    'pu.voice.t': 'Voice Doubts',
    'pu.voice.d': 'Ask by speaking — Hindi/English voice input, the AI answers out loud. Your prep continues even when your hands are busy.',
    'pu.ca.t': 'Current Affairs Pro',
    'pu.ca.d': 'Daily 10 AI MCQs from real news — exam-scoped, based on today’s headlines.',
    'pu.focus.t': 'AI Focus Areas',
    'pu.focus.d': 'Scans past years’ papers — master the most-repeated topics first.',

    // — Landing: social proof + B2B —
    'sp.points.t': 'Points & Levels',
    'sp.points.d': 'Recognition for every action — from Newbie to Legend',
    'sp.lb.t': 'Leaderboards',
    'sp.lb.d': 'AIR, exam rank and the ELO battle ladder',
    'sp.deals.t': 'Group Deals',
    'sp.deals.d': 'Plan with friends — one seat free',
    'b2b.title': 'Run your school or coaching on {brand} — for students and teachers alike',
    'b2b.sub': 'White-label AI test platform — your brand, your tests, AI for your teachers (Teach Kits, Classroom Live Quiz, Soft Skills) and parent-ready progress reports. Free 30-day pilot.',

    // — Schools page —
    'sch.top.chip': 'For Schools & Coaching Institutes', 'sch.back': '← Student app',
    'sch.chip.wl': '🏫 White-label platform', 'sch.chip.guru': '🎓 AI for teachers — Guru Studio',
    'sch.chip.pilot': 'Free 30-day pilot', 'sch.chip.setup': 'Setup in 1 day',
    'sch.h1a': 'Your school’s own', 'sch.h1b': 'AI Test Platform',
    'sch.hero.p': 'AI question generation, previous-year paper digitization, real-exam simulation, parent-ready progress reports — and now ###AI for your teachers too### (Teach Kit, Classroom Live Quiz, Soft Skills). All under your school’s brand. Students use the app, you stay in control.',
    'sch.num.exams.v': '8+', 'sch.num.exams': 'Exams supported out of the box',
    'sch.num.ai.v': 'AI', 'sch.num.ai': 'Unlimited question generation',
    'sch.num.setup.v': '1 day', 'sch.num.setup': 'Setup & go-live',
    'sch.num.pilot.v': '₹0', 'sch.num.pilot': 'Pilot cost for 30 days',
    'sch.sec.pillars': 'What the school gets',
    'sch.pl1.t': 'Your brand, our engine',
    'sch.pl1.p1': 'School’s logo, name and colors — students see the school’s own app',
    'sch.pl1.p2': 'Your own subdomain: yourschool.aisepadho.com (or your domain)',
    'sch.pl1.p3': 'School’s own admin panel — full control',
    'sch.pl2.t': 'Tests, your way',
    'sch.pl2.p1': 'Teachers upload their papers (PDF) — AI extracts every question',
    'sch.pl2.p2': 'Chapter-wise practice, mock tests, previous-year papers',
    'sch.pl2.p3': 'Adaptive AI practice — questions matched to each student’s capability',
    'sch.pl3.t': 'Real data for parents',
    'sch.pl3.p1': 'Every student’s weak-topic report — down to subject, chapter and topic',
    'sch.pl3.p2': 'Class-level analytics: which chapter the whole class is weak in',
    'sch.pl3.p3': 'Printable/shareable progress reports — the strongest proof at PTMs',
    'sch.pl4.t': 'Data safe, zero headache',
    'sch.pl4.p1': 'Encrypted cloud storage (no local files to lose)',
    'sch.pl4.p2': 'Student data stays within the school’s controls',
    'sch.pl4.p3': 'Setup in 1 day — teachers get a 30-min training PDF guide',
    'sch.sec.guru.a': 'AI for teachers too —', 'sch.sec.guru.b': 'Guru Studio',
    'sch.sec.guru.sub': 'Not just students — your teachers get AI inside the platform. Teaching quality, class engagement and personality development — all included.',
    'sch.g1.t': 'Teach Kit — topic-wise AI lesson pack',
    'sch.g1.p1': 'Concept map + real-life analogies + 30-min lesson plan for every topic',
    'sch.g1.p2': 'Common misconceptions — not a generic list, built from YOUR students’ real weak-topic data',
    'sch.g1.p3': 'PYQ frequency + difficulty ladder — AI tells you what to teach first',
    'sch.g1.p4': 'Auto-assign homework after class (platform test)',
    'sch.g2.t': 'Classroom Live Quiz — the whole class goes wild',
    'sch.g2.p1': 'Game-based quiz: host screen on the projector, students join from phones with a 4-digit PIN',
    'sch.g2.p2': '15-sec timer, live leaderboard, speed bonus, winner celebration',
    'sch.g2.p3': 'Modes: Rapid Fire · Team Battle · Revision Rumble (due-revision questions)',
    'sch.g2.p4': 'A fully interactive learning platform — not just attempting tests, but practicing, competing and revising together',
    'sch.g3.t': 'Confusion Check — 2-second class pulse',
    'sch.g3.p1': 'Mid-class poll: “is this concept clear?” — students tap 👍/👎 on their phones',
    'sch.g3.p2': '30%+ confused? AI instantly gives an alternate explanation + another analogy',
    'sch.g3.p3': 'Saves time and budget — the extra AI explanation only kicks in when the class actually needs it',
    'sch.g4.t': 'Personality & Soft Skills (NEP-aligned)',
    'sch.g4.p1': 'GD Simulator — AI group discussion with 3-4 AI characters + feedback',
    'sch.g4.p2': 'One-minute speech — voice input with filler-word & pace feedback',
    'sch.g4.p3': 'Interview drills + Personality Report Card (radar chart) — printable for PTMs',
    'sch.sec.steps': 'How it starts',
    'sch.s1.t': 'Free 30-day pilot', 'sch.s1.d': 'The whole platform with one class (max 60 students) — free. No card, no contract.',
    'sch.s2.t': 'Teachers onboard', 'sch.s2.d': 'Upload papers + assign tests. In Guru Studio they teach with Teach Kits and engage the class with Classroom Live Quiz — free 30-min walkthrough.',
    'sch.s3.t': 'Parents see results', 'sch.s3.d': 'Weekly progress reports — with the school’s logo. This is what parents love most at PTMs.',
    'sch.s4.t': 'Go full school or coaching', 'sch.s4.d': 'Happy with the pilot? Annual plan — per-student pricing, rollout across your school or coaching.',
    'sch.pricing.t': 'Pricing — simple, per student',
    'sch.pricing.d1': '₹50–100 / student / year (school-size based) · or ₹25k–1L / year fixed.',
    'sch.pricing.d2': 'Coaching institutes: ₹5k–25k / month. During the pilot:',
    'sch.pricing.free': '₹0',
    'sch.pricing.cta': 'Request pilot →',
    'sch.faq.t': 'One FAQ — every principal asks this',
    'sch.f1.q': '📱 Do students need to download a new app?', 'sch.f1.a': 'No — it runs in the browser on phone and laptop. Install is optional (PWA).',
    'sch.f2.q': '🧑‍🏫 Do teachers need technical knowledge?', 'sch.f2.a': 'Just knowing how to upload a PDF is enough — AI does the rest.',
    'sch.f3.q': '🔒 Where does student data go?', 'sch.f3.a': 'Encrypted cloud storage. It is never shared outside the school’s control.',
    'sch.f4.q': '🇮🇳 Does it work in Hindi too?', 'sch.f4.a': 'Yes — doubts can be asked in Hindi/Hinglish (voice too).',
    'sch.f5.q': '🎓 Is there anything for teachers?', 'sch.f5.a': 'Yes — Guru Studio: AI Teach Kits, game-based Classroom Live Quiz and Soft Skills (GD, speech, personality report). Teachers only need to know PDF upload — AI does the rest.',
    'sch.foot.tag': 'AI-Powered Test Practice',

    // — Auth pages —
    'auth.login.t': 'Welcome back', 'auth.login.s': 'Log in to continue your preparation',
    'auth.email': 'Email', 'auth.password': 'Password',
    'auth.login.btn': 'Log In', 'auth.logging': 'Logging in…',
    'auth.newhere': 'New here?', 'auth.create': 'Create account',
    'auth.toast.welcome': 'Welcome back!',
    'auth.reg.t': 'Create your account', 'auth.reg.s': 'Start free AI-powered practice today',
    'auth.name': 'Full name', 'auth.min6': 'min 6 characters', 'auth.target': 'Target exam',
    'auth.invite': 'School / Coaching invite code (optional)',
    'auth.signup': 'Sign Up', 'auth.creating': 'Creating…', 'auth.already': 'Already registered?',
    'auth.toast.created': 'Account created!',
    'auth.joining': '🏫 Joining {inst} — account automatically linked!',
    'auth.invite.bad': '⚠️ Invite code is invalid or expired — you can still register without a code.'
  },

  hinglish: {
    // — App nav —
    'nav.dashboard': 'Dashboard', 'nav.practice': 'Practice', 'nav.tests': 'Mock Tests',
    'nav.adaptive': 'Adaptive Practice', 'nav.focus': 'AI Focus Areas', 'nav.ca': 'Current Affairs',
    'nav.doubts': 'Doubt Solving', 'nav.groups': 'Group Study', 'nav.battles': 'Quiz Battles',
    'nav.bookmarks': 'Bookmarked', 'nav.history': 'Test History', 'nav.retention': 'Data Retention',
    'nav.revision': 'AI Revision', 'nav.rankings': 'Rankings', 'nav.analytics': 'Analytics & Report',
    'lang.qhint': 'Question paper ki language', 'lang.qen': 'English', 'lang.qhi': 'हिंदी', 'lang.qboth': 'English + हिंदी (bilingual)',
    'cta.start': 'Free practice shuru karo', 'cta.login': 'Log in', 'cta.signup': 'Free signup karo',
    'cta.schools': 'Schools ke liye →', 'cta.pilot': 'Free pilot book karo', 'cta.tryfirst': 'Pehle student app try karo',
    'cta.guruline': 'Schools & Coaching ke liye →', 'cta.powerups': 'Power-ups unlock karo',
    'common.showall': 'Dusre exams dikhao', 'common.logout': 'Logout',

    // — Landing: hero —
    'hero.h1a': 'Har exam master karo',
    'hero.h1b': 'AI-Powered Practice ke saath',
    'hero.sub': 'Mock tests, adaptive learning, PYQ papers, real exam simulation — plus 1v1 battles, group study, spaced revision, real news se roz current affairs, Telegram tutor aur All-India leaderboard jo prep ko addictive bana deta hai.',
    'hero.new': 'Ab sirf practice nahi —',
    'hero.core': 'Jo ek aspirant ko chahiye',
    'chip.qready': 'AI & PYQ questions ready', 'chip.exams': '8 exams supported',
    'chip.social': 'Battles, Groups & AIR rankings', 'chip.ca': 'Roz AI current affairs',
    'chip.tg': 'Telegram tutor + installable app',

    // — Landing: exam cards —
    'ex.jee': 'Engineering', 'ex.neet': 'Medical', 'ex.upsc': 'Civil Services', 'ex.ssc': 'Staff Selection',
    'ex.bank': 'IBPS / SBI', 'ex.cat': 'MBA Entrance', 'ex.gate': 'Engineering PG', 'ex.cuet': 'University Entrance',

    // — Landing: NEW features —
    'sec.new.b': 'competition, community aur consistency',
    'nf.battles.t': '1v1 Quiz Battles',
    'nf.battles.d': 'Dost ko invite code bhejo ya quick-match khelo — 30-second rounds, speed bonus, aur ELO rating ladder. Har jeet par leaderboard me chamko.',
    'nf.groups.t': 'Group Study + Discussions',
    'nf.groups.d': 'Apni squad banao, join-code se bulao, discuss karo. Deal bhi hai — 2 members plan lein to 1 dost ka seat FREE.',
    'nf.focus.t': 'AI Focus Areas',
    'nf.focus.d': 'Pichhle saalon ke papers ka data scan — kaunsa topic baar-baar poocha jata hai, last year kab aaya. Smart prioritization.',
    'nf.revision.t': 'Spaced Revision',
    'nf.revision.d': 'Bhoolne ka science: har topic apne box me, 1-3-7-14-30 din ke cycle par. “Aaj ye revise karo” roz ka plan + Telegram reminder.',
    'nf.loop.t': 'Doubt → Practice Loop',
    'nf.loop.d': 'Har solved doubt se AI 3 similar questions banata hai — turant practice test. Jo doubt aaya, wo pakka fix.',
    'nf.air.t': 'All-India Rank + Points',
    'nf.air.d': 'AIR #? of thousands — percentile ke saath. Har action par points (test, battle, doubt, group), levels aur recognition wall.',
    'nf.ca.t': 'Current Affairs Pro',
    'nf.ca.d': 'AI roz 10 MCQs banata hai — pichhle 7 din ki ASLI news se (real headlines, purani knowledge nahi), aapke target exam ke hisaab se. UPSC/Banking/SSC walon ka daily habit.',
    'nf.tg.t': 'Telegram Tutor',
    'nf.tg.d': 'Doubts, revision reminders aur welcome messages — sab Telegram par. App kholne ki bhi zaroorat nahi, bot hi coach ban jata hai.',
    'nf.pwa.t': 'Installable App (PWA)',
    'nf.pwa.d': 'Browser se ek tap me phone par install — home screen icon, fast loading, no Play Store wait. Jaise native app, update apne aap.',

    // — Landing: core features —
    'cf.qbank.t': 'AI Question Bank',
    'cf.qbank.d': 'DeepSeek se unlimited AI questions, Gemini fallback ke saath — har baar fresh set.',
    'cf.pyq.t': 'Previous Year Papers',
    'cf.pyq.d': 'Admin koi bhi PDF upload kare — scanned bhi — Gemini Vision har question ek baar nikal leta hai, hamesha reusable.',
    'cf.sim.t': 'Real Exam Simulation',
    'cf.sim.d': 'Dynamic timer jo time-per-question live recalibrate karta hai — speed, pace, accuracy & completion predictions ke saath.',
    'cf.doubt.t': 'Instant Doubt Solving',
    'cf.doubt.d': 'Galat jawab? Test pause ho jata hai aur AI tutor aage badhne se pehle solution samjhata hai.',
    'cf.adaptive.t': 'Adaptive Practice',
    'cf.adaptive.d': 'Difficulty aapke performance ke hisaab se adjust hoti hai. Weak topics apne aap pakde jaate hain.',
    'cf.analytics.t': 'Deep Analytics',
    'cf.analytics.d': 'Chapter-wise accuracy, weak-topic analysis, personalized recommendations aur rankings.',

    // — Landing: power-ups —
    'sec.power.a': 'Jab basic master ho jaye —',
    'sec.power.sub': 'Optional add-ons — free plan me poora core milta hai, power-ups unko aur tez karte hain.',
    'pu.power.t': 'AI Power Pack',
    'pu.power.d': 'AI generation ka full boost — unlimited fresh questions, priority generation, tougher sets jab ready ho.',
    'pu.voice.t': 'Voice Doubts',
    'pu.voice.d': 'Bolkar sawal poocho — Hindi/English voice input, AI bolke jawab de. Haath busy ho to bhi padhai chalti hai.',
    'pu.ca.t': 'Current Affairs Pro',
    'pu.ca.d': 'Daily 10 AI MCQs real news se — exam-scoped, aaj ke headlines par based.',
    'pu.focus.t': 'AI Focus Areas',
    'pu.focus.d': 'Pichhle saalon ke papers scan — kaunsa topic baar-baar aata hai, wahi pehle master karo.',

    // — Landing: social proof + B2B —
    'sp.points.t': 'Points & Levels',
    'sp.points.d': 'Har action par recognition — Newbie se Legend tak',
    'sp.lb.t': 'Leaderboards',
    'sp.lb.d': 'AIR, exam rank aur ELO battle ladder',
    'sp.deals.t': 'Group Deals',
    'sp.deals.d': 'Dosto ke saath plan lo — ek seat free',
    'b2b.title': '{brand} par apna school ya coaching chalao — students aur teachers dono ke liye',
    'b2b.sub': 'White-label AI test platform — your brand, your tests, teachers ke liye AI (Teach Kits, Classroom Live Quiz, Soft Skills) aur parent-ready progress reports. Free 30-day pilot.',

    // — Schools page —
    'sch.top.chip': 'Schools & Coaching Institutes ke liye', 'sch.back': '← Student app',
    'sch.chip.wl': '🏫 White-label platform', 'sch.chip.guru': '🎓 Teachers ke liye AI — Guru Studio',
    'sch.chip.pilot': 'Free 30-day pilot', 'sch.chip.setup': '1 din me setup',
    'sch.h1a': 'Apne school ka apna', 'sch.h1b': 'AI Test Platform',
    'sch.hero.p': 'AI question generation, previous-year paper digitization, real-exam simulation, parent-ready progress reports — aur ab ###teachers ke liye bhi AI### (Teach Kit, Classroom Live Quiz, Soft Skills). Sab aapke school ke brand ke saath. Students app use karte hain, aap control me rehte hain.',
    'sch.num.exams.v': '8+', 'sch.num.exams': 'Exams supported out of the box',
    'sch.num.ai.v': 'AI', 'sch.num.ai': 'Unlimited question generation',
    'sch.num.setup.v': '1 din', 'sch.num.setup': 'Setup & go-live',
    'sch.num.pilot.v': '₹0', 'sch.num.pilot': 'Pilot cost for 30 days',
    'sch.sec.pillars': 'School ko kya milta hai',
    'sch.pl1.t': 'Aapka brand, hamara engine',
    'sch.pl1.p1': 'School ka logo, naam aur rang — students ko school ka app dikhega',
    'sch.pl1.p2': 'Apna subdomain: yourschool.aisepadho.com (ya apna domain)',
    'sch.pl1.p3': 'School ka apna admin panel — full control',
    'sch.pl2.t': 'Tests, aapke hisaab se',
    'sch.pl2.p1': 'Teachers apne papers upload karein (PDF) — AI sab questions nikal leta hai',
    'sch.pl2.p2': 'Chapter-wise practice, mock tests, previous-year papers',
    'sch.pl2.p3': 'Adaptive AI practice — har student ki capability ke hisaab se questions',
    'sch.pl3.t': 'Parents ko real data',
    'sch.pl3.p1': 'Har student ka weak-topic report — subject, chapter, topic level tak',
    'sch.pl3.p2': 'Class-level analytics: kis chapter me poora class weak hai',
    'sch.pl3.p3': 'Progress reports print/share karne ke liye — PTM ka sabse bada proof',
    'sch.pl4.t': 'Data safe, zero headache',
    'sch.pl4.p1': 'Encrypted cloud storage (no local files to lose)',
    'sch.pl4.p2': 'Students ka data sirf school ke controls me',
    'sch.pl4.p3': 'Setup 1 din me — teachers ko 30 min training ka PDF guide',
    'sch.sec.guru.a': 'Teachers ke liye bhi AI —', 'sch.sec.guru.b': 'Guru Studio',
    'sch.sec.guru.sub': 'Sirf students nahi — aapke teachers ko bhi platform me AI milta hai. Teaching quality, class engagement aur personality development — sab andar.',
    'sch.g1.t': 'Teach Kit — topic-wise AI lesson pack',
    'sch.g1.p1': 'Har topic ka concept map + real-life analogies + 30-min lesson plan',
    'sch.g1.p2': 'Common misconceptions — generic list nahi, AAPKE students ke real weak-topic data se',
    'sch.g1.p3': 'PYQ frequency + difficulty ladder — kya pehle padhana hai, AI batata hai',
    'sch.g1.p4': 'Class ke baad homework auto-assign (platform test)',
    'sch.g2.t': 'Classroom Live Quiz — puri class diwani',
    'sch.g2.p1': 'Game-based quiz: projector par host screen, students phone se 4-digit PIN se join',
    'sch.g2.p2': '15-sec timer, live leaderboard, speed bonus, winner celebration',
    'sch.g2.p3': 'Modes: Rapid Fire · Team Battle · Revision Rumble (due revision ke questions)',
    'sch.g2.p4': 'Poori tarah interactive learning platform — sirf test attempt nahi, saath me practice, competition aur revision',
    'sch.g3.t': 'Confusion Check — 2-second class pulse',
    'sch.g3.p1': 'Beech class me poll: “ye concept clear hai?” — students 👍/👎 phone par',
    'sch.g3.p2': '30%+ confused? AI turant alternate explanation + dusra analogy deta hai',
    'sch.g3.p3': 'Time aur budget dono bachte hain — AI ki extra explanation tabhi jab class ko sach me zaroorat ho',
    'sch.g4.t': 'Personality & Soft Skills (NEP-aligned)',
    'sch.g4.p1': 'GD Simulator — AI 3-4 characters ke saath group discussion + feedback',
    'sch.g4.p2': 'One-minute speech — voice input, filler words & pace feedback',
    'sch.g4.p3': 'Interview drills + Personality Report Card (radar chart) — PTM ke liye printable',
    'sch.sec.steps': 'Shuru kaise hota hai',
    'sch.s1.t': 'Free 30-day pilot', 'sch.s1.d': 'Ek class (max 60 students) ke saath poora platform — free. Koi card, koi contract nahi.',
    'sch.s2.t': 'Teachers onboard', 'sch.s2.d': 'Papers upload + tests assign. Guru Studio me Teach Kit se padhate hain, Classroom Live Quiz se class jodte hain — 30-min walkthrough free.',
    'sch.s3.t': 'Parents see results', 'sch.s3.d': 'Weekly progress reports — school ka logo ke saath. PTM me yehi sabse zyada pasand aata hai.',
    'sch.s4.t': 'Go full school / coaching', 'sch.s4.d': 'Pilot pasand aaye to annual plan — per-student pricing, poore school ya coaching par rollout.',
    'sch.pricing.t': 'Pricing — simple, per student',
    'sch.pricing.d1': '₹50–100 / student / year (school size ke hisaab se) · ya ₹25k–1L / year fixed.',
    'sch.pricing.d2': 'Coaching institutes: ₹5k–25k / month. Pilot ke dauran',
    'sch.pricing.free': '₹0',
    'sch.pricing.cta': 'Request pilot →',
    'sch.faq.t': 'Ek FAQ — jo har principal poochta hai',
    'sch.f1.q': '📱 Students ko naya app download karna padega?', 'sch.f1.a': 'Nahi — browser me chalta hai, phone/laptop dono par. Install optional hai (PWA).',
    'sch.f2.q': '🧑‍🏫 Teachers ko technical knowledge chahiye?', 'sch.f2.a': 'Bas PDF upload karna aana chahiye — AI baaki sab karta hai.',
    'sch.f3.q': '🔒 Students ka data kahan jaata hai?', 'sch.f3.a': 'Encrypted cloud storage. School ke control se bahar share nahi hota.',
    'sch.f4.q': '🇮🇳 Hindi me bhi?', 'sch.f4.a': 'Haan — doubts Hindi/Hinglish me pooche ja sakte hain (voice bhi).',
    'sch.f5.q': '🎓 Teachers ke liye bhi kuch hai?', 'sch.f5.a': 'Haan — Guru Studio: AI Teach Kits, game-based Classroom Live Quiz aur Soft Skills (GD, speech, personality report). Teachers ko sirf PDF upload aana chahiye — AI baaki karta hai.',
    'sch.foot.tag': 'AI-Powered Test Practice',

    // — Auth pages —
    'auth.login.t': 'Welcome back', 'auth.login.s': 'Prep continue karne ke liye log in karo',
    'auth.email': 'Email', 'auth.password': 'Password',
    'auth.login.btn': 'Log In', 'auth.logging': 'Logging in…',
    'auth.newhere': 'New here?', 'auth.create': 'Account banao',
    'auth.toast.welcome': 'Welcome back!',
    'auth.reg.t': 'Apna account banao', 'auth.reg.s': 'Aaj hi free AI-powered practice shuru karo',
    'auth.name': 'Pura naam', 'auth.min6': 'min 6 characters', 'auth.target': 'Target exam',
    'auth.invite': 'School / Coaching invite code (optional)',
    'auth.signup': 'Sign Up', 'auth.creating': 'Creating…', 'auth.already': 'Pehle se registered?',
    'auth.toast.created': 'Account ban gaya!',
    'auth.joining': '🏫 Joining {inst} — account apne aap link ho jayega!',
    'auth.invite.bad': '⚠️ Invite code invalid ya expired — bina code bhi register kar sakte ho.'
  },

  hi: {
    // — App nav —
    'nav.dashboard': 'डैशबोर्ड', 'nav.practice': 'अभ्यास', 'nav.tests': 'मॉक टेस्ट',
    'nav.adaptive': 'अनुकूली अभ्यास', 'nav.focus': 'AI फ़ोकस एरिया', 'nav.ca': 'करेंट अफेयर्स',
    'nav.doubts': 'संदेह समाधान', 'nav.groups': 'समूह अध्ययन', 'nav.battles': 'क्विज़ बैटल',
    'nav.bookmarks': 'बुकमार्क', 'nav.history': 'टेस्ट इतिहास', 'nav.retention': 'डेटा रिटेंशन',
    'nav.revision': 'AI रिवीजन', 'nav.rankings': 'रैंकिंग', 'nav.analytics': 'विश्लेषण और रिपोर्ट',
    'lang.qhint': 'प्रश्न-पत्र की भाषा', 'lang.qen': 'अंग्रेज़ी', 'lang.qhi': 'हिंदी', 'lang.qboth': 'अंग्रेज़ी + हिंदी (द्विभाषी)',
    'cta.start': 'मुफ़्त अभ्यास शुरू करें', 'cta.login': 'लॉग इन', 'cta.signup': 'मुफ़्त साइन अप',
    'cta.schools': 'स्कूलों के लिए →', 'cta.pilot': 'मुफ़्त पायलट बुक करें', 'cta.tryfirst': 'पहले स्टूडेंट ऐप आज़माएँ',
    'cta.guruline': 'स्कूल और कोचिंग के लिए →', 'cta.powerups': 'पावर-अप अनलॉक करें',
    'common.showall': 'बाकी exams दिखाएँ', 'common.logout': 'लॉगआउट',

    // — Landing: hero —
    'hero.h1a': 'हर परीक्षा में महारत —',
    'hero.h1b': 'AI-संचालित अभ्यास के साथ',
    'hero.sub': 'मॉक टेस्ट, अनुकूली अभ्यास, पिछले वर्षों के प्रश्न-पत्र, असली परीक्षा जैसा अनुभव — साथ में 1v1 बैटल, समूह अध्ययन, स्पेस्ड रिवीजन, असली खबरों से रोज़ करेंट अफेयर्स, टेलीग्राम ट्यूटर और अखिल भारतीय लीडरबोर्ड जो तैयारी को लत बना देता है।',
    'hero.new': 'अब केवल अभ्यास नहीं —',
    'hero.core': 'एक aspirant की हर ज़रूरत',
    'chip.qready': 'AI और PYQ प्रश्न तैयार', 'chip.exams': '8 परीक्षाएँ समर्थित',
    'chip.social': 'बैटल, समूह और AIR रैंकिंग', 'chip.ca': 'रोज़ AI करेंट अफेयर्स',
    'chip.tg': 'टेलीग्राम ट्यूटर + इंस्टॉल करने योग्य ऐप',

    // — Landing: exam cards —
    'ex.jee': 'इंजीनियरिंग', 'ex.neet': 'मेडिकल', 'ex.upsc': 'सिविल सेवा', 'ex.ssc': 'कर्मचारी चयन',
    'ex.bank': 'IBPS / SBI', 'ex.cat': 'MBA प्रवेश', 'ex.gate': 'इंजीनियरिंग PG', 'ex.cuet': 'विश्वविद्यालय प्रवेश',

    // — Landing: NEW features —
    'sec.new.b': 'प्रतिस्पर्धा, समुदाय और निरंतरता',
    'nf.battles.t': '1v1 क्विज़ बैटल',
    'nf.battles.d': 'दोस्त को इनवाइट कोड भेजें या क्विक-मैच खेलें — 30 सेकंड के राउंड, स्पीड बोनस और ELO रेटिंग लैडर। हर जीत पर लीडरबोर्ड में चमकें।',
    'nf.groups.t': 'समूह अध्ययन + चर्चा',
    'nf.groups.d': 'अपनी टीम बनाएँ, जॉइन-कोड से बुलाएँ, मिलकर चर्चा करें। ऑफ़र भी है — 2 सदस्य प्लान लें तो 3रे दोस्त की सीट मुफ़्त।',
    'nf.focus.t': 'AI फ़ोकस एरिया',
    'nf.focus.d': 'पिछले वर्षों के पेपर्स का डेटा स्कैन — कौन-सा टॉपिक बार-बार पूछा जाता है, पिछले साल कब आया। स्मार्ट प्राथमिकता।',
    'nf.revision.t': 'स्पेस्ड रिवीजन',
    'nf.revision.d': 'भूलने का विज्ञान: हर टॉपिक अपने बॉक्स में, 1-3-7-14-30 दिन के चक्र पर। “आज यह रिवाइज़ करें” रोज़ की योजना + टेलीग्राम रिमाइंडर।',
    'nf.loop.t': 'संदेह → अभ्यास लूप',
    'nf.loop.d': 'हर हल किए गए संदेह से AI 3 मिलते-जुलते प्रश्न बनाता है — तुरंत अभ्यास टेस्ट। जो संदेह आया, वह पक्का ठीक।',
    'nf.air.t': 'अखिल भारतीय रैंक + अंक',
    'nf.air.d': 'हज़ारों में AIR #? — पर्सेंटाइल के साथ। हर काम पर अंक (टेस्ट, बैटल, संदेह, समूह), लेवल और पहचान दीवार।',
    'nf.ca.t': 'करेंट अफेयर्स प्रो',
    'nf.ca.d': 'AI रोज़ 10 MCQ बनाता है — पिछले 7 दिनों की असली खबरों से (असली सुर्खियाँ, पुराना ज्ञान नहीं), आपकी टारगेट परीक्षा के अनुसार। UPSC/Banking/SSC वालों की रोज़ की आदत।',
    'nf.tg.t': 'टेलीग्राम ट्यूटर',
    'nf.tg.d': 'संदेह, रिवीजन रिमाइंडर और स्वागत संदेश — सब टेलीग्राम पर। ऐप खोलने की भी ज़रूरत नहीं, बॉट ही कोच बन जाता है।',
    'nf.pwa.t': 'इंस्टॉल करने योग्य ऐप (PWA)',
    'nf.pwa.d': 'ब्राउज़र से एक टैप में फ़ोन पर इंस्टॉल — होम स्क्रीन आइकन, तेज़ लोडिंग, प्ले स्टोर का इंतज़ार नहीं। नेटिव ऐप जैसा, अपडेट अपने आप।',

    // — Landing: core features —
    'cf.qbank.t': 'AI प्रश्न बैंक',
    'cf.qbank.d': 'DeepSeek से असीमित AI प्रश्न, Gemini फ़ॉलबैक के साथ — हर बार ताज़ा सेट।',
    'cf.pyq.t': 'पिछले वर्षों के प्रश्न-पत्र',
    'cf.pyq.d': 'एडमिन कोई भी PDF अपलोड करें — स्कैन भी — और Gemini Vision हर प्रश्न एक बार निकालता है, हमेशा के लिए।',
    'cf.sim.t': 'असली परीक्षा अनुभव',
    'cf.sim.d': 'डायनामिक टाइमर जो प्रति-प्रश्न समय लाइव अनुकूलित करता है — स्पीड, पेस, सटीकता और पूर्णता की भविष्यवाणी।',
    'cf.doubt.t': 'तुरंत संदेह समाधान',
    'cf.doubt.d': 'गलत उत्तर? टेस्ट रुक जाता है और AI ट्यूटर आगे बढ़ने से पहले समाधान समझाता है।',
    'cf.adaptive.t': 'अनुकूली अभ्यास',
    'cf.adaptive.d': 'कठिनाई आपके प्रदर्शन के अनुसार बदलती है। कमज़ोर टॉपिक अपने आप पकड़े जाते हैं।',
    'cf.analytics.t': 'गहन विश्लेषण',
    'cf.analytics.d': 'अध्याय-वार सटीकता, कमज़ोर टॉपिक विश्लेषण, व्यक्तिगत सुझाव और रैंकिंग।',

    // — Landing: power-ups —
    'sec.power.a': 'जब बुनियादी में महारत हो जाए —',
    'sec.power.sub': 'वैकल्पिक ऐड-ऑन — फ्री प्लान में पूरा कोर मिलता है, पावर-अप उसे और तेज़ करते हैं।',
    'pu.power.t': 'AI पावर पैक',
    'pu.power.d': 'AI जनरेशन का पूरा बूस्ट — असीमित नए प्रश्न, प्राथमिकता जनरेशन, तैयार होते ही कठिन सेट।',
    'pu.voice.t': 'वॉइस संदेह',
    'pu.voice.d': 'बोलकर प्रश्न पूछें — हिंदी/अंग्रेज़ी वॉइस इनपुट, AI बोलकर उत्तर दे। हाथ व्यस्त हों तब भी पढ़ाई चलती है।',
    'pu.ca.t': 'करेंट अफेयर्स प्रो',
    'pu.ca.d': 'रोज़ 10 AI MCQ असली खबरों से — परीक्षा-अनुकूलित, आज की सुर्खियों पर आधारित।',
    'pu.focus.t': 'AI फ़ोकस एरिया',
    'pu.focus.d': 'पिछले वर्षों के पेपर स्कैन — जो टॉपिक सबसे ज़्यादा दोहराया गया, उसी से शुरुआत।',

    // — Landing: social proof + B2B —
    'sp.points.t': 'अंक और लेवल',
    'sp.points.d': 'हर काम पर पहचान — Newbie से Legend तक',
    'sp.lb.t': 'लीडरबोर्ड',
    'sp.lb.d': 'AIR, परीक्षा रैंक और ELO बैटल लैडर',
    'sp.deals.t': 'समूह ऑफ़र',
    'sp.deals.d': 'दोस्तों के साथ प्लान लें — एक सीट मुफ़्त',
    'b2b.title': '{brand} पर अपना स्कूल या कोचिंग चलाएँ — छात्रों और शिक्षकों दोनों के लिए',
    'b2b.sub': 'व्हाइट-लेबल AI टेस्ट प्लेटफ़ॉर्म — आपका ब्रांड, आपके टेस्ट, शिक्षकों के लिए AI (टीच किट, क्लासरूम लाइव क्विज़, सॉफ़्ट स्किल्स) और पैरेंट्स के लिए तैयार प्रगति रिपोर्ट। 30 दिन का मुफ़्त पायलट।',

    // — Schools page —
    'sch.top.chip': 'स्कूलों और कोचिंग संस्थानों के लिए', 'sch.back': '← स्टूडेंट ऐप',
    'sch.chip.wl': '🏫 व्हाइट-लेबल प्लेटफ़ॉर्म', 'sch.chip.guru': '🎓 शिक्षकों के लिए AI — गुरु स्टूडियो',
    'sch.chip.pilot': '30 दिन का मुफ़्त पायलट', 'sch.chip.setup': '1 दिन में सेटअप',
    'sch.h1a': 'आपके स्कूल का अपना', 'sch.h1b': 'AI टेस्ट प्लेटफ़ॉर्म',
    'sch.hero.p': 'AI प्रश्न निर्माण, पिछले वर्षों के पेपर का डिजिटलीकरण, असली परीक्षा जैसा अनुभव, पैरेंट्स के लिए तैयार प्रगति रिपोर्ट — और अब ###शिक्षकों के लिए भी AI### (टीच किट, क्लासरूम लाइव क्विज़, सॉफ़्ट स्किल्स)। सब आपके स्कूल के ब्रांड के साथ। छात्र ऐप चलाते हैं, नियंत्रण आपके पास रहता है।',
    'sch.num.exams.v': '8+', 'sch.num.exams': 'परीक्षाएँ पहले से समर्थित',
    'sch.num.ai.v': 'AI', 'sch.num.ai': 'असीमित प्रश्न निर्माण',
    'sch.num.setup.v': '1 दिन', 'sch.num.setup': 'सेटअप और लॉन्च',
    'sch.num.pilot.v': '₹0', 'sch.num.pilot': '30 दिन के पायलट की लागत',
    'sch.sec.pillars': 'स्कूल को क्या मिलता है',
    'sch.pl1.t': 'आपका ब्रांड, हमारा इंजन',
    'sch.pl1.p1': 'स्कूल का लोगो, नाम और रंग — छात्रों को स्कूल का ही ऐप दिखेगा',
    'sch.pl1.p2': 'अपना सबडोमेन: yourschool.aisepadho.com (या अपना डोमेन)',
    'sch.pl1.p3': 'स्कूल का अपना एडमिन पैनल — पूरा नियंत्रण',
    'sch.pl2.t': 'टेस्ट, आपके अनुसार',
    'sch.pl2.p1': 'शिक्षक अपने पेपर अपलोड करें (PDF) — AI हर प्रश्न निकाल लेता है',
    'sch.pl2.p2': 'अध्याय-वार अभ्यास, मॉक टेस्ट, पिछले वर्षों के प्रश्न-पत्र',
    'sch.pl2.p3': 'अनुकूली AI अभ्यास — हर छात्र की क्षमता के अनुसार प्रश्न',
    'sch.pl3.t': 'पैरेंट्स को असली डेटा',
    'sch.pl3.p1': 'हर छात्र की कमज़ोर-टॉपिक रिपोर्ट — विषय, अध्याय, टॉपिक स्तर तक',
    'sch.pl3.p2': 'कक्षा-स्तरीय विश्लेषण: किस अध्याय में पूरी कक्षा कमज़ोर है',
    'sch.pl3.p3': 'प्रिंट/शेयर करने योग्य प्रगति रिपोर्ट — PTM का सबसे बड़ा प्रमाण',
    'sch.pl4.t': 'डेटा सुरक्षित, शून्य झंझट',
    'sch.pl4.p1': 'एन्क्रिप्टेड क्लाउड स्टोरेज (खोने वाली कोई लोकल फ़ाइल नहीं)',
    'sch.pl4.p2': 'छात्रों का डेटा सिर्फ़ स्कूल के नियंत्रण में',
    'sch.pl4.p3': '1 दिन में सेटअप — शिक्षकों को 30 मिनट की ट्रेनिंग PDF गाइड',
    'sch.sec.guru.a': 'शिक्षकों के लिए भी AI —', 'sch.sec.guru.b': 'गुरु स्टूडियो',
    'sch.sec.guru.sub': 'सिर्फ़ छात्र नहीं — आपके शिक्षकों को भी प्लेटफ़ॉर्म में AI मिलता है। अध्यापन गुणवत्ता, कक्षा सहभागिता और व्यक्तित्व विकास — सब शामिल।',
    'sch.g1.t': 'टीच किट — टॉपिक-वार AI पाठ पैक',
    'sch.g1.p1': 'हर टॉपिक का कॉन्सेप्ट मैप + वास्तविक जीवन के उदाहरण + 30-मिनट पाठ योजना',
    'sch.g1.p2': 'सामान्य भ्रांतियाँ — सामान्य सूची नहीं, आपके छात्रों के वास्तविक कमज़ोर-टॉपिक डेटा से',
    'sch.g1.p3': 'PYQ आवृत्ति + कठिनाई सीढ़ी — पहले क्या पढ़ाना है, AI बताता है',
    'sch.g1.p4': 'कक्षा के बाद गृहकार्य स्वतः असाइन (प्लेटफ़ॉर्म टेस्ट)',
    'sch.g2.t': 'क्लासरूम लाइव क्विज़ — पूरी कक्षा झूम उठेगी',
    'sch.g2.p1': 'गेम-आधारित क्विज़: प्रोजेक्टर पर होस्ट स्क्रीन, छात्र फ़ोन से 4-अंकीय PIN से जुड़ें',
    'sch.g2.p2': '15-सेकंड टाइमर, लाइव लीडरबोर्ड, स्पीड बोनस, विजेता उत्सव',
    'sch.g2.p3': 'मोड: रैपिड फायर · टीम बैटल · रिवीजन रंबल (देय रिवीजन के प्रश्न)',
    'sch.g2.p4': 'पूरी तरह इंटरैक्टिव लर्निंग प्लेटफ़ॉर्म — केवल टेस्ट नहीं, साथ में अभ्यास, प्रतिस्पर्धा और रिवीजन',
    'sch.g3.t': 'कन्फ़्यूज़न चेक — 2-सेकंड की कक्षा नब्ज़',
    'sch.g3.p1': 'कक्षा के बीच पोल: “यह कॉन्सेप्ट साफ़ है?” — छात्र फ़ोन पर 👍/👎 दबाएँ',
    'sch.g3.p2': '30%+ उलझन? AI तुरंत वैकल्पिक व्याख्या + दूसरा उदाहरण देता है',
    'sch.g3.p3': 'समय और बजट दोनों की बचत — AI की अतिरिक्त व्याख्या तभी जब कक्षा को सच में ज़रूरत हो',
    'sch.g4.t': 'व्यक्तित्व और सॉफ़्ट स्किल्स (NEP-अनुरूप)',
    'sch.g4.p1': 'GD सिम्युलेटर — 3-4 AI पात्रों के साथ समूह चर्चा + फ़ीडबैक',
    'sch.g4.p2': 'एक-मिनट भाषण — वॉइस इनपुट, फ़िलर शब्द और गति पर फ़ीडबैक',
    'sch.g4.p3': 'इंटरव्यू अभ्यास + व्यक्तित्व रिपोर्ट कार्ड (रडार चार्ट) — PTM के लिए प्रिंटेबल',
    'sch.sec.steps': 'शुरुआत कैसे होती है',
    'sch.s1.t': '30 दिन का मुफ़्त पायलट', 'sch.s1.d': 'एक कक्षा (अधिकतम 60 छात्र) के साथ पूरा प्लेटफ़ॉर्म — मुफ़्त। कोई कार्ड, कोई ठेका नहीं।',
    'sch.s2.t': 'शिक्षकों का ऑनबोर्डिंग', 'sch.s2.d': 'पेपर अपलोड + टेस्ट असाइन। गुरु स्टूडियो में टीच किट से पढ़ाएँ, क्लासरूम लाइव क्विज़ से कक्षा जोड़ें — 30-मिनट वॉकथ्रू मुफ़्त।',
    'sch.s3.t': 'पैरेंट्स देखें परिणाम', 'sch.s3.d': 'साप्ताहिक प्रगति रिपोर्ट — स्कूल के लोगो के साथ। PTM में यही सबसे ज़्यादा पसंद आता है।',
    'sch.s4.t': 'पूरा स्कूल / कोचिंग जोड़ें', 'sch.s4.d': 'पायलट पसंद आए तो वार्षिक योजना — प्रति-छात्र मूल्य, पूरे स्कूल या कोचिंग में रोलआउट।',
    'sch.pricing.t': 'मूल्य — सरल, प्रति छात्र',
    'sch.pricing.d1': '₹50–100 / छात्र / वर्ष (स्कूल आकार अनुसार) · या ₹25k–1L / वर्ष निश्चित।',
    'sch.pricing.d2': 'कोचिंग संस्थान: ₹5k–25k / माह। पायलट के दौरान',
    'sch.pricing.free': '₹0',
    'sch.pricing.cta': 'पायलट का अनुरोध →',
    'sch.faq.t': 'एक FAQ — जो हर प्रिंसिपल पूछता है',
    'sch.f1.q': '📱 छात्रों को नया ऐप डाउनलोड करना पड़ेगा?', 'sch.f1.a': 'नहीं — ब्राउज़र में चलता है, फ़ोन/लैपटॉप दोनों पर। इंस्टॉल वैकल्पिक है (PWA)।',
    'sch.f2.q': '🧑‍🏫 शिक्षकों को तकनीकी ज्ञान चाहिए?', 'sch.f2.a': 'बस PDF अपलोड करना आना चाहिए — AI बाकी सब करता है।',
    'sch.f3.q': '🔒 छात्रों का डेटा कहाँ जाता है?', 'sch.f3.a': 'एन्क्रिप्टेड क्लाउड स्टोरेज। स्कूल के नियंत्रण से बाहर साझा नहीं होता।',
    'sch.f4.q': '🇮🇳 हिंदी में भी?', 'sch.f4.a': 'हाँ — संदेह हिंदी/हिंग्लिश में पूछे जा सकते हैं (वॉइस भी)।',
    'sch.f5.q': '🎓 शिक्षकों के लिए भी कुछ है?', 'sch.f5.a': 'हाँ — गुरु स्टूडियो: AI टीच किट, गेम-आधारित क्लासरूम लाइव क्विज़ और सॉफ़्ट स्किल्स (GD, भाषण, व्यक्तित्व रिपोर्ट)। शिक्षकों को बस PDF अपलोड आना चाहिए — AI बाकी करता है।',
    'sch.foot.tag': 'AI-संचालित टेस्ट अभ्यास',

    // — Auth pages —
    'auth.login.t': 'वापसी पर स्वागत है', 'auth.login.s': 'अपनी तैयारी जारी रखने के लिए लॉग इन करें',
    'auth.email': 'ईमेल', 'auth.password': 'पासवर्ड',
    'auth.login.btn': 'लॉग इन', 'auth.logging': 'लॉग इन हो रहा है…',
    'auth.newhere': 'नए हैं?', 'auth.create': 'खाता बनाएँ',
    'auth.toast.welcome': 'वापसी पर स्वागत है!',
    'auth.reg.t': 'अपना खाता बनाएँ', 'auth.reg.s': 'आज ही मुफ़्त AI-संचालित अभ्यास शुरू करें',
    'auth.name': 'पूरा नाम', 'auth.min6': 'न्यूनतम 6 अक्षर', 'auth.target': 'लक्ष्य परीक्षा',
    'auth.invite': 'स्कूल / कोचिंग इनवाइट कोड (वैकल्पिक)',
    'auth.signup': 'साइन अप', 'auth.creating': 'खाता बन रहा है…', 'auth.already': 'पहले से पंजीकृत हैं?',
    'auth.toast.created': 'खाता बन गया!',
    'auth.joining': '🏫 {inst} से जुड़ रहे हैं — खाता स्वतः लिंक हो जाएगा!',
    'auth.invite.bad': '⚠️ इनवाइट कोड अमान्य या समाप्त — बिना कोड भी पंजीकरण कर सकते हैं।'
  }
}

const Ctx = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLang] = useState(detect)

  useEffect(() => {
    try { localStorage.setItem(LANG_KEY, lang) } catch { /* ignore */ }
    document.documentElement.lang = lang === 'hi' ? 'hi' : 'en'
  }, [lang])

  const t = useCallback((key) => (strings[lang] && strings[lang][key]) || strings.en[key] || key, [lang])

  const set = useCallback((next) => {
    if (LANGS.includes(next)) setLang(next)
  }, [])

  return <Ctx.Provider value={{ lang, set, t, langs: LANGS }}>{children}</Ctx.Provider>
}

export function useLang() {
  const v = useContext(Ctx)
  return v || { lang: 'hinglish', set: () => {}, t: (k) => strings.en[k] || k, langs: LANGS }
}

// ---------------------------------------------------------------------------
// Compact header switcher — works logged-in and logged-out, any topbar.
// ---------------------------------------------------------------------------
export function LangSwitcher({ compact = false }) {
  const { lang, set } = useLang()
  const options = [
    { key: 'en', label: 'EN' },
    { key: 'hinglish', label: 'Hinglish' },
    { key: 'hi', label: 'हिं' }
  ]
  return (
    <div className="lang-switch" role="group" aria-label="Language / भाषा"
      style={{ display: 'inline-flex', gap: 2, background: 'var(--bg-2, rgba(255,255,255,0.06))', borderRadius: 999, padding: 2, border: '1px solid rgba(255,255,255,0.08)' }}>
      {options.map((o) => (
        <button key={o.key}
          onClick={() => set(o.key)}
          aria-pressed={lang === o.key}
          title={o.key === 'hi' ? 'हिंदी' : o.key === 'en' ? 'English' : 'Hinglish'}
          style={{
            border: 'none', cursor: 'pointer', borderRadius: 999, padding: compact ? '2px 8px' : '3px 10px',
            fontSize: compact ? 11 : 12, fontWeight: lang === o.key ? 700 : 500,
            color: lang === o.key ? '#fff' : 'rgba(255,255,255,0.62)',
            background: lang === o.key ? 'linear-gradient(135deg, var(--accent, #6366f1), var(--accent2, #22d3ee))' : 'transparent'
          }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
