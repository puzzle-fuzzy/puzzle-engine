import type { GenerationCategory, GenerationStatus } from '@excuse/db'
import type { ServerConfig } from '../config'
import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  deleteGenerationRecord,
  getGenerationRecordById,
  getUploadedFilesByIds,
  listGenerationRecords,
  markGenerationFailed,
  markGenerationProcessing,
  markGenerationSucceeded,
  notifyGenerationStatus,
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
  function serializeRecord(record: Record<string, unknown>) {
    return {
      ...record,
      createdAt: record.createdAt instanceof Date ? record.createdAt.toISOString() : String(record.createdAt),
      updatedAt: record.updatedAt instanceof Date ? record.updatedAt.toISOString() : String(record.updatedAt),
    }
  }

  return new Elysia({ prefix: '/api' })
    .use(createAuthPlugin(config))
    // 发起生成
    .post('/generate', async ({ body, userId }) => {
      if (!userId) {
        return { success: false, error: '请先登录' }
      }
      const { model, parameters, referenceFileIds } = body as {
        model: string
        parameters: Record<string, unknown>
        referenceFileIds?: string[]
      }

      const modelConfig = getModelById(model)
      if (!modelConfig) {
        return { success: false, error: `Unknown model: ${model}` }
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
      })

      // 解析参考图 URL
      let referenceUrls: string[] | undefined
      if (referenceFileIds?.length) {
        const files = await getUploadedFilesByIds(referenceFileIds)
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
          outputResult: result.output as Record<string, unknown>,
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
      if (modelConfig.category === 'image' && outputResult.urls) {
        const urls = outputResult.urls as string[]
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

      const category = (query.category || undefined) as GenerationCategory | undefined
      const status = (query.status || undefined) as GenerationStatus | undefined
      const limit = query.limit ?? 50
      const offset = query.offset ?? 0

      const records = await listGenerationRecords({ accountId: userId, category, status, limit, offset })

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
    .get('/records/:id', async ({ params }) => {
      const record = await getGenerationRecordById(params.id)

      if (!record) {
        return { success: false, error: 'Record not found' }
      }

      return { success: true, record }
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
}
