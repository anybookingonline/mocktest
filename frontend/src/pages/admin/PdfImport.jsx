import React, { useEffect, useRef, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast, timeAgo } from '../../components/ui.jsx'

export default function AdminImport() {
  const toast = useToast()
  const fileRef = useRef(null)
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)
  const [imports, setImports] = useState([])
  const [provider, setProvider] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => { api.get('/exams').then((d) => setExams(d.exams)) }, [])
  useEffect(() => {
    api.get('/import/list').then((d) => setImports(d.imports)).catch(() => {})
    api.get('/ai/provider-status').then(setProvider).catch(() => {})
  }, [])

  const refresh = () => api.get('/import/list').then((d) => setImports(d.imports)).catch(() => {})
  useEffect(() => {
    pollRef.current = setInterval(() => {
      if (imports.some((i) => i.status === 'processing' || i.status === 'queued')) refresh()
    }, 6000)
    return () => clearInterval(pollRef.current)
  }, [imports])

  const upload = async () => {
    if (!file) { toast('Choose a PDF file', 'err'); return }
    if (!examId) { toast('Select the exam this paper belongs to', 'err'); return }
    if (!provider?.geminiConfigured) { toast('Gemini Vision is required for PDF extraction. Configure the Gemini API key in AI Config.', 'err'); return }
    setBusy(true)
    try {
      const d = await api.upload('/import/pdf', file, { examId })
      if (d.reused) toast(d.message, 'ok')
      else toast(d.message, 'ok')
      setFile(null); if (fileRef.current) fileRef.current.value = ''
      refresh()
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  return (
    <AdminLayout title="PDF Import — Previous Year Papers">
      <div className="grid" style={{ gridTemplateColumns: '1.2fr 1fr' }}>
        <div className="card">
          <b className="mb" style={{ display: 'block' }}>Upload an exam paper (PDF)</b>
          <p className="small muted mb">Gemini Vision reads scanned, image-based, multi-column or low-quality PDFs — including diagrams, graphs, tables and equations. DeepSeek then structures the content into your standard question database.</p>

          <label className="field"><span>Target exam</span>
            <select className="select" value={examId} onChange={(e) => setExamId(e.target.value)}>
              <option value="">Select exam…</option>
              {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>

          <label className="field"><span>Paper file (max 30 MB)</span>
            <input ref={fileRef} type="file" accept="application/pdf" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} />
          </label>

          {file && <p className="tiny mb">📎 {file.name} · {(file.size / 1024 / 1024).toFixed(2)} MB</p>}

          <button className="btn btn-accent" onClick={upload} disabled={busy}>
            {busy ? 'Uploading…' : '🚀 Extract & import with Gemini Vision'}
          </button>

          <hr className="divider" />
          <div className="row">
            <Badge kind={provider?.geminiConfigured ? 'green' : 'red'}>Gemini Vision: {provider?.geminiConfigured ? 'configured' : 'not configured'}</Badge>
            <Badge kind={provider?.deepseekConfigured ? 'green' : 'gray'}>DeepSeek structuring: {provider?.deepseekConfigured ? 'ready' : 'will fallback to Gemini'}</Badge>
          </div>
          <p className="tiny mt">Duplicate detection is automatic: the same paper is hashed and never processed twice — imported questions are reused instantly.</p>
        </div>

        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="spread" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
            <b>Import history</b>
            <button className="btn btn-sm btn-ghost" onClick={refresh}>Refresh</button>
          </div>
          <table className="tbl">
            <thead><tr><th>File</th><th>Status</th><th>Q</th><th>When</th></tr></thead>
            <tbody>
              {imports.map((i) => (
                <tr key={i.id}>
                  <td className="small" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.filename}</td>
                  <td>
                    {i.status === 'completed' && <Badge kind="green">✓ {i.questions_created} added</Badge>}
                    {i.status === 'processing' && <Badge kind="amber"><span className="spin" style={{ width: 10, height: 10 }} /> processing</Badge>}
                    {i.status === 'queued' && <Badge kind="gray">queued</Badge>}
                    {i.status === 'failed' && <Badge kind="red">failed</Badge>}
                  </td>
                  <td className="tiny">{i.total_pages || 0} pg</td>
                  <td className="tiny">{timeAgo(i.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {imports.length === 0 && <div className="empty">No imports yet.</div>}
          {imports.some((i) => i.status === 'failed') && (
            <div className="row" style={{ padding: 12 }}>
              {imports.filter((i) => i.status === 'failed').map((i) => <span key={i.id} className="tiny" style={{ color: 'var(--red)' }}>{i.error}</span>)}
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  )
}
