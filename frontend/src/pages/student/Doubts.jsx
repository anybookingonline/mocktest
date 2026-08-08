import React, { useEffect, useState } from 'react'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { useToast } from '../../components/ui.jsx'

export default function Doubts() {
  const toast = useToast()
  const [history, setHistory] = useState([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => api.get('/ai/doubts').then((d) => setHistory(d.doubts)).catch(() => {})
  useEffect(() => { load() }, [])

  const ask = async () => {
    if (!msg.trim()) return
    setBusy(true)
    try {
      const d = await api.post('/ai/doubt', { questionText: '', message: msg })
      toast('Answered by AI tutor', 'ok')
      setMsg('')
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <StudentLayout title="Doubt Solving">
      <div className="card mb">
        <b className="small mb" style={{ display: 'block' }}>Ask any doubt — the AI tutor answers instantly</b>
        <div className="row">
          <textarea className="input" rows="2" placeholder="e.g. Why is the sign negative in the integration here? Explain Faraday's law simply…"
            value={msg} onChange={(e) => setMsg(e.target.value)} />
          <button className="btn btn-accent" onClick={ask} disabled={busy || !msg.trim()}>{busy ? 'Thinking…' : 'Ask AI Tutor'}</button>
        </div>
      </div>

      <b className="small mb" style={{ display: 'block' }}>Your doubt history</b>
      {history.length === 0 && <div className="empty">No doubts asked yet — clear that first conceptual block!</div>}
      <div className="col">
        {history.map((h) => (
          <div key={h.id} className="card">
            <div className="spread mb"><b className="small">{h.question_text || h.message?.slice(0, 90)}</b><span className="tiny">{h.created_at}</span></div>
            <div className="ai-bubble">{h.ai_response}</div>
          </div>
        ))}
      </div>
    </StudentLayout>
  )
}
