import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast } from '../../components/ui.jsx'

export default function AdminAI() {
  const toast = useToast()
  const [cfg, setCfg] = useState(null)
  const [status, setStatus] = useState(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cache, setCache] = useState(null)

  useEffect(() => {
    api.get('/admin/settings').then((d) => setCfg(d.settings)).catch(() => {})
    api.get('/ai/provider-status').then(setStatus).catch(() => {})
    api.get('/admin/ai-cache').then(setCache).catch(() => {})
  }, [])

  const clearCache = async () => {
    try {
      await api.post('/admin/ai-cache/clear')
      setCache(await api.get('/admin/ai-cache'))
      toast('AI cache cleared', 'ok')
    } catch (e) { toast(e.message, 'err') }
  }

  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }))

  const save = async () => {
    setSaving(true)
    try {
      await api.put('/admin/settings', cfg)
      toast('AI configuration saved', 'ok')
      setStatus(await api.get('/ai/provider-status'))
    } catch (e) { toast(e.message, 'err') } finally { setSaving(false) }
  }

  const test = async () => {
    setTesting(true)
    try {
      const d = await api.post('/ai/doubt', { questionText: 'What is 2+2?', message: 'Explain in one line' })
      toast('AI connection works: ' + d.response.slice(0, 80) + '…', 'ok')
    } catch (e) { toast('Connection test failed: ' + e.message, 'err') } finally { setTesting(false) }
  }

  if (!cfg) return <AdminLayout title="AI Configuration"><div className="spin" /></AdminLayout>

  const configured = (k) => Boolean(cfg[k])

  return (
    <AdminLayout title="AI Configuration">
      <div className="card mb">
        <div className="spread">
          <div>
            <b>AI engine routing</b>
            <p className="tiny muted">DeepSeek is the primary engine for unlimited question generation, adaptive tests, explanations & doubt solving. Gemini is the fallback and the vision engine for PDF imports. OpenRouter adds free LLM model access.</p>
          </div>
          <div className="row">
            <Badge kind="purple">DeepSeek (primary)</Badge>
            <Badge kind="blue">Gemini (fallback + vision)</Badge>
            <Badge kind="amber">OpenRouter (free models)</Badge>
          </div>
        </div>
        <hr className="divider" />
        <div className="field-row">
          <label className="field"><span>Primary provider</span>
            <select className="select" value={cfg['ai.provider']} onChange={(e) => set('ai.provider', e.target.value)}>
              <option value="deepseek">DeepSeek</option>
              <option value="gemini">Gemini</option>
              <option value="openrouter">OpenRouter</option>
            </select>
          </label>
          <label className="field"><span>Automatic fallback</span>
            <select className="select" value={cfg['ai.fallbackEnabled'] === 'false' ? 'false' : 'true'} onChange={(e) => set('ai.fallbackEnabled', e.target.value)}>
              <option value="true">Enabled (primary → Gemini → OpenRouter)</option>
              <option value="false">Disabled</option>
            </select>
          </label>
          <label className="field"><span>AI response cache</span>
            <select className="select" value={cfg['ai.cacheEnabled'] === 'false' ? 'false' : 'true'} onChange={(e) => set('ai.cacheEnabled', e.target.value)}>
              <option value="true">Enabled — reuse answers, save API cost</option>
              <option value="false">Disabled — always call the API</option>
            </select>
          </label>
          <label className="field"><span>Cache TTL (days)</span>
            <input type="number" className="input" value={cfg['ai.cacheTtlDays'] || 30} onChange={(e) => set('ai.cacheTtlDays', e.target.value)} />
          </label>
        </div>
      </div>

      <div className="grid grid-3">
        <div className="card">
          <div className="spread mb"><b>DeepSeek <Badge kind="purple">primary</Badge></b>{configured('deepseek.apiKey') ? <Badge kind="green">configured</Badge> : <Badge kind="red">missing key</Badge>}</div>
          <label className="field"><span>API key</span>
            <input className="input" type="password" placeholder="sk-…" value={cfg['deepseek.apiKey']} onChange={(e) => set('deepseek.apiKey', e.target.value)} />
          </label>
          <label className="field"><span>Model</span>
            <input className="input" value={cfg['deepseek.model'] || 'deepseek-chat'} onChange={(e) => set('deepseek.model', e.target.value)} />
          </label>
          <p className="tiny muted">Get a key at platform.deepseek.com</p>
        </div>

        <div className="card">
          <div className="spread mb"><b>Gemini <Badge kind="blue">fallback + vision</Badge></b>{configured('gemini.apiKey') ? <Badge kind="green">configured</Badge> : <Badge kind="red">missing key</Badge>}</div>
          <label className="field"><span>API key</span>
            <input className="input" type="password" placeholder="AIza…" value={cfg['gemini.apiKey']} onChange={(e) => set('gemini.apiKey', e.target.value)} />
          </label>
          <label className="field"><span>Text model</span>
            <input className="input" value={cfg['gemini.model'] || 'gemini-2.0-flash'} onChange={(e) => set('gemini.model', e.target.value)} />
          </label>
          <label className="field"><span>Vision model (PDF extraction)</span>
            <input className="input" value={cfg['gemini.visionModel'] || 'gemini-2.0-flash'} onChange={(e) => set('gemini.visionModel', e.target.value)} />
          </label>
          <p className="tiny muted">Required for PDF import. Get a key at aistudio.google.com</p>
        </div>

        <div className="card">
          <div className="spread mb"><b>OpenRouter <Badge kind="amber">free models</Badge></b>{configured('openrouter.apiKey') ? <Badge kind="green">configured</Badge> : <Badge kind="red">missing key</Badge>}</div>
          <label className="field"><span>API key</span>
            <input className="input" type="password" placeholder="sk-or-…" value={cfg['openrouter.apiKey']} onChange={(e) => set('openrouter.apiKey', e.target.value)} />
          </label>
          <label className="field"><span>Model (many free options)</span>
            <input className="input" value={cfg['openrouter.model'] || 'deepseek/deepseek-chat-v3-0324:free'} onChange={(e) => set('openrouter.model', e.target.value)} />
          </label>
          <p className="tiny muted">Free models like <i>deepseek/deepseek-chat-v3-0324:free</i>, <i>meta-llama/llama-3.3-70b-instruct:free</i>, <i>google/gemini-2.0-flash-exp:free</i> at openrouter.ai</p>
        </div>
      </div>

      <div className="card mb">
        <div className="spread">
          <div>
            <b>Response cache</b>
            <p className="tiny muted">Identical requests (same question/doubt/PDF) are served from the cache instead of calling the paid AI API again — saving cost and latency. Cache TTL controls how long answers are reused.</p>
          </div>
          {cache && (
            <div className="row">
              <span className="chip">{cache.total} cached responses</span>
              <span className="chip">{cache.hits} hits served</span>
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={clearCache}>Clear cache</button>
        </div>
      </div>

      <div className="row mt">
        <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save configuration'}</button>
        <button className="btn btn-ghost" onClick={test} disabled={testing}>{testing ? 'Testing…' : '🔌 Test connection'}</button>
      </div>
    </AdminLayout>
  )
}
