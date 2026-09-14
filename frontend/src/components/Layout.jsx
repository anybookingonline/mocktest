import React, { useEffect, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'
import { BrandLogo } from '../context/BrandingContext.jsx'
import { useLang, LangSwitcher } from '../context/LangContext.jsx'
import { api } from '../api/client.js'

const STUDENT_NAV = [
  { to: '/', label: 'nav.dashboard', icon: '📊', group: 'Learn' },
  { to: '/practice', label: 'nav.practice', icon: '✏️' },
  { to: '/tests', label: 'nav.tests', icon: '⏱️' },
  { to: '/adaptive', label: 'nav.adaptive', icon: '🧠' },
  { to: '/focus', label: 'nav.focus', icon: '🔥' },
  { to: '/current-affairs', label: 'nav.ca', icon: '📰' },
  { to: '/doubts', label: 'nav.doubts', icon: '💬' },
  { to: '/groups', label: 'nav.groups', icon: '👥' },
  { to: '/battles', label: 'nav.battles', icon: '⚔️' },
  { to: '/bookmarks', label: 'nav.bookmarks', icon: '🔖' },
  { to: '/history', label: 'nav.history', icon: '🗂️' },
  { to: '/retention', label: 'nav.retention', icon: '🔒', group: 'Track' },
  { to: '/revision', label: 'nav.revision', icon: '🔁' },
  { to: '/rankings', label: 'nav.rankings', icon: '🏆', group: 'Track' },
  { to: '/analytics', label: 'nav.analytics', icon: '📈' }
]

// Feature flags with a 60s module cache so every page mount doesn't re-fetch.
let _flagsCache = null
let _flagsAt = 0
export function useFeatureFlags() {
  const [flags, setFlags] = useState(_flagsCache || {})
  useEffect(() => {
    if (_flagsCache && Date.now() - _flagsAt < 60000) return
    api.get('/ai/features').then((d) => { _flagsCache = d || {}; _flagsAt = Date.now(); setFlags(_flagsCache) }).catch(() => {})
  }, [])
  return flags
}

const ADMIN_NAV = [
  { to: '/admin', label: 'Dashboard', icon: '📊', group: 'Overview' },
  { to: '/admin/exams', label: 'Exams', icon: '🎯' },
  { to: '/admin/syllabus', label: 'Syllabus', icon: '🗺️' },
  { to: '/admin/questions', label: 'Question Bank', icon: '❓' },
  { to: '/admin/import', label: 'PDF Import (PYQs)', icon: '📄' },
  { to: '/admin/ai', label: 'AI Config', icon: '🤖', group: 'System' },
  { to: '/admin/users', label: 'Users', icon: '👥' },
  { to: '/admin/reports', label: 'Analytics & Reports', icon: '📈' },
  { to: '/admin/payments', label: 'Payments & Retention', icon: '💳', group: 'System' },
  { to: '/admin/institutes', label: '🏫 Institutes (B2B)' },
  { to: '/admin/settings', label: 'Settings', icon: '⚙️' }
]

export function Brand({ onClick }) {
  // White-label: name/logo/colors come from the branding provider (platform
  // settings, or the institute's branding when viewing via their domain/link)
  return (
    <div className="brand" onClick={onClick} style={{ cursor: 'pointer' }}>
      <BrandLogo />
    </div>
  )
}

// Nav labels: raw strings (admin pages) and i18n keys (student pages) both
// render through the language context.
function SideNav({ nav, active, onNavigate }) {
  const { t } = useLang()
  let lastGroup = null
  return (
    <nav>
      {nav.map((item) => {
        const label = (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-item ${isActive || active === item.to ? 'active' : ''}`}
            onClick={onNavigate}
          >
            <span className="ic">{item.icon}</span>{t(item.label)}
          </NavLink>
        )
        const groupLabel = item.group && item.group !== lastGroup
        lastGroup = item.group
        return (
          <React.Fragment key={item.to}>
            {groupLabel && <div className="group-label">{item.group}</div>}
            {label}
          </React.Fragment>
        )
      })}
    </nav>
  )
}

export function AppShell({ nav, title, children, footer, onTitle }) {
  const { user, logout } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  // Recognition chip: live points + level in the topbar (students only)
  const [pts, setPts] = useState(null)
  useEffect(() => {
    if (user?.role === 'admin') return
    let live = true
    const load = () => api.get('/analytics/points').then((d) => { if (live) setPts(d) }).catch(() => {})
    load()
    const t = setInterval(load, 60000)
    return () => { live = false; clearInterval(t) }
  }, [user?.role, user?.id])
  const initial = (user?.name || 'U').trim().charAt(0).toUpperCase()

  return (
    <div className="app">
      {open && <div className="mobile-backdrop" onClick={() => setOpen(false)} />}
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <Brand onClick={() => { navigate('/'); setOpen(false) }} />
        <SideNav nav={nav} onNavigate={() => setOpen(false)} />
        <div className="side-foot">
          {user?.role === 'admin'
            ? <a href="/" onClick={(e) => { e.preventDefault(); navigate('/'); }}>→ Go to Student Portal</a>
            : <a href="/admin" onClick={(e) => { e.preventDefault(); navigate('/admin'); }}>→ Admin Panel</a>}
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="burger" onClick={() => setOpen(true)}>☰</button>
          <h1>{typeof title === 'function' ? title() : title}</h1>
          <div className="spacer" />
          <LangSwitcher compact />
          <div className="user-chip">
            {user?.role !== 'admin' && pts && (
              <button className="chip" style={{ cursor: 'pointer', fontWeight: 700 }}
                title={`${pts.level?.name} · Level ${pts.level?.level} · Global rank #${pts.globalRank}`}
                onClick={() => navigate('/rankings')}>
                {pts.level?.icon} {pts.total} pts
              </button>
            )}
            <span className="small muted">{user?.name}</span>
            <div className="avatar">{initial}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate('/login') }}>{t('common.logout')}</button>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  )
}

export function StudentLayout({ title, children }) {
  const flags = useFeatureFlags()
  // Dynamic nav: admin-toggled features appear/disappear for students live.
  const nav = STUDENT_NAV.filter((i) => {
    if (i.to === '/groups') return Boolean(flags.groupStudy)
    if (i.to === '/battles') return Boolean(flags.battles)
    if (i.to === '/focus') return Boolean(flags.focusAreas)
    if (i.to === '/current-affairs') return Boolean(flags.currentAffairs)
    return true
  })
  return <AppShell nav={nav} title={title}>{children}</AppShell>
}

export function AdminLayout({ title, children }) {
  const { user } = useAuth()
  // Institute sub-admins (role=admin + institute_id) get ONLY their dashboard;
  // platform admins (no institute_id) see the full panel.
  const nav = user?.institute_id
    ? ADMIN_NAV.filter((i) => i.to === '/admin/institute')
    : ADMIN_NAV.filter((i) => i.to !== '/admin/institute')
  return <AppShell nav={nav} title={title}>{children}</AppShell>
}
