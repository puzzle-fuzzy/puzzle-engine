// 原始客户端（供 LISTEN/NOTIFY 使用）
export { pgClient } from './db'

// Domain 类型（纯接口，供 schema $type() 和 @excuse/shared import type）
export * from './domain-types'

// PostgreSQL NOTIFY 工具
export * from './notify'

// Repository 函数（推荐的数据访问方式）
export * from './repositories'

// Schema（drizzle-kit 迁移工具需要）
export * from './schema'

// 类型
export * from './types'
