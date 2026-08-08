import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast, diffBadge } from '../../components/ui.jsx'

export default function Bookmarks() {
  const nav = useNavigate()
  const toast = useToast()
  const [questions, setQuestions] = useState([])

  useEffect(() => { api.get('/questions/bookmarks/list').then((d) => setQuestions(d.questions)).catch(() => {}) }, [])

  const unbookmark = async (id) => {
    try {
      await api.post(`/questions/${id}/toggle-bookmark`)
      setQuestions((q) => q.filter((x) => x.id !== id))
      toast('Removed from bookmarks')
    } catch (e) { toast(e.message, 'err') }
  }

  const practiceSet = async () => {
    if (!questions.length) return
    nav(`/tests/0/session?ids=${questions.map((q) => q.id).join(',')}`)
  }

  return (
    <StudentLayout title="Bookmarked Questions">
      <div className="spread mb">
        <p className="small muted">{questions.length} saved questions</p>
        {questions.length > 0 && <button className="btn btn-primary" onClick={practiceSet}>Practice all bookmarks</button>}
      </div>
      {questions.length === 0 && <div className="empty">No bookmarks yet. Bookmark tricky questions during tests for revision.</div>}
      <div className="col">
        {questions.map((q) => (
          <div key={q.id} className="card">
            <div className="spread mb">
              <div className="row">
                <Badge kind={diffBadge(q.difficulty)}>{q.difficulty}</Badge>
                <Badge kind="gray">{q.source === 'pdf' ? 'PYQ' : 'AI'}</Badge>
                {q.year && <Badge kind="blue">{q.year}</Badge>}
              </div>
              <button className="btn btn-ghost btn-sm" onClick={() => unbookmark(q.id)}>Remove</button>
            </div>
            <div className="qtext small">{q.question_text}</div>
            <div className="row mt">
              <span className="chip">Answer: {q.correct_answer}</span>
            </div>
          </div>
        ))}
      </div>
    </StudentLayout>
  )
}
