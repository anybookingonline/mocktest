import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './components/ui.jsx'
import { Splash } from './pages/auth/AuthPages.jsx'

import Landing from './pages/Landing.jsx'
import { LoginPage, RegisterPage } from './pages/auth/AuthPages.jsx'
import Dashboard from './pages/student/Dashboard.jsx'
import Practice from './pages/student/Practice.jsx'
import Tests from './pages/student/Tests.jsx'
import TestSession from './pages/student/TestSession.jsx'
import Results from './pages/student/Results.jsx'
import Adaptive from './pages/student/Adaptive.jsx'
import Doubts from './pages/student/Doubts.jsx'
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

function Protected({ children, admin = false }) {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Navigate to="/login" replace />
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />
  return children
}

function Root() {
  const { user, loading } = useAuth()
  if (loading) return <Splash />
  if (!user) return <Landing />
  return user.role === 'admin' ? <Navigate to="/admin" replace /> : <Dashboard />
}

export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/" element={<Root />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />

        <Route path="/dashboard" element={<Protected><Dashboard /></Protected>} />
        <Route path="/practice" element={<Protected><Practice /></Protected>} />
        <Route path="/tests" element={<Protected><Tests /></Protected>} />
        <Route path="/tests/:id/session" element={<Protected><TestSession /></Protected>} />
        <Route path="/results/:id" element={<Protected><Results /></Protected>} />
        <Route path="/adaptive" element={<Protected><Adaptive /></Protected>} />
        <Route path="/doubts" element={<Protected><Doubts /></Protected>} />
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
        <Route path="/admin/settings" element={<Protected admin><AdminSettings /></Protected>} />
        <Route path="/admin/payments" element={<Protected admin><AdminPayments /></Protected>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  )
}
