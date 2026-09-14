import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'

// ---------------------------------------------------------------------------
// UI language: English / Hinglish / हिंदी.
// - Persisted in localStorage ('lang'), reflected on <html lang> for a11y.
// - t(key) falls back to the English string when a translation is missing, so
//   a partial translation never renders [key] junk.
// - Question-language (English/Hindi bilingual exam papers) is separate —
//   Practice.jsx picks it per test and it flows to the AI generation prompt.
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
    'nav.dashboard': 'Dashboard', 'nav.practice': 'Practice', 'nav.tests': 'Mock Tests',
    'nav.adaptive': 'Adaptive Practice', 'nav.focus': 'AI Focus Areas', 'nav.ca': 'Current Affairs',
    'nav.doubts': 'Doubt Solving', 'nav.groups': 'Group Study', 'nav.battles': 'Quiz Battles',
    'nav.bookmarks': 'Bookmarked', 'nav.history': 'Test History', 'nav.retention': 'Data Retention',
    'nav.revision': 'AI Revision', 'nav.rankings': 'Rankings', 'nav.analytics': 'Analytics & Report',
    'lang.qhint': 'Question paper language', 'lang.qen': 'English', 'lang.qhi': 'हिंदी', 'lang.qboth': 'English + हिंदी (bilingual)',
    'cta.start': 'Start practicing free', 'cta.login': 'Log in', 'cta.signup': 'Sign up free',
    'cta.schools': 'For Schools →', 'hero.new': 'Ab sirf practice nahi —', 'hero.core': 'Everything an aspirant needs',
    'cta.pilot': 'Book a free pilot', 'cta.tryfirst': 'Try the student app first', 'cta.guruline': 'For Schools & Coaching →',
    'cta.powerups': 'Power-ups unlock karo', 'common.showall': 'Show all exams', 'common.logout': 'Logout'
  },
  hinglish: {
    'nav.dashboard': 'Dashboard', 'nav.practice': 'Practice', 'nav.tests': 'Mock Tests',
    'nav.adaptive': 'Adaptive Practice', 'nav.focus': 'AI Focus Areas', 'nav.ca': 'Current Affairs',
    'nav.doubts': 'Doubt Solving', 'nav.groups': 'Group Study', 'nav.battles': 'Quiz Battles',
    'nav.bookmarks': 'Bookmarked', 'nav.history': 'Test History', 'nav.retention': 'Data Retention',
    'nav.revision': 'AI Revision', 'nav.rankings': 'Rankings', 'nav.analytics': 'Analytics & Report',
    'lang.qhint': 'Question paper ki language', 'lang.qen': 'English', 'lang.qhi': 'हिंदी', 'lang.qboth': 'English + हिंदी (bilingual)',
    'cta.start': 'Free practice shuru karo', 'cta.login': 'Log in', 'cta.signup': 'Free signup karo',
    'cta.schools': 'Schools ke liye →', 'hero.new': 'Ab sirf practice nahi —', 'hero.core': 'Jo ek aspirant ko chahiye',
    'cta.pilot': 'Free pilot book karo', 'cta.tryfirst': 'Pehle student app try karo', 'cta.guruline': 'Schools & Coaching ke liye →',
    'cta.powerups': 'Power-ups unlock karo', 'common.showall': 'Dusre exams dikhao', 'common.logout': 'Logout'
  },
  hi: {
    'nav.dashboard': 'डैशबोर्ड', 'nav.practice': 'अभ्यास', 'nav.tests': 'मॉक टेस्ट',
    'nav.adaptive': 'अनुकूली अभ्यास', 'nav.focus': 'AI फ़ोकस एरिया', 'nav.ca': 'करेंट अफेयर्स',
    'nav.doubts': 'संदेह समाधान', 'nav.groups': 'समूह अध्ययन', 'nav.battles': 'क्विज़ बैटल',
    'nav.bookmarks': 'बुकमार्क', 'nav.history': 'टेस्ट इतिहास', 'nav.retention': 'डेटा रिटेंशन',
    'nav.revision': 'AI रिवीजन', 'nav.rankings': 'रैंकिंग', 'nav.analytics': 'विश्लेषण और रिपोर्ट',
    'lang.qhint': 'प्रश्न-पत्र की भाषा', 'lang.qen': 'अंग्रेज़ी', 'lang.qhi': 'हिंदी', 'lang.qboth': 'अंग्रेज़ी + हिंदी (द्विभाषी)',
    'cta.start': 'मुफ़्त अभ्यास शुरू करें', 'cta.login': 'लॉग इन', 'cta.signup': 'मुफ़्त साइन अप',
    'cta.schools': 'स्कूलों के लिए →', 'hero.new': 'अब केवल अभ्यास नहीं —', 'hero.core': 'हर aspirant की ज़रूरतें',
    'cta.pilot': 'मुफ़्त पायलट बुक करें', 'cta.tryfirst': 'पहले स्टूडेंट ऐप आज़माएँ', 'cta.guruline': 'स्कूल और कोचिंग के लिए →',
    'cta.powerups': 'पावर-अप अनलॉक करें', 'common.showall': 'बाकी exams दिखाएँ', 'common.logout': 'लॉगआउट'
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
