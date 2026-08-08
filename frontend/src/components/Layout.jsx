import React, { useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext.jsx'

const STUDENT_NAV = [
  { to: '/', label: 'Dashboard', icon: '📊', group: 'Learn' },
  { to: '/practice', label: 'Practice', icon: '✏️' },
  { to: '/tests', label: 'Mock Tests', icon: '⏱️' },
  { to: '/adaptive', label: 'Adaptive Practice', icon: '🧠' },
  { to: '/doubts', label: 'Doubt Solving', icon: '💬' },
  { to: '/bookmarks', label: 'Bookmarked', icon: '🔖' },
  { to: '/history', label: 'Test History', icon: '🗂️' },
  { to: '/retention', label: 'Data Retention', icon: '🔒', group: 'Track' },
  { to: '/rankings', label: 'Rankings', icon: '🏆', group: 'Track' },
  { to: '/analytics', label: 'Analytics & Report', icon: '📈' }
]

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
  { to: '/admin/settings', label: 'Settings', icon: '⚙️' }
]

export function Brand({ onClick }) {
  return (
    <div className="brand" onClick={onClick} style={{ cursor: 'pointer' }}>
      <svg viewBox="0 0 512 512" width="34" height="34">
        <defs>
          <linearGradient id="g2" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        <rect width="512" height="512" rx="112" fill="#121a30" />
        <circle cx="256" cy="256" r="150" fill="url(#g2)" opacity="0.92" />
        <path d="M256 150l92 54v108l-92 54-92-54V204z" fill="none" stroke="#0b0f1a" strokeWidth="16" strokeLinejoin="round" />
        <path d="M196 266l44 44 80-92" fill="none" stroke="#0b0f1a" strokeWidth="18" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>Exam<b>AI</b></span>
    </div>
  )
}

function SideNav({ nav, active, onNavigate }) {
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
            <span className="ic">{item.icon}</span>{item.label}
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
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
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
          <div className="user-chip">
            <span className="small muted">{user?.name}</span>
            <div className="avatar">{initial}</div>
            <button className="btn btn-ghost btn-sm" onClick={() => { logout(); navigate('/login') }}>Logout</button>
          </div>
        </div>
        <div className="content">{children}</div>
      </div>
    </div>
  )
}

export function StudentLayout({ title, children }) {
  return <AppShell nav={STUDENT_NAV} title={title}>{children}</AppShell>
}

export function AdminLayout({ title, children }) {
  return <AppShell nav={ADMIN_NAV} title={title}>{children}</AppShell>
}
