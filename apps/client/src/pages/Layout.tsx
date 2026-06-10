import { Outlet } from 'react-router'
import Navbar from '@/components/Navbar'

function Layout() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main>
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
