import type { AccountRow, Serialize } from '@excuse/db'
import type { EntityResponse } from './api-response'

/**
 * API 返回的用户信息类型（password 已剥离，Date → string）
 */
export type AuthUser = Omit<Serialize<AccountRow>, 'password'>

export interface AuthSession {
  token: string
  user: AuthUser
}

export type AuthResponse = EntityResponse<AuthSession>

export type AuthCurrentUserResponse = EntityResponse<AuthUser>
