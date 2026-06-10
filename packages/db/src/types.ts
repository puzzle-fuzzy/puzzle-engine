import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'
import type { accounts, generationRecords, uploadedFiles, generationCategoryEnum, generationStatusEnum } from './schema'

// ===== Drizzle 行类型（从 schema 自动推导） =====

/** accounts 表 — 查询结果行类型 */
export type AccountRow = InferSelectModel<typeof accounts>

/** accounts 表 — 插入参数类型 */
export type AccountInsert = InferInsertModel<typeof accounts>

/** generation_records 表 — 查询结果行类型 */
export type GenerationRecordRow = InferSelectModel<typeof generationRecords>

/** generation_records 表 — 插入参数类型 */
export type GenerationRecordInsert = InferInsertModel<typeof generationRecords>

/** uploaded_files 表 — 查询结果行类型 */
export type UploadedFileRow = InferSelectModel<typeof uploadedFiles>

/** uploaded_files 表 — 插入参数类型 */
export type UploadedFileInsert = InferInsertModel<typeof uploadedFiles>

// ===== 枚举类型（从 pgEnum 定义推断） =====

/** 生成内容类别：从 pgEnum 定义推断 */
export type GenerationCategory = typeof generationCategoryEnum.enumValues extends (infer T)[] ? T : never

/** 生成任务状态：从 pgEnum 定义推断 */
export type GenerationStatus = typeof generationStatusEnum.enumValues extends (infer T)[] ? T : never

// ===== 序列化工具类型 =====

/**
 * JSON 序列化工具类型
 * 将 Drizzle 行类型中的 Date 转为 string，模拟 HTTP JSON 传输后的实际类型
 */
export type Serialize<T> = T extends Date
  ? string
  : T extends null
    ? null
    : T extends (infer U)[]
      ? Serialize<U>[]
      : T extends object
        ? { -readonly [K in keyof T]: Serialize<T[K]> }
        : T

/** generation_records 序列化后类型（Date → string） */
export type GenerationRecordSerialized = Serialize<GenerationRecordRow>

/** uploaded_files 序列化后类型（Date → string） */
export type UploadedFileSerialized = Serialize<UploadedFileRow>

// ===== 查询过滤条件 =====

/** 生成记录列表查询过滤条件 */
export interface ListGenerationRecordsFilter {
  category?: GenerationCategory
  status?: GenerationStatus
  limit?: number
  offset?: number
}
