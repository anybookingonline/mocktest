import React, { createContext, useContext, useEffect, useState } from 'react'
import { api, getToken, setToken, clearToken } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!getToken()) { setLoading(false); return }
    api.get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => { clearToken() })
      .finally(() => setLoading(false))
  }, [])

  // The api client clears the token on any 401; mirror that here so the UI
  // flips to logged-out the moment the session actually expires instead of
  // rendering a half-broken authenticated shell (battles blank page, sidebar
  // "resetting", endless 401s in console).
  useEffect(() => {
    const onExpired = () => setUser(null)
    window.addEventListener('auth:expired', onExpired)
    return () => window.removeEventListener('auth:expired', onExpired)
  }, [])

  const login = async (email, password) => {
    const d = await api.post('/auth/login', { email, password })
    setToken(d.token)
    setUser(d.user)
    return d.user
  }

  const register = async (name, email, password, target_exam, inviteCode, examId) => {
    const d = await api.post('/auth/register', { name, email, password, target_exam, inviteCode, examId })
    setToken(d.token)
    setUser(d.user)
    return d.user
  }

  const logout = () => {
    clearToken()
    setUser(null)
  }

  const updateUser = (patch) => {
    setUser((u) => (u ? { ...u, ...patch } : u))
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
