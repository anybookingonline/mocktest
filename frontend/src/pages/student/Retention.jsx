import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useLocation, useNavigate } from 'react-router-dom'
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
  const location = useLocation()
  const navigate = useNavigate()

  // ?buyGroup=<id> deep-link from the Groups page: opens the group plan buy flow
  const buyGroupId = new URLSearchParams(location.search).get('buyGroup')
  const boughtRef = useRef(null)
  useEffect(() => {
    if (!buyGroupId || !gateway || busy) return
    if (boughtRef.current === buyGroupId) return
    boughtRef.current = buyGroupId
    navigate('/retention', { replace: true })
    buy(`group_discussions:${buyGroupId}`)
  }, [buyGroupId, gateway])

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
        .then((r) => { toast(r.active ? 'Payment verified — activated!' : `Payment ${r.status || 'pending'} — will activate once confirmed.`, r.active ? 'ok' : 'err'); reload() })
        .catch((e) => toast('Verification failed: ' + e.message, 'err'))
      return
    }
    if (paid === 'success') { toast('Payment successful — activated!', 'ok'); reload() }
  }, [params])

  const gateways = useMemo(() => plans?.gateways || [], [plans])
  const currencySymbol = (c) => (c === 'INR' ? '₹' : c === 'USD' ? '$' : c + ' ')
  const hasAddon = (id) => (status?.addons || []).some((a) => a.id === id)
  const active = status?.active

  const loadRazorpay = () => new Promise((resolve, reject) => {
    if (window.Razorpay) return resolve()
    const s = document.createElement('script')
    s.src = 'https://checkout.razorpay.com/v1/checkout.js'
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Could not load payment gateway'))
    document.body.appendChild(s)
  })

  const buy = async (planId) => {
    if (!gateway) return toast('Choose a payment method first', 'err')
    setBusy(true)
    setQrOrder(null)
    try {
      const d = await api.post('/payments/create-order', { plan: planId, gateway })
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
            toast('Payment verified — activated!', 'ok')
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

  const checkPhonePe = async (planId) => {
    setBusy(true)
    try {
      let orderId = sessionStorage.getItem('pp_order')
      if (!orderId) {
        const d = await api.post('/payments/create-order', { plan: planId, gateway: 'phonepe' })
        orderId = d.orderId
        sessionStorage.setItem('pp_order', orderId)
      }
      const r = await api.post('/payments/verify', { provider: 'phonepe', orderId })
      toast(r.active ? 'Payment verified — activated!' : 'Not paid yet — please complete the PhonePe payment.', r.active ? 'ok' : 'err')
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
      toast('Payment reported with proof. Admin will verify and activate your plan.', 'ok')
      setQrOrder(null)
      setTxnRef('')
      setPayerName('')
      setProofFile(null)
      reload()
    } catch (e) { toast(e.message, 'err') }
  }

  const GatewayPicker = () => (
    gateways.length > 1 && (
      <div className="row mb" style={{ flexWrap: 'wrap', justifyContent: 'center' }}>
        {gateways.map((g) => (
          <label key={g.id} className="chip" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, background: gateway === g.id ? 'var(--accent)' : '', color: gateway === g.id ? '#fff' : '' }}>
            <input type="radio" name="gw" checked={gateway === g.id} onChange={() => { setGateway(g.id); setQrOrder(null) }} />
            {g.label.replace(/[🟢💳📱🔳]/g, '').trim()}
          </label>
        ))}
      </div>
    )
  )

  const BuyButtons = ({ planId, active: owned }) => (
    !qrOrder && (
      <>
        <button className="btn btn-accent mt" style={{ width: '100%' }} onClick={() => buy(planId)} disabled={busy}>
          {busy ? 'Please wait…' : owned ? 'Renew / extend' : `Buy now`}
        </button>
        {gateway === 'phonepe' && (
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }} onClick={() => checkPhonePe(planId)} disabled={busy}>
            Already paid on PhonePe? Check status
          </button>
        )}
      </>
    )
  )

  const QrPanel = () => qrOrder && (
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
  )

  const plan = plans?.plans?.[0]
  const addons = plans?.addons || []

  return (
    <StudentLayout title="Plans & Add-ons">
      <div className="card mb spread">
        <div>
          <b>Your data, your power</b>
          <p className="tiny">Free accounts: your test history, results, doubts and bookmarks are auto-deleted after 24 hours, and AI features have daily caps. Get the plan that fits — one-time payments, no auto-renew.</p>
        </div>
        <Badge kind={active ? 'green' : 'red'}>{active ? 'Retention active' : 'Free plan'}</Badge>
      </div>

      {qrOrder && (
        <div className="card mb">
          <b className="small mb" style={{ display: 'block' }}>Complete your payment — {currencySymbol(qrOrder.currency)}{qrOrder.amount}</b>
          <QrPanel />
        </div>
      )}

      <div className="grid grid-3" style={{ alignItems: 'stretch' }}>
        {/* ------------------------------ Retention ------------------------------ */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="spread mb">
            <Badge kind="purple">🗄️ 1-Year Data Retention</Badge>
            {active && <Badge kind="green">active</Badge>}
          </div>
          <div style={{ fontSize: 38, fontWeight: 800 }}>{plan ? currencySymbol(plan.currency) + plan.price : '…'}</div>
          <p className="tiny muted">{plan ? `${plan.retentionDays || 365} days · one-time` : ''}</p>
          <ul className="mt small" style={{ textAlign: 'left', paddingLeft: 18, lineHeight: 1.9, flex: 1 }}>
            <li>Keep your test history & results</li>
            <li>Keep doubts & AI explanations</li>
            <li>Keep bookmarks & analytics</li>
            <li>🔥 AI Focus Areas + 🔁 AI Revision unlocked</li>
            <li>⚔️ Unlimited Quiz Battles</li>
          </ul>
          <GatewayPicker />
          {plan && <BuyButtons planId="retention_1y" active={active} />}
          {!active && (
            <p className="tiny muted mt">Data older than 24h auto-deletes on the free plan.</p>
          )}
        </div>

        {/* ------------------------------ Group plan ------------------------------ */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="spread mb">
            <Badge kind="green">👥 Group Plan</Badge>
            {active && <Badge kind="green">paid member</Badge>}
          </div>
          <div style={{ fontSize: 38, fontWeight: 800 }}>{plan ? currencySymbol(plan.currency) + plan.price : '…'}</div>
          <p className="tiny muted">Retention plan ke price par — data bhi, group chat bhi</p>
          <ul className="mt small" style={{ textAlign: 'left', paddingLeft: 18, lineHeight: 1.9, flex: 1 }}>
            <li>Puri data retention (jaise normal plan)</li>
            <li>Group Discussions chat — paid member seat</li>
            <li>2 paying members = 1 dost ka seat FREE</li>
          </ul>
          <GatewayPicker />
          <p className="tiny muted mt">
            {qrOrder ? 'Payment complete karo upar.' : 'Buy karne ke liye pehle payment method choose karo, phir Groups page → apna group kholo → "Group Plan le lo".'}
          </p>
          <Link to="/groups" className="btn btn-ghost btn-sm mt">👥 Groups page →</Link>
        </div>

        {/* ------------------------------ Add-ons ------------------------------ */}
        {addons.map((a) => {
          const owned = hasAddon(a.id)
          const until = (status?.addons || []).find((x) => x.id === a.id)?.until
          return (
            <div key={a.id} className="card" style={{ display: 'flex', flexDirection: 'column' }}>
              <div className="spread mb">
                <Badge kind="amber">{a.icon} {a.name}</Badge>
                {owned && <Badge kind="green">active</Badge>}
              </div>
              <div style={{ fontSize: 38, fontWeight: 800 }}>{currencySymbol(a.currency || 'INR')}{a.price}</div>
              <p className="tiny muted">{a.days} days · one-time add-on</p>
              <p className="small mt" style={{ flex: 1 }}>{a.description}</p>
              <ul className="tiny" style={{ textAlign: 'left', paddingLeft: 18, lineHeight: 1.8 }}>
                {(a.perks || []).map((p) => <li key={p}>{p}</li>)}
              </ul>
              <GatewayPicker />
              <BuyButtons planId={a.id} active={owned} />
              {owned && until && (
                <p className="tiny muted mt">Active until {new Date(until.replace(' ', 'T') + 'Z').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
              )}
            </div>
          )
        })}

        {/* ------------------------------ Add-on value notes ------------------------------ */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 30 }}>🧩</div>
          <b className="small mt mb" style={{ display: 'block' }}>Kya kaise unlock hota hai?</b>
          <p className="tiny muted" style={{ flex: 1 }}>
            Koi bhi paid plan ya add-on lene par AI Focus Areas automatically unlock ho jata hai. Current Affairs Pro alag add-on hai — sirf CA quiz ke liye. Plans aapke admin ke set kiye pricing par hain.
          </p>
          <Link to="/focus" className="btn btn-ghost btn-sm">🔥 Focus preview →</Link>
        </div>

        {/* ------------------------------ Why upgrade ------------------------------ */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: 30 }}>🎯</div>
          <b className="small mt mb" style={{ display: 'block' }}>Kya choose karun?</b>
          <p className="tiny muted" style={{ flex: 1 }}>
            {active ? 'Retention ho gaya hai — ab AI Power Pack lo agar aap roz AI mocks aur Telegram par unlimited doubts chahte ho.'
              : 'Pehle Data Retention lo (aapki mehnat ka data safe rahega), phir AI Power Pack unlimited AI ke liye.'}
          </p>
          <Link to="/doubts" className="btn btn-ghost btn-sm">Try the AI tutor →</Link>
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
