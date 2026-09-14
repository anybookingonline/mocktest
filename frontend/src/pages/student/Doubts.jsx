import React, { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast } from '../../components/ui.jsx'

export default function Doubts() {
  const toast = useToast()
  const nav = useNavigate()
  const [history, setHistory] = useState([])
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [mockBusy, setMockBusy] = useState(null)
  const [flags, setFlags] = useState({ voiceDoubts: false, telegramBot: false, voiceUnlocked: false, telegramUnlimited: false })
  const [link, setLink] = useState(null) // { code, botUsername }
  const [recording, setRecording] = useState(false)
  const [transcribing, setTranscribing] = useState(false)
  const [ad, setAd] = useState(null) // contextual ad from the latest tutor answer (free users)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])

  // #4 Doubt-to-Mock loop: AI generates 3 similar questions from this doubt
  const makeDoubtMock = async (doubtId) => {
    setMockBusy(doubtId)
    try {
      const d = await api.post('/revision/doubt-mock', { doubtId })
      toast(d.existing ? 'Practice test already ready — kholo!' : `3 similar questions ready!`, 'ok')
      nav(`/tests/${d.testId}/session`)
    } catch (e) {
      toast(e.message, 'err')
    } finally { setMockBusy(null) }
  }

  const load = () => api.get('/ai/doubts').then((d) => setHistory(d.doubts)).catch(() => {})
  useEffect(() => {
    load()
    api.get('/ai/features').then(setFlags).catch(() => {})
  }, [])

  // Load Telegram link code only when the bot is enabled
  useEffect(() => {
    if (!flags.telegramBot) return
    api.get('/ai/telegram/link').then((d) => setLink(d)).catch(() => {})
  }, [flags.telegramBot])

  const ask = async (overrideText) => {
    const text = (overrideText ?? msg).trim()
    if (!text) return
    setBusy(true)
    try {
      const d = await api.post('/ai/doubt', { questionText: '', message: text })
      setAd(d.ad || null)
      toast('Answered by AI tutor', 'ok')
      setMsg('')
      load()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  // ---- voice recording (MediaRecorder -> /ai/transcribe -> /ai/doubt) ------
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      chunksRef.current = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => e.data.size > 0 && chunksRef.current.push(e.data)
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        setRecording(false)
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
        if (blob.size < 2000) return toast('Recording too short — mic button dabakar dobara bolo', 'err')
        setTranscribing(true)
        try {
          const fd = new FormData()
          fd.append('file', blob, 'doubt.webm')
          const r = await fetch('/api/ai/transcribe', {
            method: 'POST',
            headers: { Authorization: `Bearer ${localStorage.getItem('examai_token')}` },
            body: fd
          })
          const d = await r.json()
          if (!r.ok) throw new Error(d.error || 'Transcription failed')
          setMsg(d.text || '')
          if (d.text) await ask(d.text)
        } catch (e) {
          toast(e.message, 'err')
        } finally { setTranscribing(false) }
      }
      mediaRef.current = rec
      rec.start()
      setRecording(true)
    } catch {
      toast('Microphone access nahi mila — browser permission check karo', 'err')
    }
  }

  const stopRecording = () => mediaRef.current?.stop()

  return (
    <StudentLayout title="Doubt Solving">
      {flags.telegramBot && (
        <div className="card mb">
          <div className="spread">
            <div>
              <b className="small" style={{ display: 'block' }}>💬 Telegram par bhi doubt pucho {flags.telegramUnlimited ? <Badge kind="amber">⚡ unlimited</Badge> : <Badge kind="gray">10/day free</Badge>}</b>
              <p className="tiny muted">{flags.telegramUnlimited
                ? 'AI Power Pack active — Telegram par unlimited doubts, koi daily cap nahi.'
                : 'Telegram app kholo, bot ko start karo aur apna link code bhejo — 10 doubts/day free. AI Power Pack se unlimited.'}</p>
            </div>
            {link && (
              <div style={{ textAlign: 'center' }}>
                <Badge kind="blue">Link code</Badge>
                <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: 2, margin: '4px 0' }}>{link.code}</div>
                <a className="btn btn-sm btn-ghost" href={`https://t.me/${link.botUsername || ''}`} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
                  Open bot {link.botUsername ? `@${link.botUsername}` : ''}
                </a>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="card mb">
        <b className="small mb" style={{ display: 'block' }}>Ask any doubt — the AI tutor answers instantly</b>
        <div className="row" style={{ alignItems: 'stretch' }}>
          <textarea className="input" rows="2" style={{ flex: 1 }} placeholder="e.g. Why is the sign negative in the integration here? Explain Faraday's law simply…"
            value={msg} onChange={(e) => setMsg(e.target.value)} />
          {flags.voiceUnlocked ? (
            <button
              className={`btn ${recording ? 'btn-danger' : 'btn-ghost'}`}
              style={{ fontSize: 20, width: 52 }}
              onClick={recording ? stopRecording : startRecording}
              disabled={busy || transcribing}
              title={recording ? 'Stop & send' : 'Speak your doubt'}
            >
              {transcribing ? '…' : recording ? '⏹' : '🎙️'}
            </button>
          ) : flags.voiceDoubts ? (
            <Link to="/retention" className="btn btn-ghost" style={{ fontSize: 20, width: 52 }} title="Voice Doubts add-on chahiye — tap to unlock">🔒</Link>
          ) : null}
          <button className="btn btn-accent" onClick={() => ask()} disabled={busy || transcribing || !msg.trim()}>
            {busy || transcribing ? 'Thinking…' : 'Ask AI Tutor'}
          </button>
        </div>
        {recording && <p className="tiny mt" style={{ color: 'var(--red)' }}>🔴 Recording… apna doubt bolo, phir ⏹ dabao</p>}
        {transcribing && <p className="tiny mt">✍️ Aapki baat text me convert ho rahi hai…</p>}
        {flags.voiceDoubts && !flags.voiceUnlocked && (
          <p className="tiny mt">🎙️ Voice doubts ek paid add-on hai — <Link to="/retention">Plans page se unlock karo</Link>.</p>
        )}
      </div>

      <b className="small mb" style={{ display: 'block' }}>Your doubt history</b>
      {history.length === 0 && <div className="empty">No doubts asked yet — clear that first conceptual block!</div>}
      {ad && ad.url && (
        <div className="card mb" style={{ borderColor: 'rgba(99,102,241,0.35)', padding: 12 }}>
          <div className="spread">
            <div className="row" style={{ gap: 10, minWidth: 0 }}>
              {ad.favicon ? <img src={ad.favicon} alt="" width={20} height={20} style={{ borderRadius: 4, flexShrink: 0 }} /> : null}
              <div style={{ minWidth: 0 }}>
                <b className="small">{ad.title || ad.brandName}</b>
                <p className="tiny muted" style={{ margin: '2px 0' }}>{ad.adText}</p>
                <span className="tiny muted">Sponsored</span>
              </div>
            </div>
            <a className="btn btn-ghost btn-sm" href={ad.url} target="_blank" rel="noreferrer sponsored" style={{ flexShrink: 0 }}
              onClick={() => { if (ad.impUrl) fetch(ad.impUrl).catch(() => {}) }}>
              {ad.cta || 'Learn more'}
            </a>
          </div>
        </div>
      )}
      <div className="col">
        {history.map((h) => (
          <div key={h.id} className="card">
            <div className="spread mb"><b className="small">{h.question_text || h.message?.slice(0, 90)}</b><span className="tiny">{h.created_at}</span></div>
            <div className="ai-bubble">{h.ai_response}</div>
            <div className="row mt">
              <button className="btn btn-ghost btn-sm" onClick={() => makeDoubtMock(h.id)} disabled={mockBusy === h.id}>
                {mockBusy === h.id ? 'Generating…' : '🎯 Practice 3 similar questions'}
              </button>
            </div>
          </div>
        ))}
      </div>
    </StudentLayout>
  )
}
