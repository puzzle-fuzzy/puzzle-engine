/**
 * HTTP 错误响应工具 — 统一状态码 + 错误体格式
 *
 * Elysia 的 handler 通过 set.status 设置 HTTP 状态码。
 * 此工具封装常用错误场景，确保全路由使用一致的错误格式。
 *
 * 错误体格式: { success: false, error: string }
 * 前端 unwrapEden 从 Eden error.value 中提取此结构。
 */

/** Elysia Context['set'] 的最小类型约束 */
type SetStatus = { status?: number | string | undefined }

/** 未认证 (未登录或 token 失效) */
export function unauthorized(set: SetStatus, message = '请先登录') {
  set.status = 401
  return { success: false, error: message } as const
}

/** 无权操作 (资源不属于当前用户) */
export function forbidden(set: SetStatus, message = '无权操作') {
  set.status = 403
  return { success: false, error: message } as const
}

/** 资源不存在 */
export function notFound(set: SetStatus, message = '资源不存在') {
  set.status = 404
  return { success: false, error: message } as const
}

/** 状态冲突 (重复创建、状态前置条件不满足) */
export function conflict(set: SetStatus, message: string) {
  set.status = 409
  return { success: false, error: message } as const
}

/** 参数校验失败 */
export function validationError(set: SetStatus, message: string) {
  set.status = 422
  return { success: false, error: message } as const
}
