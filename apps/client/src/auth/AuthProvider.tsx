import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { AuthUser } from '@excuse/shared'
import { AuthContext, type AuthContextValue } from './AuthContext'
import {
  setAuthToken,
  getAuthToken,
  loginRequest,
  registerRequest,
  fetchCurrentUser,
} from '../api/client'

interface AuthProviderProps {
  children: ReactNode
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const navigate = useNavigate()

  // 挂载时：从 localStorage 恢复 token 并验证
  useEffect(() => {
    const token = getAuthToken()
    if (!token) {
      setIsLoading(false)
      return
    }

    fetchCurrentUser()
      .then((res) => {
        if (res.success && res.user) {
          setUser(res.user)
        } else {
          // token 无效，清除
          setAuthToken(null)
        }
      })
      .catch(() => {
        setAuthToken(null)
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

  const logout = useCallback(() => {
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
