import { Bell, FolderOpen, LayoutDashboard, LogOut, Map, Receipt } from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink } from 'react-router'
import { api } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { Button } from './ui/button'

const NAV_ITEMS = [
  { to: '/', label: '工作台', icon: LayoutDashboard },
  { to: '/canvas', label: '画布', icon: Map },
  { to: '/assets', label: '资产', icon: FolderOpen },
  { to: '/billing', label: '计费', icon: Receipt },
] as const

export default function Navbar() {
  const { user, logout } = useAuth()
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    if (!user)
      return
    api.api.notifications.unread.get()
      .then((res) => {
        const data = res.data as { success?: boolean, count?: number } | undefined
        if (data?.success) {
          setUnreadCount(data.count ?? 0)
        }
      })
      .catch(() => {})
  }, [user])

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/80 backdrop-blur-sm">
      <div className="mx-auto flex h-14 max-w-7xl items-center px-4">
        <span className="mr-6 text-lg font-bold tracking-tight">Excuse</span>
        <nav className="flex items-center gap-1">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
                }`}
            >
              <Icon className="size-4" />
              {label}
            </NavLink>
          ))}
        </nav>

        {/* 右侧用户区域 */}
        {user && (
          <div className="ml-auto flex items-center gap-3">
            <div className="relative">
              <Button variant="ghost" size="icon" title="通知">
                <Bell className="size-4" />
              </Button>
              {unreadCount > 0 && (
                <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <span className="text-sm text-muted-foreground">{user.username}</span>
            <Button variant="ghost" size="icon" onClick={logout} title="退出登录">
              <LogOut className="size-4" />
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
