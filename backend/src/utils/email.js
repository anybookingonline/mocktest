import crypto from 'crypto'
import { getConfig } from './aiService.js'
import db from '../db.js'

// ---------------------------------------------------------------------------
// Transactional email (Resend REST API — no SDK needed, one fetch per send).
//
// Config resolution (env wins, Admin → Settings fallback):
//   RESEND_API_KEY (env)  |  email.apiKey (settings)
//   EMAIL_FROM (env)      |  email.from     e.g. "Aisepadho <noreply@aisepadho.com>"
//
// Fail-open by design: a broken email provider must NEVER block a user flow
// (registration, password reset UI, payment activation). sendEmail() logs and
// returns null; callers fire-and-forget with .catch(() => {}).
//
// Supported flows:
//   sendVerificationEmail(user, tokenUrl)   soft-verify link (48h)
//   sendPasswordResetEmail(user, code)      6-digit code (15 min)
//   sendPaymentReceiptEmail(user, pay)      payment success + invoice number
//   sendInstituteCredentialsEmail(...)      sub-admin onboarding
// ---------------------------------------------------------------------------

export async function getEmailConfig() {
  const envKey = process.env.RESEND_API_KEY
  const envFrom = process.env.EMAIL_FROM
  if (envKey) {
    return { apiKey: envKey, from: envFrom || 'Aisepadho <onboarding@resend.dev>', source: 'env' }
  }
  const [apiKey, from] = await Promise.all([getConfig('email.apiKey'), getConfig('email.from')])
  return {
    apiKey: apiKey || '',
    from: from || 'Aisepadho <onboarding@resend.dev>',
    source: apiKey ? 'settings' : null
  }
}

export async function emailConfigured() {
  const c = await getEmailConfig()
  return Boolean(c.apiKey)
}

/** Low-level send. Returns Resend id or null (never throws). */
export async function sendEmail(to, subject, html) {
  try {
    const { apiKey, from } = await getEmailConfig()
    if (!apiKey) { console.log('[email] not configured — skip send to', to); return null }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [String(to)], subject, html })
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) { console.error('[email] send failed:', res.status, data.message || data); return null }
    return data.id || null
  } catch (e) {
    console.error('[email] send error:', e.message)
    return null
  }
}

