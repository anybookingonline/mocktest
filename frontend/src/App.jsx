import React, { useState, useEffect } from 'react'
import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './components/ui.jsx'
import { Splash } from './pages/auth/AuthPages.jsx'
import CookieConsent from './components/CookieConsent.jsx'

import Landing from './pages/Landing.jsx'
import Schools from './pages/Schools.jsx'
import Legal from './pages/Legal.jsx'
import ParentReport from './pages/ParentReport.jsx'
import MaintenancePage from './components/MaintenancePage.jsx'
import { LoginPage, RegisterPage, ForgotPasswordPage, ResetPasswordPage, VerifyEmailPage } from './pages/auth/AuthPages.jsx'
import Dashboard from './pages/student/Dashboard.jsx'
import Practice from './pages/student/Practice.jsx'
import Tests from './pages/student/Tests.jsx'
import TestSession from './pages/student/TestSession.jsx'
import Results from './pages/student/Results.jsx'
import Adaptive from './pages/student/Adaptive.jsx'
import Doubts from './pages/student/Doubts.jsx'
import Groups from './pages/student/Groups.jsx'
import FocusAreas from './pages/student/FocusAreas.jsx'
import CurrentAffairs from './pages/student/CurrentAffairs.jsx'
import Revision from './pages/student/Revision.jsx'
import Battles from './pages/student/Battles.jsx'
import Bookmarks from './pages/student/Bookmarks.jsx'
import History from './pages/student/History.jsx'
import Retention from './pages/student/Retention.jsx'
import Rankings from './pages/student/Rankings.jsx'
import Analytics from './pages/student/Analytics.jsx'

import AdminDashboard from './pages/admin/Dashboard.jsx'
import AdminExams from './pages/admin/Exams.jsx'
import AdminSyllabus from './pages/admin/Syllabus.jsx'
import AdminQuestions from './pages/admin/QuestionBank.jsx'
import AdminImport from './pages/admin/PdfImport.jsx'
import AdminAI from './pages/admin/AIConfig.jsx'
import AdminUsers from './pages/admin/Users.jsx'
import AdminReports from './pages/admin/Reports.jsx'
import AdminSettings from './pages/admin/Settings.jsx'
import AdminPayments from './pages/admin/Payments.jsx'
import AdminAddons from './pages/admin/AdminAddons.jsx'
import AdminCoupons from './pages/admin/Coupons.jsx'
import AdminMarketing from './pages/admin/Marketing.jsx'
import AdminInstitutes from './pages/admin/Institutes.jsx'
import InstituteDashboard from './pages/admin/InstituteDashboard.jsx'
import AdminVisitors from './pages/admin/Visitors.jsx'

function Protected({ children, admin = false }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

// Maintenance mode: poll the public status endpoint every 30s. When the
// admin flips the toggle, every non-admin surface swaps to the maintenance
// landing page within one poll cycle — no redeploy needed. Admins keep the
// full app so they can verify their work mid-maintenance.
function MaintenanceGate({ children }) {
  const { user, loading } = useAuth()
  const [on, setOn] = useState(false)
  const isAdmin = !!user && user.role === 'admin'

  useEffect(() => {
    let live = true
    const check = () =>
      fetch('/api/meta/status', { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => { if (live) setOn(!!d.enabled) })
        .catch(() => {})
    check()
    const iv = setInterval(check, 30000)
    return () => { live = false; clearInterval(iv) }
  }, [])

  if (loading) return <Splash />
  if (on && !isAdmin) return <MaintenancePage />
  return children
}

function Root() {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Landing />
  return user.role === 'admin' ? <Navigate to="/admin" replace /> : <Dashboard />
}

// First-party visitor beacon: pings /api/analytics/track on every route
// change. Cookie-free — a random visitor id lives in localStorage and a
// session id in sessionStorage; the server dedupes 30 min per session+path,
// so refresh storms never inflate counts. Admin pages are skipped: the
// owner's own traffic shouldn't pollute marketing analytics.
function VisitorBeacon() {
  const { pathname } = useLocation()
  useEffect(() => {
    try {
      if (pathname.startsWith('/admin')) return
      let vid = localStorage.getItem('examai_vid')
      if (!vid) {
        vid = (crypto?.randomUUID ? crypto.randomUUID() : 'v-' + Math.random().toString(36).slice(2) + Date.now().toString(36))
        localStorage.setItem('examai_vid', vid)
      }
      let sid = sessionStorage.getItem('examai_sid')
      if (!sid) {
        sid = 's-' + Math.random().toString(36).slice(2) + Date.now().toString(36)
        sessionStorage.setItem('examai_sid', sid)
      }
      fetch('/api/analytics/track', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ visitorId: vid, sessionId: sid, path: pathname }),
        keepalive: true
      }).catch(() => {})
    } catch { /* tracking is best-effort, never blocks the page */ }
  }, [pathname])
  return null
}

