// Aisepadho service worker — v4.
// Fix for the standalone "opens then immediately closes" install crash.
//
// Root cause: on Android/Chrome the standalone launch performs the very first
// navigation BEFORE the browser UI has decided the app is alive. If that first
// navigation has to go to the network and anything is slow (or the response is
// not a clean 200 HTML), Chrome treats the activity as failed and closes the
// app — which looks like "opens and instantly closes, repeatedly".
//
// Fix: guarantee an always-cached, instantly-responding app shell:
//   - install: precache '/' and verify it is real HTML before declaring install
//     success (a broken precache would otherwise poison the offline shell).
//   - navigation requests: respond IMMEDIATELY from the cached shell
//     (cache-first), then refresh the cache silently in the background
//     (stale-while-revalidate). Users always get an instant standalone start;
//     a fresh deploy is picked up on the next load instead of breaking this one.
//   - offline fallback + a '/?sw-recovered=1' reload path if even the cache is
//     missing, so the app can self-heal instead of crashing.
// Assets are content-hashed, so cache-first remains correct for them.
const CACHE = 'aisepadho-v4'
const SHELL = '/'
const PRECACHE = [SHELL, '/manifest.json', '/icon-192.png', '/icon-512.png', '/icon-maskable.png', '/apple-touch-icon.png']

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE)
    await Promise.all(PRECACHE.map((u) => cache.add(u).catch(() => {})))
    // Verify the shell actually cached as HTML; otherwise fetch+store manually.
    const shell = await cache.match(SHELL)
    if (!shell || !(await shell.text()).includes('<div id="root">')) {
      try {
        const res = await fetch(SHELL, { cache: 'no-store' })
        if (res.ok) await cache.put(SHELL, res.clone())
      } catch { /* offline install attempt; activation will retry on load */ }
    }
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

// Background-refresh the shell when a normal browser-tab page becomes visible.
self.addEventListener('message', (e) => {
  if (e.data === 'sw:refresh-shell') {
    e.waitUntil((async () => {
      try {
        const res = await fetch(SHELL, { cache: 'no-store' })
        if (res.ok) {
          const cache = await caches.open(CACHE)
          await cache.put(SHELL, res.clone())
        }
      } catch { /* offline — keep old shell */ }
    })())
  }
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== location.origin) return
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/uploads')) return

  // Navigations: instant cached shell + silent background refresh.
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html')) {
    e.respondWith((async () => {
      const cache = await caches.open(CACHE)
      const shell = (await cache.match(SHELL)) || (await cache.match(req))
      if (shell) {
        // Refresh behind the response — never blocks the user.
        e.waitUntil((async () => {
          try {
            const fresh = await fetch(SHELL, { cache: 'no-store' })
            if (fresh.ok) await cache.put(SHELL, fresh.clone())
          } catch { /* offline — cached shell stands */ }
        })())
        return shell
      }
      // No shell yet (first ever run): try network, else self-heal reload.
      try {
        const fresh = await fetch(SHELL, { cache: 'no-store' })
        if (fresh.ok) {
          await cache.put(SHELL, fresh.clone())
          return fresh
        }
      } catch { /* fallthrough */ }
      // Response.redirect needs an ABSOLUTE URL — a relative one throws
      // "Failed to convert value to 'Response'" and rejects the FetchEvent.
      return Response.redirect(new URL('/?sw-recovered=1', self.location.origin).href, 302)
    })())
    return
  }

  // Hashed build assets: immutable — cache first, then network.
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

  // Everything else (icons, fonts, manifest): stale-while-revalidate.
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
