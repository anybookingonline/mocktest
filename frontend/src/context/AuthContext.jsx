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

  const login = async (email, password) => {
    const d = await api.post('/auth/login', { email, password })
    setToken(d.token)
    setUser(d.user)
    return d.user
  }

  const register = async (name, email, password, target_exam) => {
    const d = await api.post('/auth/register', { name, email, password, target_exam })
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
