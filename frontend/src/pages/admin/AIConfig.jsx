import React, { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
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
  const [presets, setPresets] = useState({})
  const [flags, setFlags] = useState(null)
  const [tgSetup, setTgSetup] = useState(false)

  useEffect(() => {
    api.get('/admin/settings').then((d) => setCfg(d.settings)).catch(() => {})
    api.get('/ai/provider-status').then(setStatus).catch(() => {})
    api.get('/admin/ai-cache').then(setCache).catch(() => {})
    api.get('/ai/custom-presets').then((d) => setPresets(d.presets || {})).catch(() => {})
    api.get('/ai/features').then(setFlags).catch(() => {})
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

  const setupTelegramWebhook = async () => {
    setTgSetup(true)
    try {
      const d = await api.post('/telegram/admin/setup', {})
      toast('Telegram webhook wired: ' + d.webhookUrl, 'ok')
    } catch (e) { toast(e.message, 'err') } finally { setTgSetup(false) }
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
            <Badge kind="green">Custom (any API)</Badge>
          </div>
        </div>
        <hr className="divider" />
        <div className="field-row">
          <label className="field"><span>Primary provider</span>
            <select className="select" value={cfg['ai.provider']} onChange={(e) => set('ai.provider', e.target.value)}>
              <option value="deepseek">DeepSeek</option>
              <option value="gemini">Gemini</option>
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom provider</option>
            </select>
          </label>
          <label className="field"><span>Automatic fallback</span>
            <select className="select" value={cfg['ai.fallbackEnabled'] === 'false' ? 'false' : 'true'} onChange={(e) => set('ai.fallbackEnabled', e.target.value)}>
              <option value="true">Enabled (primary → DeepSeek → Custom → Gemini → OpenRouter)</option>
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
        <div className="spread mb">
          <div>
            <b>Custom AI provider <Badge kind="green">any OpenAI-compatible API</Badge></b>
            <p className="tiny muted">Bring any OpenAI-compatible endpoint: Groq, Mistral, xAI (Grok), Together, Fireworks, Cerebras, a self-hosted Ollama/vLLM, or your own gateway. {status?.customConfigured ? <Badge kind="green">configured</Badge> : <Badge kind="gray">not configured</Badge>}</p>
          </div>
        </div>
        <div className="row mb" style={{ flexWrap: 'wrap' }}>
          {Object.entries(presets).map(([id, p]) => (
            <button key={id} type="button" className="btn btn-ghost btn-sm" onClick={() => {
              set('custom.name', p.label)
              set('custom.baseUrl', p.base)
              set('custom.model', p.model)
              set('custom.enabled', 'true')
              if (cfg['ai.provider'] === 'deepseek' && !cfg['deepseek.apiKey']) set('ai.provider', 'custom')
            }}>⚡ {p.label}</button>
          ))}
        </div>
        <div className="field-row">
          <label className="field"><span>Display name</span>
            <input className="input" placeholder="Groq / Mistral / My gateway…" value={cfg['custom.name'] || ''} onChange={(e) => set('custom.name', e.target.value)} />
          </label>
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Base URL (OpenAI-compatible, ends before /chat/completions)</span>
            <input className="input" placeholder="https://api.groq.com/openai/v1" value={cfg['custom.baseUrl'] || ''} onChange={(e) => set('custom.baseUrl', e.target.value)} />
          </label>
          <label className="field"><span>API key (empty = none, for local Ollama)</span>
            <input className="input" type="password" placeholder="gsk_… / sk-…" value={cfg['custom.apiKey'] || ''} onChange={(e) => set('custom.apiKey', e.target.value)} />
          </label>
          <label className="field"><span>Model</span>
            <input className="input" placeholder="llama-3.3-70b-versatile" value={cfg['custom.model'] || ''} onChange={(e) => set('custom.model', e.target.value)} />
          </label>
          <label className="field"><span>Status</span>
            <select className="select" value={cfg['custom.enabled'] === 'false' ? 'false' : 'true'} onChange={(e) => set('custom.enabled', e.target.value)}>
              <option value="true">Enabled — include in fallback chain</option>
              <option value="false">Disabled</option>
            </select>
          </label>
        </div>
        <p className="tiny muted">Works with any API that accepts POST {'{baseUrl}'}/chat/completions with an Authorization: Bearer header — Groq (console.groq.com), Mistral (console.mistral.ai), xAI (console.x.ai), Together, Fireworks, Cerebras, OpenAI itself, or a local Ollama (base URL http://localhost:11434/v1, no key).</p>
      </div>

      <div className="card mb">
        <b className="small mb" style={{ display: 'block' }}>Optional features — students ke UI me turant show/hide hote hain</b>
        <div className="field-row">
          <label className="field"><span>🎙️ Voice doubts (Hindi / Hinglish speech-to-text)</span>
            <select className="select" value={cfg['features.voiceDoubts'] === 'true' ? 'true' : 'false'} onChange={(e) => set('features.voiceDoubts', e.target.value)}>
              <option value="false">Off — mic button hidden</option>
              <option value="true">On — students can speak doubts</option>
            </select>
          </label>
          <label className="field"><span>💬 Telegram tutor bot</span>
            <select className="select" value={cfg['features.telegramBot'] === 'true' ? 'true' : 'false'} onChange={(e) => set('features.telegramBot', e.target.value)}>
              <option value="false">Off — Telegram connect card hidden</option>
              <option value="true">On — students can link accounts</option>
            </select>
          </label>
          <label className="field"><span>👥 Group Study</span>
            <select className="select" value={cfg['features.groupStudy'] === 'true' ? 'true' : 'false'} onChange={(e) => set('features.groupStudy', e.target.value)}>
              <option value="false">Off — Groups page/nav hidden</option>
              <option value="true">On — students create & join groups</option>
            </select>
          </label>
          <label className="field"><span>🗨️ Group Discussions (chat)</span>
            <select className="select" value={cfg['features.groupDiscussions'] === 'true' ? 'true' : 'false'} onChange={(e) => set('features.groupDiscussions', e.target.value)}>
              <option value="false">Off — chat hidden everywhere</option>
              <option value="true">On — paid/entitled members can chat</option>
            </select>
          </label>
          <label className="field"><span>⚔️ 1v1 Quiz Battles</span>
            <select className="select" value={cfg['features.battles'] === 'true' ? 'true' : 'false'} onChange={(e) => set('features.battles', e.target.value)}>
              <option value="false">Off — Battles page/nav hidden</option>
              <option value="true">On — students duel with friends (ELO)</option>
            </select>
          </label>
        </div>
        {(cfg['features.groupStudy'] === 'true' || cfg['features.groupDiscussions'] === 'true') && (
          <>
            <hr className="divider" />
            <b className="small mb" style={{ display: 'block' }}>🎁 Free-seat deal builder — "kitne paid → kitne free"</b>
            <p className="tiny muted mb">Jo rule yahan set karoge wahi har group par apply hoga. Koi code/JSON nahi — ready-made deals choose karo ya numbers badlo. Save configuration dabana mat bhoolna.</p>
            <div className="row mb" style={{ gap: 8, flexWrap: 'wrap' }}>
              {[
                { label: '2 paid → 1 free (default)', n: 2, m: 1 },
                { label: '🚀 Launch: 1 paid → 1 free', n: 1, m: 1 },
                { label: '"4 ka group, 1 free"', n: 3, m: 1 },
                { label: '3 paid → 2 free', n: 3, m: 2 },
                { label: 'Sirf paid (0 free)', n: 2, m: 0 }
              ].map((p) => (
                <button key={p.label} type="button" className="btn btn-ghost btn-sm"
                  style={{
                    borderColor: 'rgba(99,102,241,0.4)',
                    background: (Number(cfg['groups.freeAfterPaid']) || 2) === p.n && (Number(cfg['groups.freeSlots']) || 0) === p.m ? 'rgba(99,102,241,0.18)' : 'transparent'
                  }}
                  onClick={() => { set('groups.freeAfterPaid', String(p.n)); set('groups.freeSlots', String(p.m)) }}>
                  {p.label}
                </button>
              ))}
            </div>
            <div className="card mb" style={{ padding: '14px 16px', borderColor: 'rgba(99,102,241,0.4)' }}>
              <p className="small" style={{ lineHeight: 2.2, margin: 0 }}>
                📜 Rule: jab kisi group me{' '}
                <input type="number" min="1" className="input" style={{ display: 'inline-block', width: 64, padding: '4px 8px' }} value={cfg['groups.freeAfterPaid'] || 2} onChange={(e) => set('groups.freeAfterPaid', e.target.value)} />
                {' '}paying members ho jayein, tab{' '}
                <input type="number" min="0" className="input" style={{ display: 'inline-block', width: 64, padding: '4px 8px' }} value={cfg['groups.freeSlots'] || 1} onChange={(e) => set('groups.freeSlots', e.target.value)} />
                {' '}member ko us group ki chat <b style={{ color: 'var(--green, #22c55e)' }}>FREE</b> mil jayegi.
              </p>
              <p className="tiny muted" style={{ marginTop: 8 }}>
                {Number(cfg['groups.freeSlots'] || 1) === 0
                  ? 'ℹ️ Abhi free seats OFF hain — sirf paying/addon members hi group chat me likh payenge.'
                  : `✅ Matlab: har ${Number(cfg['groups.freeAfterPaid']) || 2} paying members ${Number(cfg['groups.freeSlots']) || 1} dost ka chat seat unlock karte hain — per group max ${cfg['groups.maxFree'] || 3} free seats.`}
              </p>
            </div>
            <div className="field-row">
              <label className="field"><span>Max free seats per group (cap)</span>
                <input type="number" min="0" className="input" value={cfg['groups.maxFree'] || 3} onChange={(e) => set('groups.maxFree', e.target.value)} />
              </label>
              <label className="field"><span>Max members per group</span>
                <input type="number" min="2" className="input" value={cfg['groups.maxMembers'] || 20} onChange={(e) => set('groups.maxMembers', e.target.value)} />
              </label>
            </div>
            <div className="field-row">
              <label className="field"><span>Free user kitne group bana sakta hai</span>
                <input type="number" min="0" className="input" value={cfg['groups.groupsFreeForFree'] || 1} onChange={(e) => set('groups.groupsFreeForFree', e.target.value)} />
              </label>
              <label className="field"><span>Paid user kitne group bana sakta hai</span>
                <input type="number" min="1" className="input" value={cfg['groups.groupsFreeForPaid'] || 3} onChange={(e) => set('groups.groupsFreeForPaid', e.target.value)} />
              </label>
              <label className="field"><span>Free seat validity (din)</span>
                <input type="number" min="7" className="input" value={cfg['groups.freeSeatDays'] || 45} onChange={(e) => set('groups.freeSeatDays', e.target.value)} />
              </label>
            </div>
            <div className="card muted-bg" style={{ border: 'none', padding: '12px 16px' }}>
              <b className="small">Free-seat member ko kya milta hai (jawaab: bahut limited)</b>
              <ul className="tiny muted" style={{ margin: '6px 0 0', paddingLeft: 18, lineHeight: 1.9 }}>
                <li>✅ Sirf <b>usi group ki chat</b> — padhna aur likhna</li>
                <li>❌ Baaki paid add-ons NAHI — AI Power Pack, Voice Doubts, Smart Revision Pack, Analytics Pro apna alag purchase chahiye (Battles free hai sabke liye, iski zaroorat nahi)</li>
                <li>⏳ Seat {cfg['groups.freeSeatDays'] || 45} din valid — deal active rehne par auto-extend</li>
                <li>👀 Group Study (bina chat) sabke liye free hai — ye seat sirf Discussions chat ke liye</li>
              </ul>
            </div>
          </>
        )}
        <div className="field-row">
          <label className="field"><span>OpenAI API key (Whisper voice engine)</span>
            <input className="input" type="password" placeholder="sk-…" value={cfg['openai.apiKey'] || ''} onChange={(e) => set('openai.apiKey', e.target.value)} />
          </label>
        </div>
        {cfg['features.voiceDoubts'] === 'true' && !cfg['openai.apiKey'] && (
          <p className="tiny" style={{ color: 'var(--amber)' }}>⚠️ Voice doubts ON hai par OpenAI key missing — mic button students ko nahi dikhega jab tak key save na ho.</p>
        )}
        <hr className="divider" />
        <div className="row" style={{ alignItems: 'center', gap: 10 }}>
          <b className="small">Paid add-on pricing</b>
          <Link to="/admin/addons" className="btn btn-ghost btn-sm">🧩 Manage in Add-ons →</Link>
        </div>
        <p className="tiny muted">On/off + monthly/yearly pricing for all 7 add-ons ab apne alag page par hai — Admin → Add-ons.</p>
        <hr className="divider" />
        <b className="small mb" style={{ display: 'block' }}>Feature toggles — CA page & Focus page visibility</b>
        <div className="field-row">
          <label className="field"><span>📰 Current Affairs page (student nav)</span>
            <select className="select" value={cfg['features.currentAffairs'] === 'true' ? 'true' : 'false'} onChange={(e) => set('features.currentAffairs', e.target.value)}>
              <option value="false">Off — nav hidden, API 403</option>
              <option value="true">On — CA Pro buyers ke liye visible</option>
            </select>
          </label>
          <label className="field"><span>🔥 Focus Areas page (student nav)</span>
            <select className="select" value={cfg['features.focusAreas'] === 'true' ? 'true' : 'false'} onChange={(e) => set('features.focusAreas', e.target.value)}>
              <option value="false">Off — nav hidden, API 403</option>
              <option value="true">On — Focus buyers ke liye visible</option>
            </select>
          </label>
        </div>
        <hr className="divider" />
        <b className="small mb" style={{ display: 'block' }}>🔍 Exa web search (Current Affairs grounding — optional)</b>
        <div className="field-row">
          <label className="field"><span>Exa API key (dashboard.exa.ai)</span>
            <input className="input" type="password" placeholder="your exa api key" value={cfg['exa.apiKey'] || ''} onChange={(e) => set('exa.apiKey', e.target.value)} />
          </label>
          <label className="field"><span>Monthly search limit (cost cap)</span>
            <input type="number" className="input" value={cfg['exa.monthlyLimit'] || 500} onChange={(e) => set('exa.monthlyLimit', e.target.value)} />
          </label>
        </div>
        <p className="tiny muted mb">Key di to CA quiz AI real last-7-days news par ground hoti hai (accuracy ↑). Key nahi to AI apni knowledge se generate karega — kuch nahi tootta. Cost guard: din me 1 generation per exam + monthly cap. Env me EXA_API_KEY diye to wo priority rakhega.</p>

        <hr className="divider" />
        <b className="small mb" style={{ display: 'block' }}>💰 Contextual ads (Gravity — free users ke tutor answers ke neeche)</b>
        <div className="field-row">
          <label className="field"><span>Gravity publisher API key (trygravity.ai)</span>
            <input className="input" type="password" placeholder="publisher api key" value={cfg['gravity.apiKey'] || ''} onChange={(e) => set('gravity.apiKey', e.target.value)} />
          </label>
          <label className="field"><span>Ads ON/OFF</span>
            <select className="select" value={cfg['features.contextualAds'] === 'false' ? 'false' : 'true'} onChange={(e) => set('features.contextualAds', e.target.value)}>
              <option value="true">On (default) — free users ke AI answers ke neeche sponsored suggestion</option>
              <option value="false">Off — kill-switch, koi ad nahi</option>
            </select>
          </label>
        </div>
        <p className="tiny muted mb">Key dali hai to ads chalu — kill-switch sirf explicit "Off" par. Pay-per-impression revenue. Ads sirf free users ko dikhte hain (AI Power Pack wale ko clean tutor), native card style, koi banner/spam nahi. Ad fail → kuch nahi dikhta, app kabhi nahi toot-ta.</p>

        <hr className="divider" />
        <b className="small mb" style={{ display: 'block' }}>Telegram bot wiring</b>
        <div className="field-row">
          <label className="field"><span>Bot token (@BotFather se — keep secret)</span>
            <input className="input" type="password" placeholder="123456:ABC-DEF…" value={cfg['telegram.botToken'] || ''} onChange={(e) => set('telegram.botToken', e.target.value)} />
          </label>
          <label className="field"><span>Bot username (optional, for the connect card)</span>
            <input className="input" placeholder="YourExamAITutorBot" value={cfg['telegram.botUsername'] || ''} onChange={(e) => set('telegram.botUsername', e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field" style={{ gridColumn: 'span 2' }}><span>Webhook domain (jahan se bot already bana hai — e.g. https://aisepadho.com)</span>
            <input className="input" placeholder="https://aisepadho.com" value={cfg['telegram.webhookDomain'] || ''} onChange={(e) => set('telegram.webhookDomain', e.target.value)} />
          </label>
        </div>
        <p className="tiny muted mb">Bot agar Vercel/frontend domain se banaya hai to yahan apna final domain daalo (https:// ke saath, bina trailing slash). Telegram sirf ek public HTTPS URL maangta hai — aapke domain ka /api/* backend tak pahunchta hai (Vercel rewrite ya same-host serve), to webhook wahi chalega. Khali chhoda to BACKEND_URL use hoga.</p>
        <div className="row">
          <button className="btn btn-ghost btn-sm" onClick={setupTelegramWebhook} disabled={tgSetup || !cfg['telegram.botToken']}>
            {tgSetup ? 'Wiring…' : '🔗 Wire webhook automatically'}
          </button>
          <span className="tiny muted">Turn bot ON + save first. Webhook URL = webhookDomain (ya BACKEND_URL) + /api/telegram/webhook</span>
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
