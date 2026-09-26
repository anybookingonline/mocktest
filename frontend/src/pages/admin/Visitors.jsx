import React, { useEffect, useState } from 'react'
import { AdminLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Skeleton } from '../../components/ui.jsx'

// Admin → Visitor Analytics. First-party tracking (no third-party tracker):
// summary cards (Today / Yesterday / Total unique visitors + pageviews),
// top referral sources, top countries, top paths and a paginated detail table
// with IP, country, source, device and last-seen per visit group.
export default function AdminVisitors() {
  const [data, setData] = useState(null)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(1)
  const [err, setErr] = useState('')

  const load = (p = page) => {
    api.get(`/admin/visitors?page=${p}&perPage=50`)
      .then((d) => {
        setData(d)
        setPages(d.pagination?.pages || 1)
        setErr('')
      })
      .catch((e) => setErr(e.message || 'Load failed'))
  }

  useEffect(() => { load(1) }, [])
  useEffect(() => { if (page > 1) load(page) }, [page])

  const goPage = (p) => {
    if (p < 1 || p > pages || p === page) return
    setPage(p)
  }

  const s = data?.summary
  const card = (label, visitors, views, accent) => (
    <div className="card" style={{ textAlign: 'center', minWidth: 150 }}>
      <div className="tiny muted">{label}</div>
      <div style={{ fontSize: 30, fontWeight: 800, color: accent }}>{visitors}</div>
      <div className="tiny muted">{views} pageviews</div>
    </div>
  )

  return (
    <AdminLayout title="👀 Visitor Analytics">
      {err && <div className="card mb" style={{ color: 'var(--red)' }}>{err}</div>}
      {!data && !err && <Skeleton h={300} />}

      {data && (
        <>
          {/* Today / Yesterday / Total — unique visitors first, views second */}
          <div className="row mb" style={{ gap: 12, flexWrap: 'wrap' }}>
            {card('Today — Visitors', s?.today?.visitors ?? 0, s?.today?.views ?? 0, 'var(--accent2)')}
            {card('Yesterday — Visitors', s?.yesterday?.visitors ?? 0, s?.yesterday?.views ?? 0, 'var(--amber)')}
            {card('Total — Visitors', s?.total?.visitors ?? 0, s?.total?.views ?? 0, 'var(--green)')}
          </div>

          {/* Top referral sources with today / yesterday / total columns */}
          <div className="card mb">
            <b className="small mb" style={{ display: 'block' }}>Traffic sources (referrals)</b>
            <table className="tbl">
              <thead><tr><th>Source</th><th>Today</th><th>Yesterday</th><th>Total hits</th><th>Unique visitors</th></tr></thead>
              <tbody>
                {data.topSources?.map((r) => (
                  <tr key={r.source}>
                    <td><b>{r.source}</b></td>
                    <td>{Number(r.today) || 0}</td>
                    <td>{Number(r.yesterday) || 0}</td>
                    <td>{Number(r.hits) || 0}</td>
                    <td>{Number(r.visitors) || 0}</td>
                  </tr>
                ))}
                {(!data.topSources || data.topSources.length === 0) && <tr><td colSpan={5} className="muted tiny">Abhi koi visit track nahi hui.</td></tr>}
              </tbody>
            </table>
          </div>

          <div className="grid grid-3 mb">
            <div className="card">
              <b className="small mb" style={{ display: 'block' }}>Top countries</b>
              {data.topCountries?.length === 0 && <span className="tiny muted">No data yet</span>}
              {data.topCountries?.map((c) => (
                <div key={c.country} className="spread small" style={{ padding: '4px 0' }}>
                  <span>🌍 {c.country}</span>
                  <span className="tiny">{Number(c.visitors) || 0} visitors · {Number(c.hits) || 0} hits</span>
                </div>
              ))}
            </div>
            <div className="card">
              <b className="small mb" style={{ display: 'block' }}>Top pages</b>
              {data.topPaths?.length === 0 && <span className="tiny muted">No data yet</span>}
              {data.topPaths?.map((p) => (
                <div key={p.path} className="spread small" style={{ padding: '4px 0' }}>
                  <span style={{ maxWidth: '60%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.path}</span>
                  <span className="tiny">{Number(p.visitors) || 0} visitors · {Number(p.hits) || 0} hits</span>
                </div>
              ))}
            </div>
            <div className="card">
              <b className="small mb" style={{ display: 'block' }}>Note</b>
              <p className="tiny muted">Tracking first-party hai — koi third-party tracker nahi. Ek visitor (browser) din me same page kitni baar bhi khole, sirf 1 baar count hota hai (24h unique). Country Cloudflare/Vercel headers se aati hai (jab available ho).</p>
            </div>
          </div>

          {/* Paginated detail table */}
          <div className="card">
            <div className="spread mb">
              <b className="small">Visit details</b>
              <span className="tiny muted">{data.pagination?.total ?? 0} total visit groups</span>
            </div>
            <table className="tbl">
              <thead>
                <tr>
                  <th>When</th><th>Path</th><th>Source</th><th>Country</th><th>IP</th><th>Device</th><th>Visitor</th>
                </tr>
              </thead>
              <tbody>
                {data.hits?.map((h) => (
                  <tr key={h.id}>
                    <td className="tiny" style={{ whiteSpace: 'nowrap' }}>{h.last_seen}</td>
                    <td className="tiny" style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.path}</td>
                    <td><span className="chip">{h.source}</span></td>
                    <td className="tiny">{h.country || '—'}{h.city ? ` · ${h.city}` : ''}</td>
                    <td className="tiny" style={{ fontFamily: 'monospace' }}>{h.ip || '—'}</td>
                    <td className="tiny">{h.device === 'mobile' ? '📱' : h.device === 'tablet' ? '📲' : '💻'} {h.device}</td>
                    <td className="tiny" style={{ fontFamily: 'monospace' }}>{String(h.visitor_id).slice(0, 8)}…</td>
                  </tr>
                ))}
                {(!data.hits || data.hits.length === 0) && <tr><td colSpan={7} className="muted tiny">Abhi koi visit record nahi hui.</td></tr>}
              </tbody>
            </table>

            {pages > 1 && (
              <div className="row mt" style={{ justifyContent: 'center', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => goPage(page - 1)} disabled={page <= 1}>← Prev</button>
                <span className="tiny">Page {page} / {pages}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => goPage(page + 1)} disabled={page >= pages}>Next →</button>
              </div>
            )}
          </div>
        </>
      )}
    </AdminLayout>
  )
}
