import type { OpenAIChatRequest, OpenAIChatResponse, OpenAIErrorResponse, OpenAIModelsResponse } from '@excuse/shared'
import { resolveModelId } from '@excuse/shared'

export interface OpenAIGatewayError {
  response: OpenAIErrorResponse
  status: number
}

export interface NormalizedOpenAIChatRequest {
  request: OpenAIChatRequest
  internalModelId: string
  prompt: string
  parameters: Record<string, unknown>
}

export interface GatewayModelListItem {
  id: string
}

export interface OpenAIChatResponseInput {
  id: string
  createdAt: Date
  requestedModel: string
  text: string
  inputTokens?: number
  outputTokens?: number
}

export function createOpenAIError(
  message: string,
  type: string,
  code: string,
  statusCode: number,
): OpenAIGatewayError {
  return {
    response: { error: { message, type, code } },
    status: statusCode,
  }
}

export function normalizeOpenAIChatRequest(request: OpenAIChatRequest): NormalizedOpenAIChatRequest | OpenAIGatewayError {
  if (request.stream) {
    return createOpenAIError('Streaming is not supported', 'invalid_request_error', 'stream_not_supported', 400)
  }

  const userMessages = request.messages.filter(m => m.role === 'user')
  if (userMessages.length === 0) {
    return createOpenAIError('No user message provided', 'invalid_request_error', 'missing_user_message', 400)
  }

  const lastUserMessage = userMessages[userMessages.length - 1]
  if (!lastUserMessage) {
    return createOpenAIError('No user message provided', 'invalid_request_error', 'missing_user_message', 400)
  }

  const parameters: Record<string, unknown> = { prompt: lastUserMessage.content }
  if (request.temperature !== undefined)
    parameters.temperature = request.temperature
  if (request.max_tokens !== undefined)
    parameters.max_tokens = request.max_tokens
  if (request.top_p !== undefined)
    parameters.top_p = request.top_p

  return {
    request,
    internalModelId: resolveModelId(request.model),
    prompt: lastUserMessage.content,
    parameters,
  }
}

export function isOpenAIGatewayError(value: unknown): value is OpenAIGatewayError {
  return typeof value === 'object'
    && value !== null
    && 'response' in value
    && 'status' in value
}

export function createOpenAIChatResponse(input: OpenAIChatResponseInput): OpenAIChatResponse {
  const promptTokens = input.inputTokens ?? 0
  const completionTokens = input.outputTokens ?? 0

  return {
    id: input.id,
    object: 'chat.completion',
    created: Math.floor(input.createdAt.getTime() / 1000),
    model: input.requestedModel,
    choices: [{
      index: 0,
      message: { role: 'assistant', content: input.text },
      finish_reason: 'stop',
    }],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  }
}

export function createOpenAIModelsResponse(models: GatewayModelListItem[]): OpenAIModelsResponse {
  const created = Math.floor(Date.now() / 1000)
  return {
    object: 'list',
    data: models.map(m => ({
      id: m.id,
      object: 'model',
      created,
      owned_by: 'excuse',
    })),
  }
}
