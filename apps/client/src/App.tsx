import { useEffect } from 'react'
import { Route, Routes } from 'react-router'
import { getAuthToken } from './api/client'
import { sseClient } from './api/sse'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { ErrorBoundary } from './components/ui/error-boundary'
import { Toaster } from './components/ui/sonner'
import Assets from './pages/Assets'
import Billing from './pages/Billing'
import Canvas from './pages/Canvas'
import CanvasEditor from './pages/CanvasEditor'
import Layout from './pages/Layout'
import Login from './pages/Login'
import Register from './pages/Register'
import Workspace from './pages/Workspace'

function App() {
  useEffect(() => {
    if (getAuthToken()) {
      sseClient.connect()
    }
    return () => sseClient.disconnect()
  }, [])

  return (
    <>
      <Toaster richColors position="top-center" />
      <ErrorBoundary>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<Layout />}>
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Workspace />} />
              <Route path="/canvas" element={<Canvas />} />
              <Route path="/canvas/:projectId" element={<CanvasEditor />} />
              <Route path="/assets" element={<Assets />} />
              <Route path="/billing" element={<Billing />} />
            </Route>
          </Route>
        </Routes>
      </ErrorBoundary>
    </>
  )
}

export default App
