// 原始客户端 + DB 连接工具（供 LISTEN/NOTIFY 和启动等待使用）
export { pgClient, waitForDb } from './db'

// Domain 类型（纯接口，供 schema $type() 和 @excuse/shared import type）
export * from './domain-types'

// PostgreSQL NOTIFY 工具
export * from './notify'

// Repository 函数（推荐的数据访问方式）
export * from './repositories'

// Schema（drizzle-kit 迁移工具需要）
export * from './schema'
// Services（业务级操作，跨多个 repository）
export { RETENTION_POLICY, runRetentionCleanup } from './services/retention'

export type { RetentionResult } from './services/retention'

// 类型
export * from './types'
