import { Route, Routes } from 'react-router'
import Layout from './pages/Layout'
import Workspace from './pages/Workspace'
import Assets from './pages/Assets'
import Billing from './pages/Billing'
import Login from './pages/Login'
import Register from './pages/Register'
import { ProtectedRoute } from './auth/ProtectedRoute'

function App() {
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
