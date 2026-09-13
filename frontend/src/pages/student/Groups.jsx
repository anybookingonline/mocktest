import React, { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { StudentLayout } from '../../components/Layout.jsx'
import { useAuth } from '../../context/AuthContext.jsx'
import { api } from '../../api/client.js'
import { Badge, Empty, useToast } from '../../components/ui.jsx'

// Group Study & Discussions. The whole page is feature-flag driven: when the
// admin turns Groups off, the nav item disappears and this route 403s.
export default function Groups() {
  const toast = useToast()
  const { user } = useAuth()
  const myId = user?.id
  const [data, setData] = useState(null)
  const [open, setOpen] = useState(null) // group detail
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState('')
  const chatRef = useRef(null)
  const afterId = useRef(0)

  const load = () => {
    api.get('/groups').then(setData).catch((e) => setData({ error: e.message }))
  }
  useEffect(() => { load() }, [])

  const openGroup = async (id) => {
    try {
      const d = await api.get(`/groups/${id}`)
      setOpen(d)
      afterId.current = d.messages?.length ? d.messages[d.messages.length - 1].id : 0
    } catch (e) { toast(e.message, 'err') }
  }

  // Poll for new messages while a group with chat is open
  useEffect(() => {
    if (!open?.group || !open.discussionsEnabled) return
    const t = setInterval(async () => {
      try {
        const d = await api.get(`/groups/${open.group.id}/messages?after=${afterId.current}`)
        if (d.messages?.length) {
          afterId.current = d.messages[d.messages.length - 1].id
          setOpen((o) => ({ ...o, messages: [...(o.messages || []), ...d.messages] }))
          requestAnimationFrame(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' }))
        }
      } catch { /* ignore poll errors */ }
    }, 4000)
    return () => clearInterval(t)
  }, [open?.group?.id, open?.discussionsEnabled])

  const send = async () => {
    const body = draft.trim()
    if (!body || !open?.group) return
    try {
      await api.post(`/groups/${open.group.id}/messages`, { body })
      setDraft('')
      const d = await api.get(`/groups/${open.group.id}/messages?after=${afterId.current}`)
      if (d.messages?.length) {
        afterId.current = d.messages[d.messages.length - 1].id
        setOpen((o) => ({ ...o, messages: [...(o.messages || []), ...d.messages] }))
        requestAnimationFrame(() => chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight }))
      }
    } catch (e) { toast(e.message, e.status === 402 ? 'err' : 'err') }
  }

  const create = async () => {
    if (!name.trim()) return toast('Group ka naam likho', 'err')
    setBusy(true)
    try {
      const d = await api.post('/groups', { name: name.trim() })
      toast(`Group ban gaya! Join code: ${d.joinCode}`, 'ok')
      setName('')
      load()
      openGroup(d.groupId)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const join = async () => {
    if (!code.trim()) return toast('Join code likho', 'err')
    setBusy(true)
    try {
      const d = await api.post('/groups/join', { code: code.trim() })
      toast(d.already ? 'Aap pehle se is group me ho' : 'Group join ho gaya! 🎉', 'ok')
      setCode('')
      load()
      openGroup(d.groupId)
    } catch (e) { toast(e.message, 'err') } finally { setBusy(false) }
  }

  const leave = async (id) => {
    try {
      const d = await api.post(`/groups/${id}/leave`, {})
      toast(d.deleted ? 'Group delete ho gaya' : 'Group chhod diya', 'ok')
      setOpen(null)
      load()
    } catch (e) { toast(e.message, 'err') }
  }

  if (!data) return <StudentLayout title="Group Study"><div className="spin" /></StudentLayout>
  if (data.error) {
    return (
      <StudentLayout title="Group Study">
        <Empty title="Group Study band hai" text="Admin ne ye feature abhi disable kiya hai. Baad me try karo." />
      </StudentLayout>
    )
  }

  const { groups, deal, flags, canCreate } = data

  return (
    <StudentLayout title="Group Study & Discussions">
      {!open ? (
        <>
          <div className="card mb spread">
            <div>
              <b>Padho saath me, jeeto saath me 👥</b>
              <p className="tiny muted">
                Group banao ya dost ka join code daalo. Deal: <b>{deal.freeAfterPaid} paying members → {deal.freeSlots} free seat{deal.freeSlots > 1 ? 's' : ''}</b>
                {flags.discussions ? ' (free seat = group chat unlocked).' : '.'}
              </p>
            </div>
            <Badge kind={flags.discussions ? 'purple' : 'gray'}>{flags.discussions ? 'Discussions ON' : 'Study only'}</Badge>
          </div>

          <div className="grid grid-2 mb">
            <div className="card">
              <b className="small mb" style={{ display: 'block' }}>➕ Naya group banao</b>
              <label className="field"><span>Group name</span>
                <input className="input" placeholder="e.g. SSC Batch 2027" value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <button className="btn btn-primary" onClick={create} disabled={busy || !canCreate.allowed}>
                {canCreate.allowed ? 'Create group' : `Limit reached (${canCreate.count}/${canCreate.limit})`}
              </button>
              {!canCreate.allowed && !canCreate.paid && (
                <p className="tiny muted mt">Free users {canCreate.limit} group bana sakte hain — <Link to="/retention">paid plan</Link> par {deal.maxMembers}+ tak.</p>
              )}
            </div>
            <div className="card">
              <b className="small mb" style={{ display: 'block' }}>🔗 Dost ke group me join karo</b>
              <label className="field"><span>Join code (6 letters)</span>
                <input className="input" placeholder="e.g. K7MP2X" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} />
              </label>
              <button className="btn btn-accent" onClick={join} disabled={busy}>Join group</button>
            </div>
          </div>

          {groups.length === 0 ? (
            <Empty title="Abhi koi group nahi" text="Upar se group banao ya join code se join karo." />
          ) : (
            <div className="grid grid-3">
              {groups.map((g) => (
                <div key={g.id} className="card hover" style={{ cursor: 'pointer' }} onClick={() => openGroup(g.id)}>
                  <div className="spread mb">
                    <b>{g.kind === 'discussion' ? '🗨️' : '📚'} {g.name}</b>
                    {g.role === 'owner' ? <Badge kind="blue">Owner</Badge> : null}
                  </div>
                  <p className="tiny muted">Code: <b>{g.join_code}</b> · {g.member_count}/{deal.maxMembers} members</p>
                  <div className="progress mt" style={{ height: 6 }}>
                    <div style={{ width: `${Math.min(100, (g.paidCount / deal.freeAfterPaid) * 100)}%` }} />
                  </div>
                  <p className="tiny mt">
                    {g.freeUnlocked > 0
                      ? <>✅ <span style={{ color: 'var(--green)' }}>{g.freeUnlocked} free seat unlocked</span></>
                      : <>{g.paidCount}/{deal.freeAfterPaid} paying members → free seat</>}
                  </p>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="card mb spread">
            <div>
              <b>{open.group.kind === 'discussion' ? '🗨️' : '📚'} {open.group.name}</b>
              <p className="tiny muted">
                Owner: {open.ownerName} · Join code: <b>{open.group.joinCode}</b> · {open.members.length}/{open.deal.maxMembers} members
                {' · '}{open.paidCount}/{open.deal.freeAfterPaid} paying → {open.freeUnlocked} free seat{open.freeUnlocked === 1 ? '' : 's'}
              </p>
            </div>
            <div className="row">
              <button className="btn btn-ghost btn-sm" onClick={() => { setOpen(null); load() }}>← Back</button>
              {!open.group.isOwner && <button className="btn btn-danger btn-sm" onClick={() => leave(open.group.id)}>Leave</button>}
              {open.group.isOwner && open.members.length === 1 && <button className="btn btn-danger btn-sm" onClick={() => leave(open.group.id)}>Delete group</button>}
            </div>
          </div>

          <div className="card mb spread">
            <div>
              <b className="small">👥 Group Plan</b>
              <p className="tiny muted">Paid member bano ({open.paidCount}/{open.deal.freeAfterPaid} ho gaye) — {open.deal.freeAfterPaid} paying par {open.deal.freeSlots} dost ka seat FREE aur sabko chat.</p>
            </div>
            <Link to={`/retention?buyGroup=${open.group.id}`} className="btn btn-accent btn-sm">Group Plan le lo →</Link>
          </div>

          {open.discussionsEnabled ? (
            <div className="card" style={{ display: 'flex', flexDirection: 'column', height: '55vh' }}>
              <div ref={chatRef} style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, padding: 4 }}>
                {(open.messages || []).length === 0 && <p className="tiny muted">Pehla message bhejo — discussion shuru karo!</p>}
                {(open.messages || []).map((m) => (
                  <div key={m.id} style={{ alignSelf: Number(m.user_id) === Number(myId) ? 'flex-end' : 'flex-start', maxWidth: '80%', textAlign: 'left' }}>
                    <div className="ai-bubble" style={{ padding: '10px 14px', background: Number(m.user_id) === Number(myId) ? 'rgba(99,102,241,0.15)' : 'var(--bg2)' }}>
                      <b className="tiny" style={{ color: 'var(--accent2)' }}>{m.user_name}</b>
                      <div>{m.body}</div>
                    </div>
                    <span className="tiny muted" style={{ marginLeft: 6 }}>{String(m.created_at).slice(11, 16)}</span>
                  </div>
                ))}
              </div>
              <div className="row mt">
                <input className="input" style={{ flex: 1 }} placeholder="Message likho…" value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
                <button className="btn btn-primary" onClick={send} disabled={!draft.trim()}>Send</button>
              </div>
            </div>
          ) : (
            <div className="card">
              <b>Members</b>
              <table className="tbl mt">
                <thead><tr><th>Name</th><th>Role</th><th>Plan</th></tr></thead>
                <tbody>
                  {open.members.map((m) => (
                    <tr key={m.id}>
                      <td>{m.name}</td>
                      <td>{m.role === 'owner' ? '👑 Owner' : 'Member'}</td>
                      <td>{m.paid ? <Badge kind="green">Paying</Badge> : <Badge kind="gray">Free</Badge>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="tiny muted mt">
                Group chat {open.deal.freeAfterPaid} paying members hone par unlock hota hai (free seat policy). Abhi tak: {open.paidCount}/{open.deal.freeAfterPaid}.
              </p>
            </div>
          )}
        </>
      )}
    </StudentLayout>
  )
}
