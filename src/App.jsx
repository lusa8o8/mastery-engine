import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import AuthPage from './pages/AuthPage'
import HomePage from './pages/HomePage'
import UploadPage from './pages/UploadPage'
import VaultPage from './pages/VaultPage'
import EnginePage from './pages/EnginePage'
import SummaryPage from './pages/SummaryPage'
import ProgressPage from './pages/ProgressPage'
import PatternsPage from './pages/PatternsPage'
import SimulatePage from './pages/SimulatePage'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return null
  if (!user) return <Navigate to="/auth" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/home" element={<ProtectedRoute><HomePage /></ProtectedRoute>} />
        <Route path="/upload" element={<ProtectedRoute><UploadPage /></ProtectedRoute>} />
        <Route path="/vault" element={<ProtectedRoute><VaultPage /></ProtectedRoute>} />
        <Route path="/patterns" element={<ProtectedRoute><PatternsPage /></ProtectedRoute>} />
        <Route path="/simulate" element={<ProtectedRoute><SimulatePage /></ProtectedRoute>} />
        <Route path="/engine/:topic" element={<ProtectedRoute><EnginePage /></ProtectedRoute>} />
        <Route path="/summary" element={<ProtectedRoute><SummaryPage /></ProtectedRoute>} />
        <Route path="/progress" element={<ProtectedRoute><ProgressPage /></ProtectedRoute>} />
        <Route path="*" element={<Navigate to="/auth" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
