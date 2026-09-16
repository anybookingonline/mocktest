import React, { useEffect, useState } from 'react'
import { useLang } from '../context/LangContext.jsx'

// ---------------------------------------------------------------------------
// Guided platform tour. Shows once per role (student/admin) on first login —
// a compact step-by-step "kya kahan hai, kaise chalao" walkthrough. The
// sidebar "?" button reopens it anytime. Progress is per-device localStorage
// (per-account would need an API column; device-level is enough here).
//
// Fully language-aware: every step (title/body/tip) and the chrome buttons
// (Skip/Next/Done/step counter) render in the user's selected UI language
// (en / hinglish / hi), matching the marketing-site language switcher.
// ---------------------------------------------------------------------------

const STUDENT_STEPS = {
  hinglish: [
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
      body: 'Timer, pace dashboard, negative marking — sab asli exam jaisa. Galat jawab par test pause hokar AI tutor solution samjhata hai, phir wahi se continue.',
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
      body: 'Free accounts me attempt history limited rehti hai. Plan lete hi poora history + AI Power Pack features turant unlock ho jate hain.',
      tip: 'Plans page par sirf live add-ons dikhte hain.'
    }
  ],
  en: [
    {
      icon: '🎯', title: 'First step: set your target exam',
      body: 'Your target exam sits at the top of the dashboard. All practice, tests and rankings follow it. Wrong exam? Click another exam card — it becomes your new target.',
      tip: 'The exam you chose at signup is the default.'
    },
    {
      icon: '✏️', title: 'Practice — daily drills',
      body: 'Chapter-wise and topic-wise questions. Not just right/wrong: instant solutions after every question, and bookmark the tricky ones as you go.',
      tip: 'Bookmarked questions 🔖 are gold for revision later.'
    },
    {
      icon: '⏱️', title: 'Mock tests — real exam feel',
      body: 'Timer, pace dashboard, negative marking — everything like the real exam. On a wrong answer the test pauses, the AI tutor explains the solution, then resumes exactly where it stopped.',
      tip: 'Time per question auto-adjusts live — keep an eye on the pace dashboard.'
    },
    {
      icon: '🧠', title: 'Adaptive practice — AI knows your level',
      body: "Difficulty rises when you're right, eases when you're wrong. Weak topics get picked up automatically and appear more often. You can also pick a topic for targeted practice.",
      tip: 'Keep your streak going — consistency gives the engine better data.'
    },
    {
      icon: '🔁', title: 'AI revision — stop forgetting',
      body: 'Topics you got wrong come back on a 1-3-7-14-30 day cycle. The revision page gives you a ready daily plan: "revise this today".',
      tip: 'Linked the Telegram bot? Daily reminders arrive there too.'
    },
    {
      icon: '⚔️', title: 'Battles & groups — make studying social',
      body: 'Duel friends in 1v1 ELO battles (3 free a day). Build a squad in groups — when 2 members take a plan, 1 friend gets a FREE chat seat. Every action earns points: level up from Newbie to Legend.',
      tip: 'Points and level show on your profile — every test, battle and doubt counts.'
    },
    {
      icon: '🏆', title: 'Rankings & analytics — know where you stand',
      body: 'All-India Rank with percentile, exam leaderboards, chapter-wise accuracy, weak-topic analysis and score trends. Make your next move from data, not guesswork.',
      tip: 'The weak-topics section in Analytics is your syllabus priority list.'
    },
    {
      icon: '🔒', title: 'Data retention — your data, yours',
      body: 'Free accounts keep limited test history. Buy a plan and full history plus AI Power Pack features unlock instantly.',
      tip: 'The Plans page only shows live add-ons.'
    }
  ],
  hi: [
    {
      icon: '🎯', title: 'पहला कदम: अपनी लक्ष्य परीक्षा चुनें',
      body: 'डैशबोर्ड पर आपकी लक्ष्य परीक्षा सबसे ऊपर दिखती है। सारा अभ्यास, टेस्ट और रैंकिंग उसी के अनुसार दिखेंगे। गलत परीक्षा चुनी है? किसी और परीक्षा के कार्ड पर क्लिक करें — वही नया लक्ष्य बन जाएगा।',
      tip: 'साइनअप के समय चुनी गई परीक्षा ही डिफ़ॉल्ट होती है।'
    },
    {
      icon: '✏️', title: 'अभ्यास — रोज़ की पढ़ाई',
      body: 'अध्याय-वार और विषय-वार प्रश्न। सही-गलत ही नहीं: हर प्रश्न के बाद तुरंत समाधान, और बुकमार्क आइकन से कठिन सवाल सेव करते जाएँ।',
      tip: 'बुकमार्क किए प्रश्न 🔖 पेज पर रिवीजन के लिए काम आते हैं।'
    },
    {
      icon: '⏱️', title: 'मॉक टेस्ट — असली परीक्षा का अनुभव',
      body: 'टाइमर, पेस डैशबोर्ड, नेगेटिव मार्किंग — सब असली परीक्षा जैसा। गलत उत्तर पर टेस्ट रुकता है, AI ट्यूटर समाधान समझाता है, फिर वहीं से जारी रहता है।',
      tip: 'प्रति-प्रश्न समय लाइव अनुकूलित होता है — पेस डैशबोर्ड पर नज़र रखें।'
    },
    {
      icon: '🧠', title: 'अनुकूली अभ्यास — AI आपका स्तर जानता है',
      body: 'सही उत्तर पर कठिनाई बढ़ेगी, गलत पर घटेगी। आपके कमज़ोर विषय अपने आप पकड़े जाते हैं और वही प्रश्न ज़्यादा आएँगे। विषय चुनकर विशेष अभ्यास भी कर सकते हैं।',
      tip: 'स्ट्रीक बनाए रखें — निरंतरता से इंजन को बेहतर डेटा मिलता है।'
    },
    {
      icon: '🔁', title: 'AI रिवीजन — भूलना बंद',
      body: 'जो विषय गलत किए, वे 1-3-7-14-30 दिन के चक्र में अपने आप लौटेंगे। रिवीजन पेज पर रोज़ की योजना तैयार मिलती है: "आज यह दोहराएँ"।',
      tip: 'टेलीग्राम बॉट जोड़ा है तो रोज़ रिमाइंडर वहीं से आएगा।'
    },
    {
      icon: '⚔️', title: 'बैटल और समूह — पढ़ाई को सामाजिक बनाएँ',
      body: '1v1 बैटल में दोस्तों से ELO मुकाबला खेलें (रोज़ 3 मुफ़्त)। समूह में टीम बनाएँ — 2 सदस्य प्लान लें तो 1 दोस्त की चैट सीट मुफ़्त। हर काम पर अंक मिलते हैं: न्यूबी से लेजेंड तक लेवल अप करें।',
      tip: 'अंक/लेवल प्रोफ़ाइल में दिखता है — हर टेस्ट, बैटल और प्रश्न गिनता है।'
    },
    {
      icon: '🏆', title: 'रैंकिंग और विश्लेषण — अपनी स्थिति जानें',
      body: 'ऑल-इंडिया रैंक पर्सेंटाइल के साथ, परीक्षा-वार लीडरबोर्ड, अध्याय-वार सटीकता, कमज़ोर विषय विश्लेषण और स्कोर रुझान। डेटा देखकर ही अगला कदम बनाएँ।',
      tip: 'विश्लेषण का कमज़ोर-विषय हिस्सा ही आपकी सिलेबस प्राथमिकता सूची है।'
    },
    {
      icon: '🔒', title: 'डेटा रिटेंशन — आपका डेटा आपका',
      body: 'मुफ़्त खातों में टेस्ट इतिहास सीमित रहता है। प्लान लेते ही पूरा इतिहास और AI पावर पैक सुविधाएँ तुरंत अनलॉक हो जाती हैं।',
      tip: 'प्लान्स पेज पर सिर्फ़ सक्रिय ऐड-ऑन दिखते हैं।'
    }
  ]
}

