import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, Modal, useToast, fmtDate } from '../../components/ui.jsx'

export default function AdminUsers() {
  const toast = useToast()
  const [users, setUsers] = useState([])
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'student', target_exam: '' })

  const load = () => api.get('/admin/users').then((d) => setUsers(d.users)).catch(() => {})
  useEffect(load, [])

  const create = async () => {
    if (!form.name || !form.email || !form.password) { toast('All fields required', 'err'); return }
    try {
      await api.post('/admin/users', form)
      toast('User created', 'ok'); setModal(false); setForm({ name: '', email: '', password: '', role: 'student', target_exam: '' }); load()
    } catch (e) { toast(e.message, 'err') }
  }

  const setRole = async (id, role) => {
    try { await api.put(`/admin/users/${id}`, { role }); load(); toast('Role updated') } catch (e) { toast(e.message, 'err') }
  }

  const remove = async (id, name) => {
    if (!confirm(`Delete user "${name}"? Their attempts will be removed.`)) return
    try { await api.del(`/admin/users/${id}`); toast('Deleted'); load() } catch (e) { toast(e.message, 'err') }
  }

  return (
    <AdminLayout title="User Management">
      <div className="spread mb">
        <p className="small muted">{users.length} registered users</p>
        <button className="btn btn-primary" onClick={() => setModal(true)}>+ Add user</button>
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="tbl">
          <thead><tr><th>User</th><th>Role</th><th>Target</th><th>Tests</th><th>Avg score</th><th>Joined</th><th>Actions</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td>
                  <div className="row">
                    <div className="avatar" style={{ width: 28, height: 28, fontSize: 12 }}>{u.name?.charAt(0)}</div>
                    <div><b className="small">{u.name}</b><div className="tiny">{u.email}</div></div>
                  </div>
                </td>
                <td><Badge kind={u.role === 'admin' ? 'purple' : 'blue'}>{u.role}</Badge></td>
                <td className="tiny">{u.target_exam || '—'}</td>
                <td>{u.tests_taken}</td>
                <td>{Number(u.avg_score).toFixed(1)}</td>
                <td className="tiny">{fmtDate(u.created_at)}</td>
                <td>
                  <div className="row">
                    <button className="btn btn-sm btn-ghost" onClick={() => setRole(u.id, u.role === 'admin' ? 'student' : 'admin')}>{u.role === 'admin' ? '→ student' : '→ admin'}</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(u.id, u.name)}>×</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Add user"
        footer={<>
          <button className="btn btn-ghost" onClick={() => setModal(false)}>Cancel</button>
          <button className="btn btn-primary" onClick={create}>Create</button>
        </>}>
        <div className="col">
          <label className="field"><span>Name</span><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span>Email</span><input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field"><span>Password</span><input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label className="field"><span>Role</span>
            <select className="select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="student">Student</option><option value="admin">Admin</option>
            </select>
          </label>
          <label className="field"><span>Target exam</span><input className="input" value={form.target_exam} onChange={(e) => setForm({ ...form, target_exam: e.target.value })} placeholder="JEE Main" /></label>
        </div>
      </Modal>
    </AdminLayout>
  )
}
