import { Link, Outlet } from 'react-router'

function Layout() {
  return (
    <div className="layout">
      <nav className="navbar">
        <Link to="/" className="navbar-brand">Excuse</Link>
        <div className="navbar-links">
          <Link to="/">首页</Link>
        </div>
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  )
}

export default Layout
