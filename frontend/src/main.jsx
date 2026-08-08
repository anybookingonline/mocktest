import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import './styles.css'

if (import.meta.env.DEV) {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      const regs = await navigator.serviceWorker.getRegistrations()
      for (const r of regs) await r.unregister()
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    })
  }
} else if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {})
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
