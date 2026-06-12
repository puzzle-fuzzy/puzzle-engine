import type { Serialize, UploadedFileRow } from '@excuse/db'
import type { EntityResponse } from './api-response'

/**
 * API 返回的上传文件类型（Date → string）
 *
 * 与 GenerationRecord / AuthUser 保持一致：
 * DB row 的 Date 字段必须通过 .toISOString() 转为 string，
 * 不允许 Date 对象泄露到 API 响应中。
 */
export type UploadedFileDTO = Serialize<UploadedFileRow>

/** 上传文件接口响应格式 */
export type UploadResponse = EntityResponse<UploadedFileDTO>
