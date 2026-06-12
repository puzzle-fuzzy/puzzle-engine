import type { OutputResult } from '@excuse/db'
import type { OpenAIChatRequest, OpenAIErrorResponse } from '@excuse/shared'
import type { ServerConfig } from '../config'
import { calculateCost } from '@excuse/billing'
import {
  createGenerationRecord,
  markGenerationFailed,
  markGenerationSucceeded,
} from '@excuse/db'
import { DashScopeClient, getModelById, getModelsByCategory, validateModelParameters } from '@excuse/provider'
import { resolveModelId } from '@excuse/shared'
import { Elysia, t } from 'elysia'
import { createRequireAuthPlugin } from '../plugins/auth'

/**
 * OpenAI 兼容网关 — /v1/chat/completions
 *
 * 提供与 OpenAI Chat Completions API 兼容的文本生成端点，
 * 供外部开发者工具接入使用。仅支持文本模型。
 *
 * 认证：API Key（Bearer exc_xxx）或 JWT
 * 计费：同一套 GenerationRecord + calculateCost
 */

function openaiError(message: string, type: string, code: string, statusCode: number): { response: OpenAIErrorResponse, status: number } {
  return {
    response: { error: { message, type, code } },
    status: statusCode,
  }
}

export function createOpenAIGatewayRoutes(config: ServerConfig) {
  const client = new DashScopeClient({
    apiKey: config.dashscopeApiKey,
    baseUrl: config.dashscopeBaseUrl,
  })

  return new Elysia({ prefix: '/v1' })
    .use(createRequireAuthPlugin(config))
    .post('/chat/completions', async ({ body, userId, set }) => {
      const request = body as OpenAIChatRequest

      // 拒绝流式请求
      if (request.stream) {
        const err = openaiError('Streaming is not supported', 'invalid_request_error', 'stream_not_supported', 400)
        set.status = err.status
        return err.response
      }

      // 模型名解析（别名 → 内部 ID）
      const internalModelId = resolveModelId(request.model)
      const modelConfig = getModelById(internalModelId)
      if (!modelConfig) {
        const err = openaiError(`Model '${request.model}' not found`, 'invalid_request_error', 'model_not_found', 404)
        set.status = err.status
        return err.response
      }

      // 仅支持文本模型
      if (modelConfig.category !== 'text') {
        const err = openaiError(`Model '${request.model}' is not a text model`, 'invalid_request_error', 'invalid_model', 400)
        set.status = err.status
        return err.response
      }

      // 提取 prompt：取最后一条 user message
      const userMessages = request.messages.filter(m => m.role === 'user')
      if (userMessages.length === 0) {
        const err = openaiError('No user message provided', 'invalid_request_error', 'missing_user_message', 400)
        set.status = err.status
        return err.response
      }
      const prompt = userMessages[userMessages.length - 1].content

      // 构建 internal parameters
      const parameters: Record<string, unknown> = { prompt }
      if (request.temperature !== undefined)
        parameters.temperature = request.temperature
      if (request.max_tokens !== undefined)
        parameters.max_tokens = request.max_tokens
      if (request.top_p !== undefined)
        parameters.top_p = request.top_p

      // 参数校验
      const validation = validateModelParameters(modelConfig, parameters)
      if (!validation.valid) {
        const details = validation.errors.map(e => `${e.field}: ${e.message}`).join('; ')
        const err = openaiError(details, 'invalid_request_error', 'invalid_parameters', 400)
        set.status = err.status
        return err.response
      }

      // 成本估算
      const estimatedCost = calculateCost(modelConfig, parameters)

      // 创建生成记录
      const traceId = crypto.randomUUID()
      const taskId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const record = await createGenerationRecord({
        accountId: userId,
        taskId,
        traceId,
        model: modelConfig.id,
        category: 'text',
        status: 'pending',
        inputParams: parameters,
        cost: { ...estimatedCost, estimated: true, billable: false, source: 'estimated' },
        dedupeKey: `${userId}:${modelConfig.id}:${JSON.stringify(parameters)}`,
      })

      // 调用 provider
      const result = await client.chatCompletion(modelConfig.id, parameters)

      if (!result.success) {
        await markGenerationFailed(record.id, result.error ?? 'Provider error')
        const err = openaiError(result.error ?? 'Generation failed', 'server_error', 'generation_failed', 500)
        set.status = err.status
        return err.response
      }

      // 计算实际成本
      calculateCost(modelConfig, parameters, result.usage)
      const text = String(result.output?.text ?? '')

      // 更新记录为成功
      const textOutput: OutputResult = { type: 'text' as const, text }
      await markGenerationSucceeded(record.id, textOutput)

      // 组装 OpenAI 响应
      const promptTokens = result.usage?.inputTokens ?? 0
      const completionTokens = result.usage?.outputTokens ?? 0

      return {
        id: record.id,
        object: 'chat.completion',
        created: Math.floor(record.createdAt.getTime() / 1000),
        model: request.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: text },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      }
    }, {
      body: t.Object({
        model: t.String(),
        messages: t.Array(t.Object({
          role: t.Union([t.Literal('system'), t.Literal('user'), t.Literal('assistant')]),
          content: t.String(),
        })),
        temperature: t.Optional(t.Number()),
        max_tokens: t.Optional(t.Number()),
        top_p: t.Optional(t.Number()),
        stream: t.Optional(t.Boolean()),
      }),
      detail: {
        summary: 'OpenAI 兼容文本生成',
        description: '与 OpenAI Chat Completions API 兼容的文本生成端点，仅支持文本模型',
        tags: ['OpenAI 网关'],
        security: [{ bearerAuth: [] }],
      },
    })
    .get('/models', async () => {
      const textModels = getModelsByCategory('text')
      return {
        object: 'list',
        data: textModels.map(m => ({
          id: m.id,
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'excuse',
        })),
      }
    }, {
      detail: {
        summary: '列出可用文本模型',
        description: '返回所有可用的文本生成模型（OpenAI 格式）',
        tags: ['OpenAI 网关'],
        security: [{ bearerAuth: [] }],
      },
    })
}