// ---------------------------------------------------------------------------
// Branded template — single simple layout, styled inline (email clients strip
// classes). Dark-on-light, mobile-safe widths.
// ---------------------------------------------------------------------------
function wrap(title, bodyHtml, footerNote = '') {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#0f172a;border-radius:14px 14px 0 0;padding:18px 24px;">
      <span style="color:#fff;font-size:20px;font-weight:700;letter-spacing:.3px;">Aisepadho</span>
      <span style="color:#94a3b8;font-size:12px;margin-left:8px;">Padho. Test do. Aage badho.</span>
    </div>
    <div style="background:#ffffff;border-radius:0 0 14px 14px;padding:28px 24px;">
      <h2 style="margin:0 0 14px;font-size:19px;color:#0f172a;">${title}</h2>
      <div style="font-size:14px;line-height:1.65;color:#334155;">${bodyHtml}</div>
    </div>
    <p style="text-align:center;color:#94a3b8;font-size:11px;margin:14px 0 0;">
      ${footerNote || 'Agar aapne ye request nahi ki thi, is email ko ignore kar dein.'}
    </p>
  </div>
</body></html>`
}

// ---------------------------------------------------------------------------
// Token helpers (same hash-at-rest pattern as B2/API keys)
// ---------------------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')

export async function createEmailToken(userId, purpose, { ttlMs = 48 * 3600 * 1000 } = {}) {
  const raw = purpose === 'password_reset'
    ? String(crypto.randomInt(100000, 999999)) // 6-digit code for easy typing
    : crypto.randomBytes(24).toString('hex')   // long link token for verify
  const expiresAt = new Date(Date.now() + ttlMs).toISOString()
  // Invalidate previous unused tokens of the same purpose (latest wins)
  await db.prepare(`UPDATE email_tokens SET used_at = now() WHERE user_id = ? AND purpose = ? AND used_at IS NULL`).run(userId, purpose)
  await db.prepare(`INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES (?,?,?,?)`)
    .run(userId, purpose, sha256(raw), expiresAt)
  return raw
}

export async function consumeEmailToken(userId, purpose, raw) {
  const row = await db.prepare(
    `SELECT * FROM email_tokens WHERE user_id = ? AND purpose = ? AND token_hash = ? AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`
  ).get(userId, purpose, sha256(String(raw || '')))
  if (!row) return false
  await db.prepare(`UPDATE email_tokens SET used_at = now() WHERE id = ?`).run(row.id)
  return true
}

/** Resolve a user by email WITHOUT leaking whether the account exists. */
async function userByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').toLowerCase())
}

// ---------------------------------------------------------------------------
// Flow 1 — email verification (soft; link valid 48h)
// ---------------------------------------------------------------------------
export async function sendVerificationEmail(user, baseUrl) {
  const raw = await createEmailToken(user.id, 'verify')
  const link = `${baseUrl}/verify-email?token=${raw}&uid=${user.id}`
  return sendEmail(user.email, 'Verify your Aisepadho email', wrap(
    'Email verify karo 🎓',
    `<p>Namaste <b>${escapeHtml(user.name)}</b>, welcome to Aisepadho!</p>
     <p>Apna email verify karne ke liye niche button dabao (48 ghante valid):</p>
     <p style="text-align:center;margin:22px 0;"><a href="${link}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 28px;border-radius:10px;font-weight:600;display:inline-block;">Verify Email</a></p>
     <p style="color:#64748b;font-size:12px;">Ya ye link browser me kholo:<br><a href="${link}" style="color:#2563eb;word-break:break-all;">${link}</a></p>`
  ))
}

// ---------------------------------------------------------------------------
// Flow 2 — password reset (6-digit code, 15 min, single-use)
// ---------------------------------------------------------------------------
export async function sendPasswordResetEmail(user) {
  const code = await createEmailToken(user.id, 'password_reset', { ttlMs: 15 * 60 * 1000 })
  return sendEmail(user.email, 'Aisepadho password reset code', wrap(
    'Password reset code',
    `<p>Namaste <b>${escapeHtml(user.name)}</b>,</p>
     <p>Aapke password reset ka code (15 minute valid):</p>
     <div style="text-align:center;margin:20px 0;"><span style="font-size:32px;letter-spacing:8px;font-weight:700;color:#0f172a;background:#f1f5f9;padding:12px 22px;border-radius:12px;display:inline-block;">${code}</span></div>
     <p style="color:#64748b;font-size:13px;">Ye code sirf ek baar use hota hai. Agar aapne ye request nahi ki, apna password badalne ki zaroorat nahi — account safe hai.</p>`,
    'Code kisi ke saath share na karein — Aisepadho team kabhi code nahi maangti.'
  ))
}

// ---------------------------------------------------------------------------
// Flow 3 — payment receipt + invoice number
// ---------------------------------------------------------------------------
export function inr(amount, currency = 'INR') {
  const n = Number(amount) || 0
  return currency === 'INR' ? `₹${n.toLocaleString('en-IN')}` : `${currency} ${n}`
}

export async function sendPaymentReceiptEmail(user, pay) {
  return sendEmail(user.email, `Payment received — ${inr(pay.amount)} · ${pay.invoice_no || ''}`, wrap(
    'Payment received ✅',
    `<p>Namaste <b>${escapeHtml(user.name)}</b>, aapka payment receive ho gaya. Plan activate ho chuka hai!</p>
     <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
       <tr><td style="padding:7px 0;color:#64748b;">Invoice</td><td style="text-align:right;font-weight:600;">${pay.invoice_no}</td></tr>
       <tr><td style="padding:7px 0;color:#64748b;">Plan</td><td style="text-align:right;font-weight:600;">${escapeHtml(String(pay.plan))}</td></tr>
       <tr><td style="padding:7px 0;color:#64748b;">Amount</td><td style="text-align:right;font-weight:700;">${inr(pay.amount, pay.currency)}</td></tr>
       <tr><td style="padding:7px 0;color:#64748b;">Payment ID</td><td style="text-align:right;">${escapeHtml(String(pay.provider_ref || pay.txn_ref || pay.id))}</td></tr>
       <tr><td style="padding:7px 0;color:#64748b;">Date</td><td style="text-align:right;">${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</td></tr>
     </table>
     <p style="text-align:center;margin:20px 0;"><a href="${process.env.FRONTEND_URL || 'https://www.aisepadho.com'}/payments" style="background:#2563eb;color:#fff;text-decoration:none;padding:11px 26px;border-radius:10px;font-weight:600;display:inline-block;">Invoice dekho</a></p>
     <p style="color:#64748b;font-size:12px;">Ye ek computer-generated receipt hai — invoice Payments page par print/PDF-ready format me bhi milta hai.</p>`
  ))
}

// ---------------------------------------------------------------------------
// Flow 4 — institute sub-admin credentials (used by Admin → Institutes create)
// ---------------------------------------------------------------------------
export async function sendInstituteCredentialsEmail(email, instituteName, loginUrl, tempPassword) {
  return sendEmail(email, `Aapka ${instituteName} admin panel ready hai`, wrap(
    'Admin panel ready 🎉',
    `<p>Aapka institute admin panel taiyar hai. Login details:</p>
     <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
       <tr><td style="padding:7px 0;color:#64748b;">Login URL</td><td style="text-align:right;"><a href="${loginUrl}" style="color:#2563eb;word-break:break-all;">${loginUrl}</a></td></tr>
       <tr><td style="padding:7px 0;color:#64748b;">Email</td><td style="text-align:right;font-weight:600;">${escapeHtml(email)}</td></tr>
       <tr><td style="padding:7px 0;color:#64748b;">Password</td><td style="text-align:right;font-weight:700;">${escapeHtml(tempPassword)}</td></tr>
     </table>
     <p style="color:#64748b;font-size:13px;">Pehle login ke baad password zaroor badal dein (Profile page se).</p>`
  ))
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
