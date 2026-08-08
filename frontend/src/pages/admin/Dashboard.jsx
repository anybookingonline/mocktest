import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Skeleton } from '../../components/ui.jsx'

export default function AdminDashboard() {
  const nav = useNavigate()
  const [stats, setStats] = useState(null)

  useEffect(() => { api.get('/admin/stats').then(setStats).catch(() => {}) }, [])

  const cards = stats ? [
    { label: 'Total students', value: stats.users, sub: `+${stats.newUsersToday} today`, icon: '👥' },
    { label: 'Questions in bank', value: stats.questions, sub: `${stats.questionsAI} AI · ${stats.questionsPDF} from PDFs`, icon: '❓' },
    { label: 'Mock tests', value: stats.tests, sub: `${stats.attempts} attempts`, icon: '⏱️' },
    { label: 'PDF imports', value: stats.imports, sub: `${stats.importsCompleted} completed`, icon: '📄' }
  ] : null

  return (
    <AdminLayout title="Admin Dashboard">
      <div className="grid grid-4 mb">
        {cards ? cards.map((c) => (
          <div key={c.label} className="card stat">
            <span className="label">{c.icon} {c.label}</span>
            <span className="value">{c.value}</span>
            <span className="sub">{c.sub}</span>
          </div>
        )) : [1, 2, 3, 4].map((i) => <Skeleton key={i} h={90} />)}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Question bank health</b>
          {!stats ? <Skeleton h={160} /> : (
            <div className="col">
              <div className="spread"><span className="small muted">Total questions</span><b>{stats.questions}</b></div>
              <div className="spread"><span className="small muted">AI-generated</span><b style={{ color: 'var(--accent2)' }}>{stats.questionsAI}</b></div>
              <div className="spread"><span className="small muted">Previous-year (PDF import)</span><b style={{ color: 'var(--green)' }}>{stats.questionsPDF}</b></div>
              <div className="spread"><span className="small muted">Tests created</span><b>{stats.tests}</b></div>
              <div className="spread"><span className="small muted">Attempts today</span><b>{stats.attemptsToday}</b></div>
            </div>
          )}
        </div>
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Quick actions</b>
          <div className="col">
            <button className="btn btn-primary" onClick={() => nav('/admin/import')}>📄 Import previous year PDF</button>
            <button className="btn btn-accent" onClick={() => nav('/admin/ai')}>🤖 Configure AI (DeepSeek / Gemini / OpenRouter)</button>
            <button className="btn" onClick={() => nav('/admin/questions')}>❓ Manage question bank</button>
            <button className="btn" onClick={() => nav('/admin/exams')}>🎯 Manage exams</button>
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