export default function App() {
  return (
    <ToastProvider>
      <CookieConsent />
      <VisitorBeacon />
      <MaintenanceGate>
        <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/schools" element={<Schools />} />
        <Route path="/privacy-policy" element={<Legal doc="privacy" />} />
        <Route path="/terms-of-use" element={<Legal doc="terms" />} />
        <Route path="/refund-policy" element={<Legal doc="refund" />} />
        <Route path="/cookie-policy" element={<Legal doc="cookies" />} />
        <Route path="/report/:token" element={<ParentReport />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
        <Route path="/verify-email" element={<VerifyEmailPage />} />

        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
        <Route path="/practice" element={<Protected><Practice /></Protected>} />
        <Route path="/tests" element={<Protected><Tests /></Protected>} />
        <Route path="/tests/:id/session" element={<Protected><TestSession /></Protected>} />
        <Route path="/results/:id" element={<Protected><Results /></Protected>} />
        <Route path="/adaptive" element={<Protected><Adaptive /></Protected>} />
        <Route path="/doubts" element={<Protected><Doubts /></Protected>} />
        <Route path="/groups" element={<Protected><Groups /></Protected>} />
        <Route path="/focus" element={<Protected><FocusAreas /></Protected>} />
        <Route path="/current-affairs" element={<Protected><CurrentAffairs /></Protected>} />
        <Route path="/revision" element={<Protected><Revision /></Protected>} />
        <Route path="/battles" element={<Protected><Battles /></Protected>} />
        <Route path="/bookmarks" element={<Protected><Bookmarks /></Protected>} />
        <Route path="/history" element={<Protected><History /></Protected>} />
        <Route path="/retention" element={<Protected><Retention /></Protected>} />
        <Route path="/rankings" element={<Protected><Rankings /></Protected>} />
        <Route path="/analytics" element={<Protected><Analytics /></Protected>} />

        <Route path="/admin" element={<Protected admin><AdminDashboard /></Protected>} />
        <Route path="/admin/exams" element={<Protected admin><AdminExams /></Protected>} />
        <Route path="/admin/syllabus" element={<Protected admin><AdminSyllabus /></Protected>} />
        <Route path="/admin/questions" element={<Protected admin><AdminQuestions /></Protected>} />
        <Route path="/admin/import" element={<Protected admin><AdminImport /></Protected>} />
        <Route path="/admin/ai" element={<Protected admin><AdminAI /></Protected>} />
        <Route path="/admin/users" element={<Protected admin><AdminUsers /></Protected>} />
        <Route path="/admin/reports" element={<Protected admin><AdminReports /></Protected>} />
        <Route path="/admin/visitors" element={<Protected admin><AdminVisitors /></Protected>} />
        <Route path="/admin/settings" element={<Protected admin><AdminSettings /></Protected>} />
        <Route path="/admin/payments" element={<Protected admin><AdminPayments /></Protected>} />
        <Route path="/admin/addons" element={<Protected admin><AdminAddons /></Protected>} />
        <Route path="/admin/coupons" element={<Protected admin><AdminCoupons /></Protected>} />
        <Route path="/admin/marketing" element={<Protected admin><AdminMarketing /></Protected>} />
        <Route path="/admin/institutes" element={<Protected admin><AdminInstitutes /></Protected>} />
        <Route path="/admin/institute" element={<Protected admin><InstituteDashboard /></Protected>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </MaintenanceGate>
    </ToastProvider>
  )
}
