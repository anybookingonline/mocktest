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

async function request(path, { method = 'GET', body, headers = {} } = {}) {
  const token = getToken()
  const opts = {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers }
  }
  if (body && typeof body !== 'string') opts.body = JSON.stringify(body)
  else if (body) opts.body = body

  const res = await fetch('/api' + path, opts)
  let data = null
  try { data = await res.json() } catch { data = {} }
  if (!res.ok) {
    const err = new Error(data?.error || `Request failed (${res.status})`)
    err.status = res.status
    err.data = data
    if (res.status === 401) clearToken()
    throw err
  }
  return data
}

export const api = {
  get: (p) => request(p),
  post: (p, body) => request(p, { method: 'POST', body }),
  put: (p, body) => request(p, { method: 'PUT', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  upload: (p, file, extra = {}) => {
    const fd = new FormData()
    fd.append('file', file)
    for (const [k, v] of Object.entries(extra)) fd.append(k, v)
    return request(p, { method: 'POST', body: fd })
  }
}
