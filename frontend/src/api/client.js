const TOKEN_KEY = 'examai_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(t) {
  localStorage.setItem(TOKEN_KEY, t)
}
export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

async function request(path, { method = 'GET', body, headers = {}, silentAuth = false } = {}) {
  const token = getToken()
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  const opts = {
    method,
    // FormData (file uploads) must NOT get a manual Content-Type — the browser
    // needs to set its own multipart boundary. Everything else is JSON.
    headers: { ...(body && !isFormData ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
  }
  if (isFormData) opts.body = body
  else if (body && typeof body !== 'string') opts.body = JSON.stringify(body)
  else if (body) opts.body = body

  const res = await fetch('/api' + path, opts)
  let data = null
  try { data = await res.json() } catch { data = {} }
  if (!res.ok) {
    // Auth expiry is normal while a logged-out tab is open (PWA shells,
    // background pages). Silently clear the token instead of spamming
    // console errors — only surface it if the caller wants it.
    if (res.status === 401) {
      clearToken()
      // Tell AuthContext the session died so the UI flips to logged-out
      // immediately (previously the UI kept rendering as logged-in while
      // every request 401'd, which looked like random blank pages).
      window.dispatchEvent(new CustomEvent('auth:expired'))
      if (silentAuth) return null
    }
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data
    throw err
  }
  return data
}

export const api = {
  get: (p, opts) => request(p, opts),
  post: (p, body, opts) => request(p, { method: 'POST', body, ...opts }),
  put: (p, body, opts) => request(p, { method: 'PUT', body, ...opts }),
  del: (p, opts) => request(p, { method: 'DELETE', ...opts }),
  upload: (p, file, extra = {}, opts = {}) => {
    const fd = new FormData()
    fd.append('file', file)
    for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    return request(p, { method: 'POST', body: fd, ...opts })
  },
  // Multiple files in one request under the 'files' field (Gemini Batch Mode
  // PDF import — the server submits them all as one batch job).
  uploadMany: (p, files, extra = {}, opts = {}) => {
    const fd = new FormData()
    for (const f of files) fd.append('files', f)
    for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    return request(p, { method: 'POST', body: fd, ...opts })
  }
}
