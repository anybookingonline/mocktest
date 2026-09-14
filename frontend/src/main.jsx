import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { BrandingProvider } from './context/BrandingContext.jsx'
import InstallPrompt from './components/InstallPrompt.jsx'
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
      <BrandingProvider>
        <AuthProvider>
          <App />
          <InstallPrompt />
        </AuthProvider>
      </BrandingProvider>
    </BrowserRouter>
  </React.StrictMode>
)
