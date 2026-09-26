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
  const [quota, setQuota] = useState(null) // { capped, limit, used, remaining } | { unlimited }
  const [hintMode, setHintMode] = useState(false) // Socratic tutor: hints instead of a direct answer
  const [photoBusy, setPhotoBusy] = useState(false)
  const mediaRef = useRef(null)
  const chunksRef = useRef([])
  const photoRef = useRef(null)

  const loadQuota = () => api.get('/ai/doubt-quota').then(setQuota).catch(() => {})

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
    loadQuota()
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
      const d = await api.post('/ai/doubt', { questionText: '', message: text, mode: hintMode ? 'socratic' : 'direct' })
      setAd(d.ad || null)
      toast(hintMode ? 'Hint from AI tutor' : 'Answered by AI tutor', 'ok')
      setMsg('')
      load()
      loadQuota()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  // ---- photo solver (camera/gallery -> /ai/doubt-photo) --------------------
  const askPhoto = async (file) => {
    if (!file) return
    setPhotoBusy(true)
    try {
      const d = await api.upload('/ai/doubt-photo', file, { mode: hintMode ? 'socratic' : 'direct', message: msg }, { silentAuth: true })
      if (!d) { toast('Session expire ho gaya — login karke dobara try karo', 'err'); return }
      setAd(d.ad || null)
      toast(hintMode ? 'Hint from AI tutor' : 'Solved by AI tutor', 'ok')
      setMsg('')
      load()
      loadQuota()
    } catch (e) { toast(e.message, 'err') } finally {
      setPhotoBusy(false)
      if (photoRef.current) photoRef.current.value = ''
    }
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

      {/* Live tier-aware doubt counter — free: "5/0" → exhausted + CTA;
          paid: "50/12 (fair-use)" amber note, no upsell spam */}
      {quota && (
        <div className="card mb" style={{ padding: '12px 16px' }}>
          <div className="spread">
            <div className="row" style={{ gap: 10 }}>
              <span className="small"><b>AI doubts aaj:</b> {quota.limit}/{quota.used}</span>
              {quota.tier === 'paid'
                ? <span className="tiny muted">(fair-use {quota.limit}/day)</span>
                : <span className="tiny muted">(free limit {quota.limit}/day)</span>}
            </div>
            {quota.remaining === 0 && quota.tier === 'free' && (
              <div className="row" style={{ gap: 8 }}>
                <span className="tiny" style={{ color: 'var(--red)' }}>Aaj ka limit khatam — kal phir milti hai</span>
                <Link to="/retention" className="btn btn-primary btn-sm">⚡ AI Power lo — 50/day</Link>
              </div>
            )}
            {quota.remaining === 0 && quota.tier === 'paid' && (
              <span className="tiny" style={{ color: 'var(--amber)' }}>Fair-use limit reached — kal phir milti hai</span>
            )}
          </div>
          <div className="progress" style={{ marginTop: 8 }}>
            <div style={{ width: `${Math.round((quota.used / quota.limit) * 100)}%`, background: quota.remaining === 0 ? (quota.tier === 'paid' ? 'var(--amber)' : 'var(--red)') : undefined }} />
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
          <input ref={photoRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
            onChange={(e) => askPhoto(e.target.files?.[0])} />
          <button
            className="btn btn-ghost"
            style={{ fontSize: 20, width: 52 }}
            onClick={() => photoRef.current?.click()}
            disabled={busy || photoBusy}
            title="Photo se doubt solve karo — question ki photo kheecho ya gallery se chuno"
          >
            {photoBusy ? '…' : '📷'}
          </button>
          <button className="btn btn-accent" onClick={() => ask()} disabled={busy || transcribing || !msg.trim()}>
            {busy || transcribing ? 'Thinking…' : 'Ask AI Tutor'}
          </button>
        </div>
        <label className="row small mt" style={{ alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={hintMode} onChange={(e) => setHintMode(e.target.checked)} />
          🧠 Hint mode — guide me step by step instead of giving the answer directly
        </label>
        {recording && <p className="tiny mt" style={{ color: 'var(--red)' }}>🔴 Recording… apna doubt bolo, phir ⏹ dabao</p>}
        {transcribing && <p className="tiny mt">✍️ Aapki baat text me convert ho rahi hai…</p>}
        {photoBusy && <p className="tiny mt">📷 Photo padhi jaa rahi hai aur solve ho rahi hai…</p>}
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
          <DoubtCard key={h.id} doubt={h} onMock={() => makeDoubtMock(h.id)} mockBusy={mockBusy === h.id} onReplied={load} />
        ))}
      </div>
    </StudentLayout>
  )
}

// One doubt "card" — the original Q&A, its Socratic hint replies (if any)
// nested below in order, and (for a socratic thread) a small box to continue
// the conversation ("still stuck? ask for another hint").
function DoubtCard({ doubt: h, onMock, mockBusy, onReplied }) {
  const toast = useToast()
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)

  const sendReply = async () => {
    const text = reply.trim()
    if (!text) return
    setBusy(true)
    try {
      await api.post('/ai/doubt', { message: text, parentDoubtId: h.id })
      setReply('')
      onReplied()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <div className="card">
      <div className="spread mb">
        <b className="small">{h.question_text || h.message?.slice(0, 90)}</b>
        <span className="row" style={{ gap: 6 }}>
          {h.mode === 'socratic' && <Badge kind="purple">🧠 hint mode</Badge>}
          <span className="tiny">{h.created_at}</span>
        </span>
      </div>
      <div className="ai-bubble">{h.ai_response}</div>
      {(h.replies || []).map((r) => (
        <div key={r.id} style={{ marginTop: 10, paddingLeft: 14, borderLeft: '2px solid var(--border)' }}>
          <p className="tiny muted" style={{ margin: '0 0 4px' }}>You: {r.message}</p>
          <div className="ai-bubble">{r.ai_response}</div>
        </div>
      ))}
      {h.mode === 'socratic' && (
        <div className="row mt" style={{ gap: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="Still stuck? Say what you tried, or ask for the answer…"
            value={reply} onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') sendReply() }} />
          <button className="btn btn-ghost btn-sm" onClick={sendReply} disabled={busy || !reply.trim()}>
            {busy ? '…' : 'Reply'}
          </button>
        </div>
      )}
      <div className="row mt">
        <button className="btn btn-ghost btn-sm" onClick={onMock} disabled={mockBusy}>
          {mockBusy ? 'Generating…' : '🎯 Practice 3 similar questions'}
        </button>
      </div>
    </div>
  )
}
