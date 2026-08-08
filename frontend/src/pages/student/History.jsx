import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Empty, fmtDuration, timeAgo, statColor } from '../../components/ui.jsx'

export default function History() {
  const nav = useNavigate()
  const [attempts, setAttempts] = useState([])
  const [exams, setExams] = useState([])

  useEffect(() => {
    api.get('/attempts/my').then((d) => setAttempts(d.attempts)).catch(() => {})
    api.get('/exams').then((d) => setExams(d.exams)).catch(() => {})
  }, [])

  const examMap = Object.fromEntries(exams.map((e) => [e.id, e]))

  return (
    <StudentLayout title="Test History">
      {attempts.length === 0 && <Empty title="No tests completed yet" text="Take your first mock test to see your history here." />}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>Test</th><th>Exam</th><th>Score</th><th>Accuracy</th><th>C/W/S</th><th>Time</th><th>When</th></tr></thead>
          <tbody>
            {attempts.map((a) => (
              <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/results/${a.id}`)}>
                <td><b className="small">{a.title}</b></td>
                <td className="tiny">{examMap[a.exam_id]?.name || '-'}</td>
                <td><Badge kind={a.score >= 0 ? 'green' : 'gray'}>{a.score}</Badge></td>
                <td><Badge kind={statColor(a.accuracy)}>{a.accuracy}%</Badge></td>
                <td className="tiny">{a.correct}/{a.wrong}/{a.skipped}</td>
                <td className="tiny">{fmtDuration(a.duration_seconds)}</td>
                <td className="tiny">{timeAgo(a.started_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </StudentLayout>
  )
}
