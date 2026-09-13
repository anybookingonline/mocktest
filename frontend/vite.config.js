import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const FRONTEND_PORT = Number(process.env.PORT) || 5173
const BACKEND_PORT = process.env.BACKEND_PORT || 3001

export default defineConfig({
  plugins: [react()],
  build: {
    // Freebuff single-service deploy: backend serves repo-root dist/ (SPA
    // fallback). On Vercel the project root is frontend/ and Vercel cannot
    // collect build output outside it — so emit inside the project there.
    outDir: process.env.VERCEL ? 'dist' : '../dist',
    emptyOutDir: true
  },
  server: {
    port: FRONTEND_PORT,
    host: true,
    strictPort: true,
    allowedHosts: ['.monkeycode-ai.live'],
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        timeout: 600000,
        proxyTimeout: 600000
      },
      '/uploads': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true
      }
    }
  }
})
