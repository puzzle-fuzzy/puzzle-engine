import type { GenerationCategory, GenerationRecordRow, GenerationStatus, OutputResult } from '@excuse/db'
import type { ServerConfig } from '../config'
import { calculateCost } from '@excuse/billing'
import { extractImageUrls, parseProviderOutput } from '../modules/generation/output-parser'
import {
  cancelGenerationRecord,
  createGenerationRecord,
  deleteGenerationRecord,
  findGenerationByDedupeKeyForAccount,
  getGenerationRecordById,
  getUploadedFilesByIdsForAccount,
  listGenerationRecords,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  notifyGenerationStatus,
  resetGenerationToPending,
} from '@excuse/db'
import { AssetStorage, DashScopeClient, getModelById } from '@excuse/provider'
import { Elysia, t } from 'elysia'
import { createAuthPlugin } from '../plugins/auth'
import { forbidden, notFound, unauthorized, validationError } from '../utils/errors'

/**
 * 生成任务路由 — CRUD + retry/cancel
 *
 * 任务状态机:
 *   pending → (provider 调用) → processing → succeeded / failed
 *   pending → (用户取消) → cancelled (等同 failed + errorMessage='用户取消')
 *   failed → (retry) → pending → ...
 *
 * 关键约束:
 *   - 校验顺序：认证 → 模型存在 → reference 归属 → dedupe → 创建记录 → provider
 *     所有 DB 写操作必须在所有校验通过之后，防止校验失败留下脏记录/脏状态
 *   - dedupe: 同一用户 + 同模型 + 同参数在 pending/processing 时不重复提交
 *   - referenceFileIds: 必须属于当前用户，校验在创建记录之前（不在之后）
 *   - 异步任务（视频）: provider 返回 providerTaskId，Worker 轮询完成后更新
 *   - 同步任务（文本/图片）: 直接下载并保存输出，一步到位
 */
