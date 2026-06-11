import type { GenerationCategory, GenerationRecordRow, GenerationStatus, OutputResult } from '@excuse/db'
import type { ServerConfig } from '../config'
import { calculateCost } from '@excuse/billing'
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
    .post('/generate', async ({ body, userId }) => {
      if (!userId) {
        return { success: false, error: '请先登录' }
      }
      const { model, parameters, referenceFileIds } = body

      const modelConfig = getModelById(model)
      if (!modelConfig) {
        return { success: false, error: `Unknown model: ${model}` }
      }

      // 去重：同一用户 + 同一 model + 相同参数短时间内不重复提交
      const dedupeKey = `${userId}:${model}:${JSON.stringify(parameters)}`
      const existing = await findGenerationByDedupeKeyForAccount(dedupeKey, userId)
      if (existing && (existing.status === 'pending' || existing.status === 'processing')) {
        const updated = await getGenerationRecordById(existing.id)
        return { success: true, record: serializeRecord(updated!), duplicated: true }
      }

      // 预估费用
      const estimatedCost = calculateCost(modelConfig, parameters)

      // 生成唯一 taskId
      const taskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      // 创建数据库记录
      const record = await createGenerationRecord({
        accountId: userId,
        taskId,
        model,
        category: modelConfig.category,
        status: 'pending',
        inputParams: { ...parameters, referenceFileIds },
        cost: { ...estimatedCost, estimated: true },
        dedupeKey,
      })

      // 解析参考图 URL（仅允许当前用户的文件）
      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const files = await getUploadedFilesByIdsForAccount(referenceFileIds, userId)
        if (files.length !== referenceFileIds.length) {
          return { success: false, error: '部分参考文件不存在或不属于当前用户' }
        }
        referenceUrls = files.map(f => f.publicUrl)
      }

      const result = await client.generate(model, parameters, referenceUrls)

      if (!result.success) {
        // API 调用失败，更新记录
        await markGenerationFailed(record.id, result.error!)

        // 通知 SSE 客户端
        await notifyGenerationStatus({
          accountId: userId,
          recordId: record.id,
          status: 'failed',
          category: modelConfig.category,
          model,
          taskId,
          errorMessage: result.error,
        })

        // 重新查询以获取更新后的记录
        const updated = await getGenerationRecordById(record.id)
        return { success: false, record: serializeRecord(updated!) }
      }

      if (result.providerTaskId) {
        // 异步任务（视频生成）— 保存 providerTaskId，Worker 会轮询
        await markGenerationProcessing(record.id, {
          taskId: result.providerTaskId,
          outputResult: result.output ?? ({} as OutputResult),
        })

        // 通知 SSE 客户端状态变为 processing
        await notifyGenerationStatus({
          accountId: userId,
          recordId: record.id,
          status: 'processing',
          category: modelConfig.category,
          model,
          taskId: result.providerTaskId,
        })

        const updated = await getGenerationRecordById(record.id)
        return { success: true, record: serializeRecord(updated!) }
      }

      // 同步任务完成（文本/图片）— 下载并保存结果
      let outputResult = result.output || {}
      if (modelConfig.category === 'image' && 'urls' in outputResult) {
        const urls = Array.isArray(outputResult.urls) ? outputResult.urls : []
        const savedUrls = await storage.downloadAndMap(urls, taskId, 'img')
        outputResult = { ...outputResult, savedUrls, urls }
      }

      // 计算实际费用
      const actualCost = calculateCost(modelConfig, parameters, result.usage)

      await markGenerationSucceeded(record.id, outputResult, actualCost)

      // 通知 SSE 客户端同步任务完成
      await notifyGenerationStatus({
        accountId: userId,
        recordId: record.id,
        status: 'succeeded',
        category: modelConfig.category,
        model,
        taskId,
        outputResult,
        cost: actualCost,
      })

      const updated = await getGenerationRecordById(record.id)
      return { success: true, record: serializeRecord(updated!) }
    }, {
      body: t.Object({
        model: t.String(),
        parameters: t.Record(t.String(), t.Any()),
        referenceFileIds: t.Optional(t.Array(t.String())),
      }),
    })

    // 获取生成记录列表
    .get('/records', async ({ query, userId }) => {
      if (!userId) {
        return { success: false, error: '请先登录' }
      }

      const category = typeof query.category === 'string'
        ? query.category as GenerationCategory | undefined
        : undefined
      const status = typeof query.status === 'string'
        ? query.status as GenerationStatus | undefined
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
    .get('/records/:id', async ({ params, userId }) => {
      if (!userId) {
        return { success: false, error: '请先登录' }
      }

      const record = await getGenerationRecordById(params.id)

      if (!record) {
        return { success: false, error: 'Record not found' }
      }

      if (record.accountId !== userId) {
        return { success: false, error: '无权查看该记录' }
      }

      return { success: true, record: serializeRecord(record) }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })

    // 删除单条记录
    .delete('/records/:id', async ({ params, userId }) => {
      if (!userId) {
        return { success: false, error: '请先登录' }
      }

      const record = await getGenerationRecordById(params.id)
      if (!record) {
        return { success: false, error: '记录不存在' }
      }
      if (record.accountId !== userId) {
        return { success: false, error: '无权删除该记录' }
      }

      await deleteGenerationRecord(params.id)
      return { success: true }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })

    // 重试失败任务
    .post('/records/:id/retry', async ({ params, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }

      const record = await getGenerationRecordById(params.id)
      if (!record)
        return { success: false, error: '记录不存在' }
      if (record.accountId !== userId)
        return { success: false, error: '无权操作该记录' }
      if (record.status !== 'failed')
        return { success: false, error: '只能重试失败的任务' }

      // Re-submit to DashScope with the same parameters
      const modelConfig = getModelById(record.model)
      if (!modelConfig)
        return { success: false, error: `Unknown model: ${record.model}` }

      const inputParams = record.inputParams
      const referenceFileIds = Array.isArray(inputParams.referenceFileIds)
        ? inputParams.referenceFileIds as string[]
        : undefined
      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const files = await getUploadedFilesByIdsForAccount(referenceFileIds, userId)
        if (files.length !== referenceFileIds.length) {
          return { success: false, error: '部分参考文件不存在或不属于当前用户' }
        }
        referenceUrls = files.map(f => f.publicUrl)
      }

      const parameters = { ...inputParams }
      delete (parameters as Record<string, unknown>).referenceFileIds

      const newTaskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

      await resetGenerationToPending(record.id)

      const result = await client.generate(record.model, parameters, referenceUrls)

      if (!result.success) {
        await markGenerationFailed(record.id, result.error!)
        await notifyGenerationStatus({
          accountId: userId,
          recordId: record.id,
          status: 'failed',
          category: modelConfig.category,
          model: record.model,
          taskId: newTaskId,
          errorMessage: result.error,
        })
        const updated = await getGenerationRecordById(record.id)
        return { success: false, record: serializeRecord(updated!) }
      }

      if (result.providerTaskId) {
        await markGenerationProcessing(record.id, {
          taskId: result.providerTaskId,
          outputResult: result.output ?? ({} as OutputResult),
        })
        await notifyGenerationStatus({
          accountId: userId,
          recordId: record.id,
          status: 'processing',
          category: modelConfig.category,
          model: record.model,
          taskId: result.providerTaskId,
        })
        const updated = await getGenerationRecordById(record.id)
        return { success: true, record: serializeRecord(updated!) }
      }

      // Sync task succeeded (text/image retry)
      let outputResult = result.output || {} as OutputResult
      if (modelConfig.category === 'image' && 'urls' in outputResult) {
        const urls = Array.isArray(outputResult.urls) ? outputResult.urls : []
        const savedUrls = await storage.downloadAndMap(urls, newTaskId, 'img')
        outputResult = { ...outputResult, savedUrls, urls }
      }
      const actualCost = calculateCost(modelConfig, parameters, result.usage)
      await markGenerationSucceeded(record.id, outputResult, actualCost)
      await notifyGenerationStatus({
        accountId: userId,
        recordId: record.id,
        status: 'succeeded',
        category: modelConfig.category,
        model: record.model,
        taskId: newTaskId,
        outputResult,
        cost: actualCost,
      })
      const updated = await getGenerationRecordById(record.id)
      return { success: true, record: serializeRecord(updated!) }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })

    // 取消进行中的任务
    .post('/records/:id/cancel', async ({ params, userId }) => {
      if (!userId)
        return { success: false, error: '请先登录' }

      const record = await getGenerationRecordById(params.id)
      if (!record)
        return { success: false, error: '记录不存在' }
      if (record.accountId !== userId)
        return { success: false, error: '无权操作该记录' }
      if (record.status !== 'pending' && record.status !== 'processing')
        return { success: false, error: '只能取消等待中或处理中的任务' }

      // Try to cancel at DashScope if we have a taskId
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
      return { success: true, record: serializeRecord(updated!) }
    }, {
      params: t.Object({
        id: t.String(),
      }),
    })
}
