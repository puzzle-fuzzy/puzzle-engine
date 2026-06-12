// ===== API 响应 DTO 类型 =====
// 新增或重构的路由不再手写零散 response shape，使用这些共享 DTO。

/**
 * 简单 mutation 成功响应 — 无实体的确认型操作（删除、取消、标记已读等）
 *
 * 使用场景：DELETE /records/:id, POST /records/:id/cancel, POST /notifications/:id/read
 * 前端只需知道操作成功，不需要实体数据。
 */
export interface MutationOkResponse {
  success: true
}

/**
 * 实体响应 — 成功时返回单个实体数据
 *
 * 使用场景：GET /records/:id, PATCH /canvas/projects/:projectId
 * data 字段携带完整实体序列化结果。
 */
export interface EntityResponse<T> {
  success: true
  data: T
}

/**
 * 列表响应 — 成功时返回实体数组 + 总数
 *
 * 使用场景：GET /records, GET /canvas/projects, GET /notifications
 * items 字段携带序列化后的实体数组，total 为当前查询条件下的总数。
 */
export interface ListResponse<T> {
  success: true
  items: T[]
  total: number
}

/**
 * 带实体的创建/更新响应 — 成功时返回新创建或更新后的实体
 *
 * 使用场景：POST /generate（创建记录 + 觔回结果）,
 * POST /records/:id/retry（重置 + 返回更新记录）,
 * POST /api-keys（创建 key + 返回原始值）
 *
 * record 字段是业务实体（GenerationRecord、ApiKey 等）。
 * 此类型适用于"创建后需要完整实体"的场景，
 * 简单确认型操作应使用 MutationOkResponse。
 */
export interface RecordResponse<T> {
  success: true
  record: T
}

/**
 * API 错误响应 — 所有业务错误统一格式
 *
 * 使用场景：4xx 错误（校验失败、权限不足、资源不存在）
 * success: false + error 消息。HTTP status code 由 route 设置。
 * 不把业务失败包装成 HTTP 200。
 */
export interface ApiErrorResponse {
  success: false
  error: string
}
