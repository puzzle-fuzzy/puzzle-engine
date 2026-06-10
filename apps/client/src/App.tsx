import { Route, Routes } from 'react-router'
import Layout from './pages/Layout'
import Workspace from './pages/Workspace'
import Assets from './pages/Assets'
import Billing from './pages/Billing'

function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Workspace />} />
        <Route path="/assets" element={<Assets />} />
        <Route path="/billing" element={<Billing />} />
      </Route>
    </Routes>
  )
}

export default App
