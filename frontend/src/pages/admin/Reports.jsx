import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Progress, Skeleton, statColor } from '../../components/ui.jsx'

export default function AdminReports() {
  const [report, setReport] = useState(null)
  const [stats, setStats] = useState(null)

  useEffect(() => {
    api.get('/admin/reports').then(setReport).catch(() => {})
    api.get('/admin/stats').then(setStats).catch(() => {})
  }, [])

  const maxQ = report ? Math.max(1, ...report.byExam.map((e) => e.questions)) : 1

  return (
    <AdminLayout title="Analytics & Reports">
      <div className="grid grid-3 mb">
        {stats ? [
          <div className="card stat" key="1"><span className="label">Total questions</span><span className="value">{stats.questions}</span><span className="sub">{stats.questionsAI} AI · {stats.questionsPDF} PDF</span></div>,
          <div className="card stat" key="2"><span className="label">Total attempts</span><span className="value">{stats.attempts}</span><span className="sub">{stats.attemptsToday} today</span></div>,
          <div className="card stat" key="3"><span className="label">Registered students</span><span className="value">{stats.users}</span><span className="sub">{stats.newUsersToday} joined today</span></div>
        ] : [1, 2, 3].map((i) => <Skeleton key={i} h={90} />)}
      </div>

      <div className="card mb">
        <b className="small mb" style={{ display: 'block' }}>Questions & attempts by exam</b>
        {!report ? <Skeleton h={180} /> : report.byExam.map((e) => (
          <div key={e.id} className="mb">
            <div className="spread small mb">
              <b>{e.name}</b>
              <span className="tiny">{e.questions} Q (AI: {e.ai}, PYQ: {e.pdf}) · {e.attempts} attempts</span>
            </div>
            <Progress value={(e.questions / maxQ) * 100} />
          </div>
        ))}
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Question bank by source</b>
          {report?.bySource?.map((s) => (
            <div key={s.source} className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{s.source === 'pdf' ? '📄 Previous year (PDF)' : s.source === 'ai' ? '🤖 AI generated' : 'Manual'}</span>
              <Badge kind={s.source === 'pdf' ? 'green' : s.source === 'ai' ? 'purple' : 'gray'}>{s.c}</Badge>
            </div>
          ))}
          {report?.bySource?.length === 0 && <div className="empty">No questions yet.</div>}
        </div>
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Question bank by difficulty</b>
          {report?.byDifficulty?.map((d) => (
            <div key={d.difficulty} className="spread" style={{ padding: '7px 0', borderBottom: '1px solid var(--border)' }}>
              <span>{d.difficulty}</span>
              <Badge kind={statColor(d.difficulty === 'hard' ? 0 : d.difficulty === 'easy' ? 100 : 50)}>{d.c}</Badge>
            </div>
          ))}
        </div>
      </div>

      <div className="card mt">
        <b className="small mb" style={{ display: 'block' }}>Daily activity (last 30 days)</b>
        {report?.perDay?.length === 0 && <div className="empty">No activity yet.</div>}
        <div className="row" style={{ alignItems: 'flex-end', gap: 8, minHeight: 120, overflowX: 'auto' }}>
          {report?.perDay?.map((d) => (
            <div key={d.day} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, minWidth: 34 }}>
              <span className="tiny">{d.attempts}</span>
              <div style={{ width: 26, height: `${Math.min(100, Math.max(4, d.attempts * 8))}px`, background: 'linear-gradient(180deg, var(--accent2), var(--accent))', borderRadius: 5 }} />
              <span className="tiny" style={{ transform: 'rotate(-45deg)' }}>{d.day.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>
    </AdminLayout>
  )
}
