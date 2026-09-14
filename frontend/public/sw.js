// Aisepadho service worker — v3.
// Fix for the white-screen crash: the old worker served a cached index.html
// that referenced hashed assets from a previous deploy. Once those hashed
// files were replaced on the server, the stale HTML loaded 404 JS and the app
// died. Strategy now:
//   - navigations (index.html / SPA routes): NETWORK FIRST, cache fallback.
//     Fresh HTML is cached on every successful load, so offline still works
//     and a new deploy is always picked up.
//   - /assets/* (content-hashed Vite output): CACHE FIRST. A hashed filename
//     never changes meaning, so cached == fresh forever.
//   - /api, /uploads: never cached (live data and user files).
//   - old-version caches are purged on activate.
const CACHE = 'aisepadho-v3'
const PRECACHE = ['/', '/manifest.json', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    // Precache best-effort: one bad asset must not break the install.
    await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {})))
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    await self.clients.claim()
  })())
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return

  // SPA navigations: fresh HTML from network, cached copy only offline.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req)
        if (fresh.ok) {
          const cache = await caches.open(CACHE)
          cache.put('/', fresh.clone()).catch(() => {})
        }
        return fresh
      } catch {
        return (await caches.match('/')) || (await caches.match(req)) ||
          new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      }
    })())
    return
  }

  // Hashed build assets: immutable — cache first.
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith((async () => {
      const hit = await caches.match(req)
      if (hit) return hit
      try {
        const fresh = await fetch(req)
        if (fresh.ok) {
          const cache = await caches.open(CACHE)
          cache.put(req, fresh.clone()).catch(() => {})
        }
        return fresh
      } catch {
        return new Response('Offline', { status: 503 })
      }
    })())
    return
  }

  // Everything else (icons, manifest, fonts): stale-while-revalidate.
  e.respondWith((async () => {
    const cache = await caches.open(CACHE)
    const hit = await cache.match(req)
    const network = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone()).catch(() => {})
      return res
    }).catch(() => hit)
    return hit || network
  })())
})
