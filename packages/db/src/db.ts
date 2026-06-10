import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

const connectionString = process.env.DATABASE_URL || 'postgres://localhost:5432/excuse'

const client = postgres(connectionString)

// 内部实例 — 通过 getDb() 访问，不直接导出
let _db = drizzle(client, { schema })

/** 获取当前 db 实例 */
export function getDb() {
  return _db
}

/** 替换 db 实例（测试用） */
export function setDb(instance: typeof _db) {
  _db = instance
}
