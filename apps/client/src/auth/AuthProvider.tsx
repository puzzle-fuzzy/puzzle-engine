import type { AuthUser } from '@excuse/shared'
import type { ReactNode } from 'react'
import type { AuthContextValue } from './AuthContext'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import {
  fetchCurrentUser,
  loginRequest,
  logoutRequest,
  registerRequest,
  setAuthToken,
} from '../api/client'
import { AuthContext } from './AuthContext'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  // 挂载时：通过 httpOnly cookie 自动认证（无需 localStorage）
  useEffect(() => {
    fetchCurrentUser()
      .then((res) => {
        if (res.success && res.user) {
          setUser(res.user)
        }
      })
      .catch(() => {
        // cookie 无效或过期 — 未登录状态
      })
      .finally(() => {
        setIsLoading(false)
      })
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginRequest(email, password)
    if (!res.success || !res.token || !res.user) {
      throw new Error(res.error || '登录失败')
    }
    setAuthToken(res.token)
    setUser(res.user)
  }, [])

  const register = useCallback(async (username: string, email: string, password: string) => {
    const res = await registerRequest(username, email, password)
    if (!res.success || !res.token || !res.user) {
      throw new Error(res.error || '注册失败')
    }
    setAuthToken(res.token)
    setUser(res.user)
  }, [])

  const logout = useCallback(async () => {
    try {
      await logoutRequest()
    }
    catch {
      // 服务端清除失败不阻塞本地登出
    }
    setAuthToken(null)
    setUser(null)
    navigate('/login')
  }, [navigate])

  const value: AuthContextValue = {
    user,
    isLoading,
    login,
    register,
    logout,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
