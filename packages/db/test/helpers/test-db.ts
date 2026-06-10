/**
 * 真实测试数据库基础设施
 *
 * - 连接到 Docker PostgreSQL 上的 excuse_test 数据库
 * - 运行 drizzle migrations 建表
 * - 每个测试包在事务中执行，测完自动 ROLLBACK，互不干扰
 * - 自动 seed 一个测试 account（generation_records / uploaded_files 的 FK 依赖）
 *
 * 技术方案：
 * 1. 用 max: 1 的 postgres.js 连接池，确保所有查询走同一连接
 * 2. beforeEach: 执行 BEGIN，注入 drizzle 实例到 setDb()
 * 3. afterEach: 执行 ROLLBACK
 *
 * 不用 drizzle 的 db.transaction()（它自动 commit/rollback），
 * 而是直接用底层 SQL 控制 BEGIN/ROLLBACK，让测试完全掌控事务生命周期。
 */

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import postgres from 'postgres'
import * as schema from '../../src/schema'
import { setDb } from '../../src/db'

import { resolve } from 'node:path'

const TEST_DATABASE_URL = 'postgres://excuse:excuse_dev@localhost:5433/excuse_test'
const MIGRATIONS_FOLDER = resolve(import.meta.dir, '../../drizzle')

/** 单连接 drizzle 实例（max: 1 保证 BEGIN/ROLLBACK 作用域正确） */
let db: PostgresJsDatabase<typeof schema>

/**
 * beforeAll 调用：连接测试库并运行迁移
 */
export async function initTestDb() {
  // max: 1 = 只有一个连接，BEGIN/ROLLBACK 一定在同一连接上
  const client = postgres(TEST_DATABASE_URL, { max: 1 })
  db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}

/**
 * afterAll 调用：关闭连接
 */
export async function teardownTestDb() {
  // db 内部的 client 通过 drizzle 的 $client 访问
  const client = (db as any).$client
  if (client && typeof client.end === 'function') {
    await client.end()
  }
}

/**
 * beforeEach 调用：开启事务 + seed 测试 account + 注入 setDb()
 *
 * @returns accountId — 可直接用作 generation_records / uploaded_files 的 FK
 */
export async function beginTestTransaction(): Promise<{ accountId: string }> {
  await db.execute('BEGIN')

  // 注入到 repo 层
  setDb(db as any)

  // Seed 测试 account（在事务内，ROLLBACK 时一起清理）
  const [account] = await db
    .insert(schema.accounts)
    .values({
      username: `test_${crypto.randomUUID().slice(0, 8)}`,
      email: `test_${crypto.randomUUID().slice(0, 8)}@example.com`,
      password: 'hashed_password',
    })
    .returning()

  return { accountId: account!.id }
}

/**
 * afterEach 调用：回滚事务
 */
export async function rollbackTestTransaction() {
  await db.execute('ROLLBACK')
}
