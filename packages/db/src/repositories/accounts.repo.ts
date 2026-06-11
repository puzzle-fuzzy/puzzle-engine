import type { AccountInsert } from '../types'
import { eq } from 'drizzle-orm'
import { getDb } from '../db'
import { accounts } from '../schema'

/**
 * 根据邮箱查询账户
 */
export async function getAccountByEmail(email: string) {
  const [record] = await getDb()
    .select()
    .from(accounts)
    .where(eq(accounts.email, email))
    .limit(1)
  return record ?? null
}

/**
 * 根据用户名查询账户
 */
export async function getAccountByUsername(username: string) {
  const [record] = await getDb()
    .select()
    .from(accounts)
    .where(eq(accounts.username, username))
    .limit(1)
  return record ?? null
}

/**
 * 根据 ID 查询账户
 */
export async function getAccountById(id: string) {
  const [record] = await getDb()
    .select()
    .from(accounts)
    .where(eq(accounts.id, id))
    .limit(1)
  return record ?? null
}

/**
 * 创建新账户
 */
export async function createAccount(values: AccountInsert) {
  const [record] = await getDb().insert(accounts).values(values).returning()
  return record!
}
