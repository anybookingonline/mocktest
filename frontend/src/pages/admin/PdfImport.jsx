import React, { useEffect, useRef, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast, timeAgo } from '../../components/ui.jsx'

export default function AdminImport() {
  const toast = useToast()
  const fileRef = useRef(null)
  const [exams, setExams] = useState([])
  const [examId, setExamId] = useState('')
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(null) // { done, total } while a batch is uploading
  const [batchMode, setBatchMode] = useState(false) // Gemini Batch Mode: ~50% cheaper, up to 24h turnaround
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

  // Uploads run one request at a time (not Promise.all) — each POST carries
  // up to 30MB, and firing several at once from the browser was part of what
  // overloaded the small Coolify host during bulk imports. The server itself
  // also caps background extraction at 2 concurrent PDFs regardless, so
  // batching client-side just avoids piling up big in-flight request bodies.
  const uploadNow = async () => {
    setBusy(true)
    let ok = 0, reused = 0, failed = 0
    for (const [i, f] of files.entries()) {
      setProgress({ done: i, total: files.length })
      try {
        const d = await api.upload('/import/pdf', f, { examId }, { silentAuth: true })
        if (!d) { toast('Session expire ho gaya — login karke dobara try karo', 'err'); break }
        if (d.reused) reused++; else ok++
      } catch (e) {
        failed++
        toast(`${f.name}: ${e.message}`, 'err')
      }
      refresh()
    }
    setProgress(null)
    toast(`${ok} queued${reused ? `, ${reused} reused` : ''}${failed ? `, ${failed} failed` : ''}`, failed ? 'err' : 'ok')
  }

  // Gemini Batch Mode: all files go in ONE request — the server uploads each
  // to Gemini, submits one batch job, and a background poller (every ~15 min)
  // finishes them once Google's done (up to 24h, usually quicker). No count
  // limit here beyond the server's array-upload cap (50 per request) — for
  // more than that, just submit another batch.
  const uploadBatch = async () => {
    setBusy(true)
    try {
      const d = await api.uploadMany('/import/pdf-batch', files, { examId }, { silentAuth: true })
      if (!d) { toast('Session expire ho gaya — login karke dobara try karo', 'err'); return }
      toast(d.message || `${d.accepted || 0} file(s) submitted as a batch job`, 'ok')
    } catch (e) {
      toast(e.message, 'err')
    }
    refresh()
  }

  // Tooltip text (title attribute) can't be selected/copied on most browsers
  // — click-to-copy is the only reliable way to get a failed import's full
  // error text out to paste elsewhere (e.g. to ask for help fixing it).
  const copyError = async (error) => {
    const text = error || 'failed'
    try {
      await navigator.clipboard.writeText(text)
      toast('Error copied to clipboard', 'ok')
    } catch {
      window.prompt('Copy karne ke liye Ctrl/Cmd+C dabao:', text)
    }
  }

  const upload = async () => {
    if (!files.length) { toast('Choose one or more PDF files', 'err'); return }
    if (!examId) { toast('Select the exam this paper belongs to', 'err'); return }
    if (!provider?.geminiConfigured) { toast('Gemini Vision is required for PDF extraction. Configure the Gemini API key in AI Config.', 'err'); return }
    if (batchMode) await uploadBatch()
    else await uploadNow()
    setFiles([]); if (fileRef.current) fileRef.current.value = ''
    setBusy(false)
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

          <label className="field"><span>Paper file(s) (max 30 MB each)</span>
            <input ref={fileRef} type="file" accept="application/pdf" multiple className="input" onChange={(e) => setFiles(Array.from(e.target.files || []))} />
          </label>

          {files.length > 0 && (
            <p className="tiny mb">
              📎 {files.length} file{files.length > 1 ? 's' : ''} selected · {(files.reduce((a, f) => a + f.size, 0) / 1024 / 1024).toFixed(2)} MB total
            </p>
          )}

          <label className="row small mb" style={{ alignItems: 'center', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={batchMode} onChange={(e) => setBatchMode(e.target.checked)} />
            📦 Batch Mode — ~50% cheaper, up to 24h (checked automatically, no need to wait here)
          </label>

          <button className="btn btn-accent" onClick={upload} disabled={busy}>
            {busy
              ? (progress ? `Uploading ${progress.done + 1}/${progress.total}…` : batchMode ? 'Submitting batch…' : 'Uploading…')
              : batchMode
                ? `📦 Submit${files.length > 1 ? ` ${files.length} files` : ''} as batch job`
                : `🚀 Extract & import${files.length > 1 ? ` (${files.length} files)` : ''} with Gemini Vision`}
          </button>
          {!batchMode && files.length > 1 && <p className="tiny muted mt">Uploaded one at a time; the server processes up to 2 at once in the background — the rest queue automatically.</p>}
          {batchMode && <p className="tiny muted mt">No limit on file count here — for very large batches, just submit more than once. Import History updates on its own; hit Refresh to check.</p>}

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
          {/* Fixed-height + scroll so a long upload history can't push the page
              itself taller — the table scrolls in place instead. Failed-import
              reasons show as a tooltip on the badge rather than a second,
              ever-growing list below the table. */}
          <div style={{ maxHeight: 480, overflowY: 'auto' }}>
            <table className="tbl">
              <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
                <tr><th>File</th><th>Status</th><th>Q</th><th>When</th></tr>
              </thead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id}>
                    <td className="small" style={{ maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.filename}</td>
                    <td>
                      {i.status === 'completed' && <Badge kind="green">✓ {i.questions_created} added</Badge>}
                      {i.status === 'processing' && <Badge kind="amber"><span className="spin" style={{ width: 10, height: 10 }} /> processing</Badge>}
                      {i.status === 'queued' && <Badge kind="gray">queued</Badge>}
                      {i.status === 'batched' && (
                        <span title={`Gemini batch job: ${i.batch_state || 'pending'}${i.batch_checked_at ? ` (last checked ${timeAgo(i.batch_checked_at)})` : ''}`}>
                          <Badge kind="gray">📦 batched — {(i.batch_state || 'PENDING').replace('BATCH_STATE_', '').toLowerCase()}</Badge>
                        </span>
                      )}
                      {i.status === 'failed' && (
                        <span title={`${i.error || 'failed'} — click to copy`} style={{ cursor: 'pointer' }} onClick={() => copyError(i.error)}>
                          <Badge kind="red">failed 📋</Badge>
                        </span>
                      )}
                    </td>
                    <td className="tiny">{i.total_pages || 0} pg</td>
                    <td className="tiny">{timeAgo(i.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {imports.length === 0 && <div className="empty">No imports yet.</div>}
          </div>
        </div>
      </div>
    </AdminLayout>
  )
}
