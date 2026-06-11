import { describe, expect, it } from 'bun:test'
import { getDashScopeErrorMessage, parseDashScopeError } from '../src/dashscope-errors'

describe('getDashScopeErrorMessage', () => {
  it('返回已知错误码的中文消息', () => {
    expect(getDashScopeErrorMessage('InvalidApiKey', 'fallback')).toBe(
      'API Key 无效，请在 .env 中检查 DASHSCOPE_API_KEY 配置',
    )
  })

  it('返回限流错误消息', () => {
    expect(getDashScopeErrorMessage('Throttling', 'fallback')).toBe(
      '请求过于频繁，请稍后重试',
    )
  })

  it('未知错误码返回 fallback', () => {
    expect(getDashScopeErrorMessage('SOME_UNKNOWN_CODE', '原始错误消息')).toBe('原始错误消息')
  })
})

describe('parseDashScopeError', () => {
  it('解析 DashScope 原生格式: { code, message }', () => {
    const result = parseDashScopeError({
      code: 'InvalidApiKey',
      message: 'Invalid API key provided',
    })

    expect(result).toBe('API Key 无效，请在 .env 中检查 DASHSCOPE_API_KEY 配置')
  })

  it('解析 OpenAI 兼容格式 (带 code): { error: { code, message } }', () => {
    const result = parseDashScopeError({
      error: {
        code: 'Throttling',
        message: 'Rate limit exceeded',
      },
    })

    expect(result).toBe('请求过于频繁，请稍后重试')
  })

  it('解析 OpenAI 兼容格式 (无 code): { error: { message } }', () => {
    const result = parseDashScopeError({
      error: {
        message: 'Something went wrong',
      },
    })

    expect(result).toBe('Something went wrong')
  })

  it('解析异步任务失败格式: { output: { task_status, message, code } }', () => {
    const result = parseDashScopeError({
      output: {
        task_status: 'FAILED',
        code: 'DataInspectionFailed',
        message: 'Content inspection failed',
      },
    })

    expect(result).toBe('输入或输出内容不合规，请修改后重试')
  })

  it('异步任务失败无 code 时用 task_status 查找', () => {
    const result = parseDashScopeError({
      output: {
        task_status: 'FAILED',
        message: 'Unknown failure',
      },
    })

    // 'FAILED' 不在映射中，返回 fallback message
    expect(result).toBe('Unknown failure')
  })

  it('DashScope 原生格式未知错误码返回原始 message', () => {
    const result = parseDashScopeError({
      code: 'SomeNewError',
      message: 'Raw error message',
    })

    expect(result).toBe('Raw error message')
  })

  it('OpenAI 兼容格式未知错误码返回原始 message', () => {
    const result = parseDashScopeError({
      error: {
        code: 'NewError',
        message: 'Raw error from openai compat',
      },
    })

    expect(result).toBe('Raw error from openai compat')
  })

  it('无法识别的格式返回 "未知错误"', () => {
    expect(parseDashScopeError({})).toBe('未知错误')
    expect(parseDashScopeError(null)).toBe('未知错误')
    expect(parseDashScopeError(undefined)).toBe('未知错误')
  })

  it('解析认证类错误: Arrearage', () => {
    const result = parseDashScopeError({ code: 'Arrearage', message: 'Account arrears' })
    expect(result).toContain('欠费')
  })

  it('解析限流类错误: Throttling.RateQuota', () => {
    const result = parseDashScopeError({ code: 'Throttling.RateQuota', message: 'Rate limit' })
    expect(result).toContain('频率超限')
  })

  it('解析内容审核错误: DataInspectionFailed.Input', () => {
    const result = parseDashScopeError({ code: 'DataInspectionFailed.Input', message: 'Sensitive' })
    expect(result).toContain('输入内容')
  })

  it('解析参数错误: InvalidParameter', () => {
    const result = parseDashScopeError({ code: 'InvalidParameter', message: 'Bad param' })
    expect(result).toContain('参数有误')
  })

  it('解析服务端错误: InternalError', () => {
    const result = parseDashScopeError({ code: 'InternalError', message: 'Server error' })
    expect(result).toContain('内部错误')
  })
})
