import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL || 'postgres://excuse:excuse_dev@localhost:5433/excuse'

// 导出原始 postgres 客户端，供 LISTEN/NOTIFY 使用
export const pgClient = postgres(connectionString)

// 内部实例 — 通过 getDb() 访问，不直接导出
let _db = drizzle(pgClient, { schema })

/** 获取当前 db 实例 */
export function getDb() {
  return _db
}

/** 替换 db 实例（测试用） */
export function setDb(instance: typeof _db) {
  _db = instance
}
