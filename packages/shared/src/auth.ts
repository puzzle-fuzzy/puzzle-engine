import type { AccountRow, Serialize } from '@excuse/db'

/**
 * API 返回的用户信息类型（password 已剥离，Date → string）
 */
export type AuthUser = Omit<Serialize<AccountRow>, 'password'>

/**
 * 认证接口统一响应格式
 */
export interface AuthResponse {
  success: boolean
  token?: string
  user?: AuthUser
  error?: string
}