const ADMIN_STEPS = {
  hinglish: [
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
  ],
  en: [
    {
      icon: '🚀', title: 'Day-1 setup: exams + syllabus',
      body: 'Create exams (duration, marking) on the Exams page. Build the subject → chapter → topic tree in Syllabus — questions map onto it, so build the skeleton first.',
      tip: 'Seed data ships with 8 exams — edit them or create your own.'
    },
    {
      icon: '❓', title: 'The question bank fills in two ways',
      body: '1) Add a DeepSeek/Gemini key in AI Config — AI generates questions itself. 2) Upload any PYQ PDF (even scanned) in PDF Import — Gemini Vision extracts every question. Both land in one bank.',
      tip: 'Re-uploading the same PDF is blocked by the dedup hash.'
    },
    {
      icon: '🤖', title: 'AI Config = the platform brain',
      body: 'Providers, API keys and the fallback chain live here. Verify with "Test connection". Feature toggles are here too: Groups, Battles, Voice, Telegram — switch ON and they appear in the student nav instantly (OFF = hidden + API 403).',
      tip: 'If an AI provider goes down, the fallback chain switches automatically.'
    },
    {
      icon: '🎁', title: 'Pricing and deals run from here',
      body: 'Set add-on pricing (price/validity) in AI Config — only enabled ones show on the Plans page. Tune the group deal in the free-seat deal builder: "N paid → M free" in one click.',
      tip: 'Kill-switch design: every feature toggles without a redeploy.'
    },
    {
      icon: '🏫', title: 'B2B: onboard a school/coaching',
      body: 'Create an institute → get an invite code → students registering with the code auto-join it. Create the sub-admin (owner) login — they see only their own students, never the platform.',
      tip: 'Bulk CSV creates a whole classroom in one shot.'
    },
    {
      icon: '📈', title: 'Users, payments, analytics',
      body: 'Users: all accounts plus manual plan activation. Payments: verify QR/proof and mark paid. Analytics shows platform-wide health: exams, questions, daily activity.',
      tip: 'The Retention page shows which free users are worth a plan.'
    },
    {
      icon: '⚙️', title: 'Branding — your name everywhere',
      body: 'Set platform name, tagline, logo and support email in Settings — landing, login, tab title and the Telegram bot all rebrand live. Domain + Telegram webhook steps are in launch-runbook.md.',
      tip: 'The support email is also used on the Schools page CTAs.'
    }
  ],
  hi: [
    {
      icon: '🚀', title: 'पहले दिन का सेटअप: परीक्षा + पाठ्यक्रम',
      body: 'Exams पेज पर परीक्षा बनाएँ (अवधि, मार्किंग)। Syllabus में विषय → अध्याय → टॉपिक का पेड़ बनाएँ — प्रश्न इसी से जुड़ते हैं, इसलिए ढाँचा पहले बनाएँ।',
      tip: 'सीड डेटा में 8 परीक्षाएँ पहले से हैं — उन्हें संपादित करें या नई बनाएँ।'
    },
    {
      icon: '❓', title: 'प्रश्न बैंक दो तरीकों से भरता है',
      body: '1) AI Config में DeepSeek/Gemini की डालें — AI प्रश्न खुद बनाता है। 2) PDF Import पर कोई भी PYQ PDF अपलोड करें (स्कैन भी चलेगा) — Gemini Vision हर प्रश्न निकाल लेता है। दोनों एक ही बैंक में जाते हैं।',
      tip: 'वही PDF दोबारा अपलोड करने पर डीडुप हैश रोक देता है।'
    },
    {
      icon: '🤖', title: 'AI Config = प्लेटफ़ॉर्म का दिमाग',
      body: 'प्रोवाइडर, API की और फ़ॉलबैक चेन यहाँ हैं। "Test connection" से जाँचें। फ़ीचर टॉगल भी यहीं हैं: Groups, Battles, Voice, Telegram — ON करते ही छात्र नेविगेशन में दिखने लगते हैं (OFF = छिपा + API 403)।',
      tip: 'कोई AI प्रोवाइडर बंद हो जाए तो फ़ॉलबैक चेन अपने आप बदल लेती है।'
    },
    {
      icon: '🎁', title: 'मूल्य और डील यहीं से चलते हैं',
      body: 'AI Config में ऐड-ऑन मूल्य (कीमत/अवधि) सेट करें — सक्रिय वाले ही प्लान्स पेज पर दिखते हैं। समूह डील फ़्री-सीट डील बिल्डर से ट्यून करें: "कितने पेड → कितनी मुफ़्त" एक क्लिक में।',
      tip: 'किल-स्विच डिज़ाइन: हर फ़ीचर बिना रीडिप्लॉय ON/OFF।'
    },
    {
      icon: '🏫', title: 'B2B: स्कूल/कोचिंग जोड़ें',
      body: 'Institutes पेज पर संस्थान बनाएँ → इनवाइट कोड मिलेगा → उस कोड से रजिस्टर करने वाले छात्र अपने आप जुड़ जाएँगे। सब-एडमिन (मालिक) का लॉगिन बनाएँ — वे सिर्फ़ अपने छात्र देख सकते हैं, प्लेटफ़ॉर्म नहीं।',
      tip: 'बल्क CSV से पूरी कक्षा एक बार में बन जाती है।'
    },
    {
      icon: '📈', title: 'उपयोगकर्ता, भुगतान, विश्लेषण',
      body: 'Users में सभी खाते + मैन्युअल प्लान सक्रियण। Payments में QR/प्रमाण जाँचकर पेड मार्क करें। Analytics से प्लेटफ़ॉर्म-व्यापी सेहत: परीक्षाएँ, प्रश्न, दैनिक गतिविधि।',
      tip: 'रिटेंशन पेज बताता है कौन-सा मुफ़्त उपयोगकर्ता प्लान के लायक है।'
    },
    {
      icon: '⚙️', title: 'ब्रांडिंग — आपका नाम हर जगह',
      body: 'Settings में प्लेटफ़ॉर्म नाम, टैगलाइन, लोगो और सपोर्ट ईमेल सेट करें — लैंडिंग, लॉगिन, टैब शीर्षक और टेलीग्राम बॉट सब लाइव रीब्रांड हो जाते हैं। डोमेन + टेलीग्राम वेबहुक के चरण launch-runbook.md में हैं।',
      tip: 'सपोर्ट ईमेल स्कूल्स पेज के CTA बटनों में भी उपयोग होता है।'
    }
  ]
}

