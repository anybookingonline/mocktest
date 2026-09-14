import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { BrandingProvider } from './context/BrandingContext.jsx'
import { LangProvider } from './context/LangContext.jsx'
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
  // When a normal browser tab becomes visible, ask the SW to refresh the
  // cached app shell in the background. Standalone launches always respond
  // instantly from cache, so this keeps them up to date after deploys.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      navigator.serviceWorker.controller?.postMessage('sw:refresh-shell')
    }
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <BrandingProvider>
        <LangProvider>
          <AuthProvider>
            <App />
            <InstallPrompt />
          </AuthProvider>
        </LangProvider>
      </BrandingProvider>
    </BrowserRouter>
  </React.StrictMode>
)
