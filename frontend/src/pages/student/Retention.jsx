import React, { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { StudentLayout } from '../../components/Layout.jsx'
import { api } from '../../api/client.js'
import { Badge, useToast } from '../../components/ui.jsx'

export default function Retention() {
  const toast = useToast()
  const [params] = useSearchParams()
  const [plans, setPlans] = useState(null)
  const [status, setStatus] = useState(null)
  const [gateway, setGateway] = useState(null)
  const [busy, setBusy] = useState(false)
  const [qrOrder, setQrOrder] = useState(null)
  const [txnRef, setTxnRef] = useState('')
  const [payerName, setPayerName] = useState('')
  const [proofFile, setProofFile] = useState(null)

  const reload = () => {
    api.get('/payments/plans').then((d) => { setPlans(d); setGateway((g) => g || d.provider) }).catch(() => {})
    api.get('/payments/my').then(setStatus).catch(() => {})
  }

  useEffect(() => { reload() }, [])

  useEffect(() => {
    const paid = params.get('paid')
    const gw = params.get('gw')
    const txn = params.get('txn')
    if (paid === 'cancelled') { toast('Payment cancelled.', 'err'); return }
    if (paid === 'success' && gw === 'phonepe' && txn) {
      toast('Checking PhonePe payment status…', 'ok')
      api.post('/payments/verify', { provider: 'phonepe', orderId: txn })
        .then((r) => { toast(r.active ? 'Payment verified! Data held for 1 year.' : `Payment ${r.status || 'pending'} — will activate once confirmed.`, r.active ? 'ok' : 'err'); reload() })
        .catch((e) => toast('Verification failed: ' + e.message, 'err'))
      return
    }
    if (paid === 'success') { toast('Payment successful! Your data is now held for 1 year.', 'ok'); reload() }
  }, [params])

  const gateways = useMemo(() => plans?.gateways || [], [plans])
  const plan = plans?.plans?.[0]
  const active = status?.active
  const currencySymbol = (c) => (c === 'INR' ? '₹' : c === 'USD' ? '$' : c + ' ')

  const loadRazorpay = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve()
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load payment gateway'))
    document.body.appendChild(s)
  })

  const buy = async () => {
    if (!gateway) return toast('Choose a payment method first', 'err')
    setBusy(true)
    setQrOrder(null)
    try {
      const d = await api.post('/payments/create-order', { plan: 'retention_1y', gateway })
      if (d.provider === 'stripe' || d.provider === 'phonepe') {
        if (d.provider === 'phonepe') sessionStorage.setItem('pp_order', d.orderId)
        window.location.href = d.redirectUrl || d.checkoutUrl
        return
      }
      if (d.provider === 'qr') {
        setQrOrder(d)
        setBusy(false)
        return
      }
      await loadRazorpay()
      const rzp = new window.Razorpay({
        key: d.keyId,
        order_id: d.orderId,
        name: d.name,
        email: d.email,
        amount: d.amount * 100,
        currency: d.currency,
        prefill: { email: d.email, name: d.name },
        theme: { color: '#6366f1' },
        handler: async (res) => {
          try {
            await api.post('/payments/verify', {
              razorpay_order_id: res.razorpay_order_id,
              razorpay_payment_id: res.razorpay_payment_id,
              razorpay_signature: res.razorpay_signature
            })
            toast('Payment verified. Data held for 1 year.', 'ok')
            reload()
          } catch (e) { toast('Verification failed: ' + e.message, 'err') }
        },
        modal: { ondismiss: () => setBusy(false) }
      })
      rzp.open()
      setBusy(false)
    } catch (e) {
      toast(e.message, 'err')
      setBusy(false)
    }
  }

  const checkPhonePe = async () => {
    setBusy(true)
    try {
      let orderId = sessionStorage.getItem('pp_order')
      if (!orderId) {
        const d = await api.post('/payments/create-order', { plan: 'retention_1y', gateway: 'phonepe' })
        orderId = d.orderId
        sessionStorage.setItem('pp_order', orderId)
      }
      const r = await api.post('/payments/verify', { provider: 'phonepe', orderId })
      toast(r.active ? 'Payment verified! Data held for 1 year.' : 'Not paid yet — please complete the PhonePe payment.', r.active ? 'ok' : 'err')
      if (r.active) reload()
    } catch (e) { toast(e.message, 'err') }
    setBusy(false)
  }

  const confirmQr = async () => {
    if (!qrOrder) return
    if (!txnRef.trim()) return toast('Enter the transaction/UTR reference from your payment app', 'err')
    try {
      if (proofFile) {
        await api.upload('/payments/qr/proof', proofFile, { orderId: qrOrder.orderId, txnRef, payerName })
      } else {
        await api.post('/payments/qr/confirm', { orderId: qrOrder.orderId, txnRef, payerName })
      }
      toast('Payment reported with proof. Admin will verify and activate your retention.', 'ok')
      setQrOrder(null)
      setTxnRef('')
      setPayerName('')
      setProofFile(null)
      reload()
    } catch (e) { toast(e.message, 'err') }
  }

  return (
    <StudentLayout title="Data Retention">
      <div className="card mb spread">
        <div>
          <b>Your data, your choice</b>
          <p className="tiny">Free accounts: your test history, results, doubts and bookmarks are auto-deleted after 24 hours. Buy the 1-Year Data Retention plan to keep everything safe for a full year.</p>
        </div>
        <Badge kind={active ? 'green' : 'red'}>{active ? 'Active' : 'Free plan'}</Badge>
      </div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <div className="card">
          <b className="small mb" style={{ display: 'block' }}>Current status</b>
          {active ? (
            <div>
              <div className="metric" style={{ marginBottom: 10 }}>
                <div className="m-label">Data held until</div>
                <div className="m-value" style={{ color: 'var(--green)' }}>{status?.retainUntil ? new Date(status.retainUntil.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}</div>
              </div>
              <p className="tiny muted">Your test history and results are protected until this date. Renew to extend by another year.</p>
            </div>
          ) : (
            <div>
              <div className="metric" style={{ marginBottom: 10 }}>
                <div className="m-label">Free plan</div>
                <div className="m-value" style={{ color: 'var(--red)' }}>Data auto-deletes in 24h</div>
              </div>
              <p className="tiny muted">Attempts, results, doubts and bookmarks older than 24 hours are removed automatically. Upgrade to keep them.</p>
            </div>
          )}
        </div>

        <div className="card" style={{ textAlign: 'center' }}>
          {plan && (
            <>
              <Badge kind="purple">1-Year Data Retention</Badge>
              <div style={{ fontSize: 40, fontWeight: 800, margin: '14px 0 2px' }}>{currencySymbol(plan.currency)}{plan.price}</div>
              <p className="tiny muted">{plan.retentionDays} days · one-time payment</p>
              <ul className="mt small" style={{ textAlign: 'left', paddingLeft: 18, lineHeight: 1.9 }}>
                <li>Keep your test history & results</li>
                <li>Keep doubts & AI explanations</li>
                <li>Keep bookmarks & analytics</li>
              </ul>

              {gateways.length > 1 && (
                <div className="row mb" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
                  {gateways.map((g) => (
                    <label key={g.id} className="chip" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, background: gateway === g.id ? 'var(--accent)' : '', color: gateway === g.id ? '#fff' : '' }}>
                      <input type="radio" name="gw" checked={gateway === g.id} onChange={() => { setGateway(g.id); setQrOrder(null) }} />
                      {g.label.replace(/[🟢💳📱🔳]/g, '').trim()}
                    </label>
                  ))}
                </div>
              )}

              {!qrOrder && (
                <>
                  <button className="btn btn-accent mt" style={{ width: '100%' }} onClick={buy} disabled={busy}>
                    {busy ? 'Please wait…' : active ? 'Renew for another year' : `Upgrade — ${currencySymbol(plan.currency)}${plan.price}`}
                  </button>
                  {gateway === 'phonepe' && (
                    <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={checkPhonePe} disabled={busy}>
                      Already paid on PhonePe? Check status
                    </button>
                  )}
                </>
              )}

              {qrOrder && (
                <div className="mt">
                  <p className="tiny muted mb">Scan this QR with any UPI app (GPay / PhonePe / Paytm) and pay {currencySymbol(qrOrder.currency)}{qrOrder.amount}.</p>
                  {qrOrder.qr.qrImage ? (
                    <img src={qrOrder.qr.qrImage} alt="Payment QR" style={{ width: 220, height: 220, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 12 }} />
                  ) : qrOrder.qr.upiId ? (
                    <QrImage upiId={qrOrder.qr.upiId} holderName={qrOrder.qr.holderName} amount={qrOrder.amount} note={qrOrder.qr.note} />
                  ) : (
                    <p className="tiny muted">QR not configured by admin yet.</p>
                  )}
                  <p className="tiny mb" style={{ marginTop: 8 }}>{qrOrder.qr.holderName || ''} {qrOrder.qr.note}</p>
                  <div className="row" style={{ marginTop: 10 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Transaction / UTR ID" value={txnRef} onChange={(e) => setTxnRef(e.target.value)} />
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <input className="input" style={{ flex: 1 }} placeholder="Your name (as shown in UPI app)" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
                  </div>
                  <label className="field" style={{ marginTop: 10, textAlign: 'left' }}>
                    <span className="tiny muted">Payment screenshot (proof for admin) — optional but speeds up verification</span>
                    <input type="file" accept="image/*" className="input" onChange={(e) => setProofFile(e.target.files?.[0] || null)} />
                    {proofFile && <p className="tiny muted">Selected: {proofFile.name}</p>}
                  </label>
                  <button className="btn btn-accent" style={{ width: '100%', marginTop: 10 }} onClick={confirmQr}>I have paid — verify my payment</button>
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => { setQrOrder(null); setBusy(false) }}>Cancel</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </StudentLayout>
  )
}

function QrImage({ upiId, holderName, amount, note }) {
  const [dataUrl, setDataUrl] = useState('')
  const uri = useMemo(() => {
    const p = new URLSearchParams()
    p.set('pa', upiId)
    if (holderName) p.set('pn', holderName)
    if (amount) { p.set('am', String(amount)); p.set('cu', 'INR') }
    if (note) p.set('tn', note)
    return 'upi://pay?' + p.toString()
  }, [upiId, holderName, amount, note])

  useEffect(() => {
    QRCode.toDataURL(uri, { width: 220, margin: 1, errorCorrectionLevel: 'M' }).then(setDataUrl).catch(() => {})
  }, [uri])

  return dataUrl ? <img src={dataUrl} alt="UPI QR" style={{ width: 220, height: 220, borderRadius: 12 }} /> : <div className="spin" />
}
