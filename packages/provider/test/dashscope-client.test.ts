import { describe, it, expect, mock, beforeEach, spyOn } from 'bun:test'
import { DashScopeClient } from '../src/dashscope-client'
import type { DashScopeConfig } from '../src/types'

// ── 测试配置 ──────────────────────────────────────────────

const config: DashScopeConfig = {
  apiKey: 'test-api-key',
  baseUrl: 'https://dashscope.test.local/api/v1',
}

// ── fetch mock 工具 ────────────────────────────────────────

function mockFetchResponse(status: number, body: unknown) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  )
  return () => { globalThis.fetch = originalFetch }
}

function mockFetchError(error: Error) {
  const originalFetch = globalThis.fetch
  globalThis.fetch = mock(() => Promise.reject(error))
  return () => { globalThis.fetch = originalFetch }
}

// ── tests ─────────────────────────────────────────────────

describe('DashScopeClient', () => {
  let client: DashScopeClient
  let restoreFetch: () => void

  beforeEach(() => {
    client = new DashScopeClient(config)
    restoreFetch = () => {}
  })

  // 避免测试间互相影响，每个 it 结束后恢复 fetch
  function withMock(status: number, body: unknown) {
    restoreFetch = mockFetchResponse(status, body)
  }
  function withMockError(error: Error) {
    restoreFetch = mockFetchError(error)
  }

  // ── chatCompletion ──

  describe('chatCompletion', () => {
    it('成功返回文本内容', async () => {
      withMock(200, {
        output: {
          choices: [{
            message: { content: [{ text: '你好世界' }] },
          }],
        },
        usage: { input_tokens: 100, output_tokens: 50 },
      })

      const result = await client.chatCompletion('qwen-max', { prompt: '你好' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.output!.text).toBe('你好世界')
      expect(result.usage!.inputTokens).toBe(100)
      expect(result.usage!.outputTokens).toBe(50)
    })

    it('未知模型返回错误', async () => {
      const result = await client.chatCompletion('nonexistent-model', {})

      expect(result.success).toBe(false)
      expect(result.error).toContain('未知模型')
    })

    it('API 返回非 200 时解析错误', async () => {
      withMock(400, {
        code: 'InvalidParameter',
        message: '参数错误',
      })

      const result = await client.chatCompletion('qwen-max', { prompt: 'test' })
      restoreFetch()

      expect(result.success).toBe(false)
      expect(result.error).toContain('请求参数有误')
    })

    it('网络错误返回友好消息', async () => {
      withMockError(new Error('ECONNREFUSED'))

      const result = await client.chatCompletion('qwen-max', { prompt: 'test' })
      restoreFetch()

      expect(result.success).toBe(false)
      expect(result.error).toContain('网络错误')
    })

    it('正确构建 chat 请求体（messages 格式）', async () => {
      const originalFetch = globalThis.fetch
      let capturedBody: any = null

      globalThis.fetch = mock((url: string, init: any) => {
        capturedBody = JSON.parse(init.body)
        return Promise.resolve(new Response(JSON.stringify({
          output: { choices: [{ message: { content: [{ text: 'ok' }] } }] },
          usage: {},
        }), { status: 200 }))
      })

      await client.chatCompletion('qwen-max', { prompt: '你好', temperature: 0.5 })
      globalThis.fetch = originalFetch

      expect(capturedBody.model).toBe('qwen-max')
      expect(capturedBody.input.messages[0].role).toBe('user')
      expect(capturedBody.input.messages[0].content).toBe('你好')
      expect(capturedBody.parameters.temperature).toBe(0.5)
      expect(capturedBody.parameters.result_format).toBe('message')
    })

    it('设置正确的 Authorization header', async () => {
      const originalFetch = globalThis.fetch
      let capturedHeaders: any = null

      globalThis.fetch = mock((url: string, init: any) => {
        capturedHeaders = init.headers
        return Promise.resolve(new Response(JSON.stringify({
          output: { choices: [{ message: { content: [{ text: 'ok' }] } }] },
          usage: {},
        }), { status: 200 }))
      })

      await client.chatCompletion('qwen-max', { prompt: 'test' })
      globalThis.fetch = originalFetch

      expect(capturedHeaders['Authorization']).toBe('Bearer test-api-key')
      expect(capturedHeaders['Content-Type']).toBe('application/json')
    })
  })

  // ── generateImage ──

  describe('generateImage', () => {
    it('成功返回图片 URL 列表', async () => {
      withMock(200, {
        output: {
          choices: [{
            message: {
              content: [
                { image: 'https://cdn.example.com/img1.png' },
                { image: 'https://cdn.example.com/img2.png' },
              ],
            },
          }],
        },
        usage: { image_count: 2 },
      })

      const result = await client.generateImage('qwen-image-2.0-pro', { prompt: '画一只猫' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.output!.urls).toHaveLength(2)
      expect(result.usage!.imageCount).toBe(2)
    })

    it('未知图片模型返回错误', async () => {
      const result = await client.generateImage('nonexistent', {})
      expect(result.success).toBe(false)
    })
  })

  // ── submitVideoTask ──

  describe('submitVideoTask', () => {
    it('成功提交异步任务并返回 taskId', async () => {
      withMock(200, {
        output: { task_id: 'task-abc-123' },
        request_id: 'req-xyz',
      })

      const result = await client.submitVideoTask('happyhorse-1.0-t2v', {
        prompt: '生成一个视频',
        duration: 5,
      })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.providerTaskId).toBe('task-abc-123')
      expect(result.usage!.videoDuration).toBe(5)
    })

    it('无 task_id 时回退到 request_id', async () => {
      withMock(200, {
        request_id: 'req-fallback-456',
      })

      const result = await client.submitVideoTask('happyhorse-1.0-t2v', { prompt: 'test' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.providerTaskId).toBe('req-fallback-456')
    })

    it('包含 X-DashScope-Async header', async () => {
      const originalFetch = globalThis.fetch
      let capturedHeaders: any = null

      globalThis.fetch = mock((url: string, init: any) => {
        capturedHeaders = init.headers
        return Promise.resolve(new Response(JSON.stringify({
          output: { task_id: 't1' },
        }), { status: 200 }))
      })

      await client.submitVideoTask('happyhorse-1.0-t2v', { prompt: 'test' })
      globalThis.fetch = originalFetch

      expect(capturedHeaders['X-DashScope-Async']).toBe('enable')
    })

    it('网络错误返回友好消息', async () => {
      withMockError(new TypeError('fetch failed'))

      const result = await client.submitVideoTask('happyhorse-1.0-t2v', { prompt: 'test' })
      restoreFetch()

      expect(result.success).toBe(false)
      expect(result.error).toContain('网络错误')
    })
  })

  // ── queryTask ──

  describe('queryTask', () => {
    it('查询运行中的任务', async () => {
      withMock(200, {
        output: { task_status: 'RUNNING' },
      })

      const result = await client.queryTask('task-123')
      restoreFetch()

      expect(result.taskId).toBe('task-123')
      expect(result.status).toBe('RUNNING')
    })

    it('查询成功的任务（带 video_url）', async () => {
      withMock(200, {
        output: {
          task_status: 'SUCCEEDED',
          video_url: 'https://cdn.example.com/video.mp4',
        },
        usage: { video_duration: 5 },
      })

      const result = await client.queryTask('task-456')
      restoreFetch()

      expect(result.status).toBe('SUCCEEDED')
      expect(result.output).toBeDefined()
      expect(result.usage).toBeDefined()
    })

    it('查询成功的任务（带 results 数组）', async () => {
      withMock(200, {
        output: {
          task_status: 'SUCCEEDED',
          results: [{ url: 'https://cdn.example.com/img.png' }],
        },
      })

      const result = await client.queryTask('task-789')
      restoreFetch()

      expect(result.status).toBe('SUCCEEDED')
      expect(result.output).toBeDefined()
    })

    it('查询失败的任务返回中文错误消息', async () => {
      withMock(200, {
        output: {
          task_status: 'FAILED',
          code: 'DataInspectionFailed',
          message: 'Content inspection failed',
        },
      })

      const result = await client.queryTask('task-failed')
      restoreFetch()

      expect(result.status).toBe('FAILED')
      expect(result.errorCode).toBe('DataInspectionFailed')
      expect(result.errorMessage).toContain('不合规')
    })

    it('网络错误返回 UNKNOWN 状态', async () => {
      withMockError(new Error('timeout'))

      const result = await client.queryTask('task-neterr')
      restoreFetch()

      expect(result.status).toBe('UNKNOWN')
      expect(result.errorMessage).toContain('网络错误')
    })
  })

  // ── generate 路由 ──

  describe('generate', () => {
    it('文本模型路由到 chatCompletion', async () => {
      withMock(200, {
        output: { choices: [{ message: { content: [{ text: '回复' }] } }] },
        usage: {},
      })

      const result = await client.generate('qwen-max', { prompt: '你好' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.output!.text).toBe('回复')
    })

    it('图片模型路由到 generateImage', async () => {
      withMock(200, {
        output: { choices: [{ message: { content: [{ image: 'https://img.url' }] } }] },
        usage: { image_count: 1 },
      })

      const result = await client.generate('qwen-image-2.0-pro', { prompt: '画猫' })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.output!.urls).toHaveLength(1)
    })

    it('视频模型路由到 submitVideoTask', async () => {
      withMock(200, {
        output: { task_id: 'task-vid-001' },
      })

      const result = await client.generate('happyhorse-1.0-t2v', { prompt: '视频', duration: 5 })
      restoreFetch()

      expect(result.success).toBe(true)
      expect(result.providerTaskId).toBe('task-vid-001')
    })

    it('未知模型返回错误', async () => {
      const result = await client.generate('nonexistent', {})
      expect(result.success).toBe(false)
      expect(result.error).toContain('未知模型')
    })
  })
})
