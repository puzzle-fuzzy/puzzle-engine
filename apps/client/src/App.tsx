import { useEffect } from 'react'
import { Route, Routes } from 'react-router'
import Layout from './pages/Layout'
import Workspace from './pages/Workspace'
import Assets from './pages/Assets'
import Billing from './pages/Billing'
import Login from './pages/Login'
import Register from './pages/Register'
import { ProtectedRoute } from './auth/ProtectedRoute'
import { sseClient } from './api/sse'
import { getAuthToken } from './api/client'

function App() {
  // 应用级 SSE 连接管理：已登录时自动连接，卸载时断开
  useEffect(() => {
    if (getAuthToken()) {
      sseClient.connect()
    }
    return () => sseClient.disconnect()
  }, [])

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route element={<Layout />}>
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Workspace />} />
          <Route path="/assets" element={<Assets />} />
          <Route path="/billing" element={<Billing />} />
        </Route>
      </Route>
    </Routes>
  )
}

export default App