// Chrome (buttons + step counter) per language too.
const CHROME = {
  en: { step: (i, n) => `Step ${i}/${n}`, skip: 'Skip tour', next: 'Next →', done: '✓ Done' },
  hinglish: { step: (i, n) => `Step ${i}/${n}`, skip: 'Tour chhodo', next: 'Aage →', done: '✓ Ho gaya' },
  hi: { step: (i, n) => `चरण ${i}/${n}`, skip: 'टूर छोड़ें', next: 'आगे →', done: '✓ पूरा हुआ' }
}

export default function Tour({ role = 'student', autoOpen = false, force = false, onClose }) {
  const { lang } = useLang()
  const allSteps = role === 'admin' ? ADMIN_STEPS : STUDENT_STEPS
  // Any known language gets its own copy; unknown values fall back to hinglish.
  const steps = allSteps[lang] || allSteps.hinglish
  const chrome = CHROME[lang] || CHROME.hinglish
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
          <span className="tiny muted">{chrome.step(i + 1, steps.length)}</span>
        </div>
        <b style={{ display: 'block', fontSize: 17, marginBottom: 8 }}>{step.title}</b>
        <p className="small" style={{ lineHeight: 1.8 }}>{step.body}</p>
        <div className="card muted-bg" style={{ border: 'none', padding: '8px 12px', marginTop: 10 }}>
          <span className="tiny">💡 {step.tip}</span>
        </div>
        <div className="spread mt">
          <button className="btn btn-ghost btn-sm" onClick={() => close(true)}>{chrome.skip}</button>
          <div className="row" style={{ gap: 8 }}>
            {i > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setI(i - 1)}>←</button>}
            {i < steps.length - 1
              ? <button className="btn btn-primary btn-sm" onClick={() => setI(i + 1)}>{chrome.next}</button>
              : <button className="btn btn-accent btn-sm" onClick={() => close(true)}>{chrome.done}</button>}
          </div>
        </div>
      </div>
    </div>
  )
}