export function createGenerateRoutes(config: ServerConfig) {
  const client = new DashScopeClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })
  const storage = new AssetStorage({
    storageRoot: config.storageRoot,
    oss: config.oss,
  })

  /** 从 DB 行序列化为前端兼容的 GenerationRecord（Date→string） */
  function serializeRecord(record: GenerationRecordRow) {
    return {
      ...record,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
  }

  return new Elysia({ prefix: '/api' })
    .use(createAuthPlugin(config))
    // 发起生成
    .post('/generate', async ({ body, userId, set }) => {
      if (!userId) {
        return unauthorized(set)
      }
      const { model, parameters, referenceFileIds } = body

      const modelConfig = getModelById(model)
      if (!modelConfig) {
        return validationError(set, `Unknown model: ${model}`)
      }

      const category = modelConfig.category

      // 解析参考图 URL（仅允许当前用户的文件）— 必须在创建 DB 记录之前校验
      // 否则校验失败时会留下 pending 状态的脏记录
      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const files = await getUploadedFilesByIdsForAccount(referenceFileIds, userId)
        if (files.length !== referenceFileIds.length) {
          return forbidden(set, '部分参考文件不存在或不属于当前用户')
        }
        referenceUrls = files.map(f => f.publicUrl)
      }

      // 去重：同一用户 + 同一 model + 相同参数短时间内不重复提交
      const dedupeKey = `${userId}:${model}:${JSON.stringify(parameters)}`
      const existing = await findGenerationByDedupeKeyForAccount(dedupeKey, userId)
      if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
        const updated = await getGenerationRecordById(existing.id)
        return { success: true, record: serializeRecord(updated ?? existing), duplicated: true }
      }

      // 预估费用
      const estimatedCost = calculateCost(modelConfig, parameters)

      // 生成唯一 taskId
      const taskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // 创建数据库记录 — 此时所有前置校验已完成，不会有脏记录风险
      const record = await createGenerationRecord({
        accountId: userId,
        taskId,
        model,
        category,
        status: 'pending',
        inputParams: { ...parameters, referenceFileIds },
        cost: { ...estimatedCost, estimated: true },
        dedupeKey,
      })

      const result = await client.generate(model, parameters, referenceUrls)

      if (!result.success) {
        // API 调用失败，更新记录
        await markGenerationFailed(record.id, result.error!)

        // 通知 SSE 客户端
        await notifyGenerationStatus({
          accountId: userId,
          recordId: record.id,
          status: 'failed',
          category,
          model,
          taskId,
          errorMessage: result.error,
        })

        // 重新查询以获取更新后的记录
        const updated = await getGenerationRecordById(record.id)
        // Provider 失败不是 HTTP 错误 — 业务层面的失败，返回 200 + record
        return { success: false, record: serializeRecord(updated ?? record) }
      }

      if (result.providerTaskId) {
        // 异步任务（视频生成）— 保存 providerTaskId，Worker 会轮询
        await markGenerationProcessing(record.id, {
          taskId: result.providerTaskId,
          outputResult: parseProviderOutput(result.output),
        })

        // 通知 SSE 客户端状态变为 processing
        await notifyGenerationStatus({
          accountId: userId,
          recordId: record.id,
          status: 'processing',
          category,
          model,
          taskId: result.providerTaskId,
        })

        const updated = await getGenerationRecordById(record.id)
        return { success: true, record: serializeRecord(updated ?? record) }
      }

      // 同步任务完成（文本/图片）— 下载并保存结果
      let outputResult: OutputResult = parseProviderOutput(result.output)
      const imageUrls = extractImageUrls(result.output)
      if (modelConfig.category === 'image' && imageUrls.length > 0) {
        const savedUrls = await storage.downloadAndMap(imageUrls, taskId, 'img')
        outputResult = { type: 'image', savedUrls, urls: imageUrls }
      }

      // 计算实际费用
      const actualCost = calculateCost(modelConfig, parameters, result.usage)

      await markGenerationSucceeded(record.id, outputResult, actualCost)

      // 通知 SSE 客户端同步任务完成
      await notifyGenerationStatus({
        accountId: userId,
        recordId: record.id,
        status: 'succeeded',
        category,
        model,
        taskId,
        outputResult,
        cost: actualCost,
      })

      const updated = await getGenerationRecordById(record.id)
      return { success: true, record: serializeRecord(updated ?? record) }
    }, {
      body: t.Object({
        model: t.String(),
        parameters: t.Record(t.String(), t.Any()),
        referenceFileIds: t.Optional(t.Array(t.String())),
      }),
    })

    // 获取生成记录列表
    .get('/records', async ({ query, userId, set }) => {
      if (!userId) {
        return unauthorized(set)
      }

      const VALID_CATEGORIES = ['text', 'image', 'video'] as const
      const VALID_STATUSES = ['pending', 'processing', 'succeeded', 'failed'] as const

      const rawCategory = typeof query.category === 'string' ? query.category : undefined
      const rawStatus = typeof query.status === 'string' ? query.status : undefined

      const category = rawCategory && (VALID_CATEGORIES as readonly string[]).includes(rawCategory)
        ? rawCategory as GenerationCategory
        : undefined
      const status = rawStatus && (VALID_STATUSES as readonly string[]).includes(rawStatus)
        ? rawStatus as GenerationStatus
        : undefined
      const limit = query.limit ?? 50
      const offset = query.offset ?? 0

      const rows = await listGenerationRecords({ accountId: userId, category, status, limit, offset })
      const records = rows.map(serializeRecord)

      return { records, total: records.length }
    }, {
      query: t.Object({
        category: t.Optional(t.String()),
        status: t.Optional(t.String()),
        limit: t.Optional(t.Numeric()),
        offset: t.Optional(t.Numeric()),
      }),
    })

    // 获取单条记录详情
    .get('/records/:id', async ({ params, userId, set }) => {
      if (!userId) {
        return unauthorized(set)
      }

      const record = await getGenerationRecordById(params.id)

      if (!record) {
        return notFound(set, '记录不存在')
      }

      if (record.accountId !== userId) {
        return forbidden(set, '无权查看该记录')
      }

      return { success: true, record: serializeRecord(record) }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })

    // 删除单条记录
    .delete('/records/:id', async ({ params, userId, set }) => {
      if (!userId) {
        return unauthorized(set)
      }

      const record = await getGenerationRecordById(params.id)
      if (!record) {
        return notFound(set, '记录不存在')
      }
      if (record.accountId !== userId) {
        return forbidden(set, '无权删除该记录')
      }

      await deleteGenerationRecord(params.id)
      return { success: true }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })

    // 重试失败任务 — 重走完整的 provider 调用流程（参数校验 → 调用 → 结果处理）
    .post('/records/:id/retry', async ({ params, userId, set }) => {
      if (!userId)
        return unauthorized(set)

      const record = await getGenerationRecordById(params.id)
      if (!record)
        return notFound(set, '记录不存在')
      if (record.accountId !== userId)
        return forbidden(set, '无权操作该记录')
      if (record.status !== 'failed')
        return validationError(set, '只能重试失败的任务')

      // Re-submit to DashScope with the same parameters
      const modelConfig = getModelById(record.model)
      if (!modelConfig)
        return validationError(set, `Unknown model: ${record.model}`)

      const retryCategory = modelConfig.category

      const inputParams = record.inputParams
      const referenceFileIds = Array.isArray(inputParams.referenceFileIds)
        ? inputParams.referenceFileIds as string[]
        : undefined

      // 参考文件归属校验 — 必须在 resetGenerationToPending 之前完成
      // 否则校验失败时记录状态已被改写，产生脏状态
      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const files = await getUploadedFilesByIdsForAccount(referenceFileIds, userId)
        if (files.length !== referenceFileIds.length) {
          return forbidden(set, '部分参考文件不存在或不属于当前用户')
        }
        referenceUrls = files.map(f => f.publicUrl)
      }

      const parameters = { ...inputParams }
      delete (parameters as Record<string, unknown>).referenceFileIds

      const newTaskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // 所有校验通过后才重置状态 — 防止校验失败产生脏状态
      await resetGenerationToPending(record.id)

      const result = await client.generate(record.model, parameters, referenceUrls)

      if (!result.success) {
        await markGenerationFailed(record.id, result.error!)
        await notifyGenerationStatus({
          accountId: userId,
          recordId: record.id,
          status: 'failed',
          category: retryCategory,
          model: record.model,
          taskId: newTaskId,
          errorMessage: result.error,
        })
        const updated = await getGenerationRecordById(record.id)
        return { success: false, record: serializeRecord(updated ?? record) }
      }

      if (result.providerTaskId) {
        await markGenerationProcessing(record.id, {
          taskId: result.providerTaskId,
          outputResult: parseProviderOutput(result.output),
        })
        await notifyGenerationStatus({
          accountId: userId,
          recordId: record.id,
          status: 'processing',
          category: retryCategory,
          model: record.model,
          taskId: result.providerTaskId,
        })
        const updated = await getGenerationRecordById(record.id)
        return { success: true, record: serializeRecord(updated ?? record) }
      }

      // Sync task succeeded (text/image retry)
      let outputResult: OutputResult = parseProviderOutput(result.output)
      const retryImageUrls = extractImageUrls(result.output)
      if (modelConfig.category === 'image' && retryImageUrls.length > 0) {
        const savedUrls = await storage.downloadAndMap(retryImageUrls, newTaskId, 'img')
        outputResult = { type: 'image', savedUrls, urls: retryImageUrls }
      }
      const actualCost = calculateCost(modelConfig, parameters, result.usage)
      await markGenerationSucceeded(record.id, outputResult, actualCost)
      await notifyGenerationStatus({
        accountId: userId,
        recordId: record.id,
        status: 'succeeded',
        category: retryCategory,
        model: record.model,
        taskId: newTaskId,
        outputResult,
        cost: actualCost,
      })
      const updated = await getGenerationRecordById(record.id)
      return { success: true, record: serializeRecord(updated ?? record) }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })

    // 取消进行中的任务 — 同时通知 provider 取消（best-effort）+ 更新 DB + SSE 推送
    .post('/records/:id/cancel', async ({ params, userId, set }) => {
      if (!userId)
        return unauthorized(set)

      const record = await getGenerationRecordById(params.id)
      if (!record)
        return notFound(set, '记录不存在')
      if (record.accountId !== userId)
        return forbidden(set, '无权操作该记录')
      if (record.status !== 'pending' && record.status !== 'processing')
        return validationError(set, '只能取消等待中或处理中的任务')

      // 尝试在 provider 侧取消（best-effort：即使 provider 取消失败，DB 和 SSE 仍标记为已取消）
      if (record.taskId) {
        await client.cancelTask(record.taskId)
      }

      await cancelGenerationRecord(record.id)
      await notifyGenerationStatus({
        accountId: userId,
        recordId: record.id,
        status: 'failed',
        category: record.category,
        model: record.model,
        taskId: record.taskId,
        errorMessage: '用户取消',
      })

      const updated = await getGenerationRecordById(record.id)
      return { success: true, record: serializeRecord(updated ?? record) }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })
}
