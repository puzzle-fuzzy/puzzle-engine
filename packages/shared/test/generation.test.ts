import { describe, expect, it } from 'bun:test'
import {
  isImageOutput,
  isProcessingOutput,
  isSubtitleOutput,
  isTextOutput,
  isVideoOutput,
  parseCostDetail,
  parseOutputResult,
} from '../src/generation'

// ===== parseOutputResult =====

describe('parseOutputResult', () => {
  it('returns null for null/undefined', () => {
    expect(parseOutputResult(null)).toBeNull()
    expect(parseOutputResult(undefined)).toBeNull()
  })

  it('returns null for non-object', () => {
    expect(parseOutputResult('string')).toBeNull()
    expect(parseOutputResult(42)).toBeNull()
    expect(parseOutputResult(true)).toBeNull()
  })

  it('returns null for empty object', () => {
    expect(parseOutputResult({})).toBeNull()
  })

  it('returns null for unrecognized keys', () => {
    expect(parseOutputResult({ foo: 'bar' })).toBeNull()
  })

  // ── TextOutputResult ──

  it('parses text output', () => {
    const result = parseOutputResult({ text: '你好' })
    expect(result).toEqual({ type: 'text', text: '你好' })
    expect(isTextOutput(result)).toBe(true)
  })

  it('parses text output with explicit type field', () => {
    const result = parseOutputResult({ type: 'text', text: '你好' })
    expect(result).toEqual({ type: 'text', text: '你好' })
  })

  it('ignores text when value is not string', () => {
    const result = parseOutputResult({ text: 123 })
    expect(result).toBeNull()
  })

  // ── ImageOutputResult ──

  it('parses image output (savedUrls + urls)', () => {
    const result = parseOutputResult({
      savedUrls: ['https://saved/1.png'],
      urls: ['https://orig/1.png'],
    })
    expect(result).toEqual({
      type: 'image',
      savedUrls: ['https://saved/1.png'],
      urls: ['https://orig/1.png'],
    })
    expect(isImageOutput(result)).toBe(true)
  })

  it('parses image output (savedUrls only, no urls)', () => {
    const result = parseOutputResult({ savedUrls: ['https://saved/1.png'] })
    expect(result).toEqual({ type: 'image', savedUrls: ['https://saved/1.png'], urls: undefined })
    expect(isImageOutput(result)).toBe(true)
  })

  it('ignores non-array savedUrls', () => {
    const result = parseOutputResult({ savedUrls: 'not-array' })
    expect(result).toBeNull()
  })

  // ── VideoOutputResult ──

  it('parses video output (savedUrls + originalUrl)', () => {
    const result = parseOutputResult({
      savedUrls: ['https://saved/v.mp4'],
      originalUrl: 'https://cdn/v.mp4',
    })
    expect(result).toEqual({
      type: 'video',
      savedUrls: ['https://saved/v.mp4'],
      originalUrl: 'https://cdn/v.mp4',
    })
    expect(isVideoOutput(result)).toBe(true)
  })

  it('parses video output (savedUrls + video_url)', () => {
    const result = parseOutputResult({
      savedUrls: ['https://saved/v.mp4'],
      video_url: 'https://cdn/v.mp4',
    })
    expect(result).toEqual({
      type: 'video',
      savedUrls: ['https://saved/v.mp4'],
      originalUrl: undefined,
      video_url: 'https://cdn/v.mp4',
    })
    expect(isVideoOutput(result)).toBe(true)
  })

  it('normalizes non-string originalUrl to undefined', () => {
    const result = parseOutputResult({
      savedUrls: ['https://saved/v.mp4'],
      originalUrl: null,
    })
    expect(result).toEqual({
      type: 'video',
      savedUrls: ['https://saved/v.mp4'],
      originalUrl: undefined,
    })
  })

  // ── ProcessingOutputResult ──

  it('parses processing output (taskId + status)', () => {
    const result = parseOutputResult({
      taskId: 'task-123',
      status: 'RUNNING',
    })
    expect(result).toEqual({ type: 'processing', taskId: 'task-123', status: 'RUNNING' })
    expect(isProcessingOutput(result)).toBe(true)
  })

  it('parses processing output with only taskId', () => {
    const result = parseOutputResult({ taskId: 'task-123' })
    expect(result).toEqual({ type: 'processing', taskId: 'task-123', status: undefined })
  })

  it('parses processing output with only status', () => {
    const result = parseOutputResult({ status: 'PENDING' })
    expect(result).toEqual({ type: 'processing', taskId: undefined, status: 'PENDING' })
  })

  it('normalizes non-string taskId/status to undefined', () => {
    const result = parseOutputResult({ taskId: 42, status: null })
    expect(result).toEqual({ type: 'processing', taskId: undefined, status: undefined })
  })

  // ── Priority rules ──

  it('text takes priority over savedUrls', () => {
    const result = parseOutputResult({ text: 'hello', savedUrls: ['url'] })
    expect(result).toEqual({ type: 'text', text: 'hello' })
  })

  it('savedUrls takes priority over taskId/status', () => {
    const result = parseOutputResult({ savedUrls: ['url'], taskId: 't1' })
    expect(result?.savedUrls).toEqual(['url'])
  })

  // ── Explicit type field ──

  it('respects explicit type field for all variants', () => {
    expect(parseOutputResult({ type: 'image', savedUrls: [] })).toEqual({ type: 'image', savedUrls: [], urls: undefined })
    expect(parseOutputResult({ type: 'video', savedUrls: [], originalUrl: 'x' })).toEqual({ type: 'video', savedUrls: [], originalUrl: 'x', video_url: undefined })
    expect(parseOutputResult({ type: 'processing', taskId: 't1' })).toEqual({ type: 'processing', taskId: 't1', status: undefined })
  })

  // ── SubtitleOutputResult ──

  it('parses subtitle output with sentences', () => {
    const sentences = [
      { id: 's1', text: '你好世界', beginTime: 0, endTime: 2000 },
      { id: 's2', text: '欢迎来到这里', beginTime: 2000, endTime: 5000, speakerId: 1 },
    ]
    const result = parseOutputResult({ type: 'subtitle', sentences })
    expect(result).toEqual({
      type: 'subtitle',
      sentences,
      transcriptionUrl: undefined,
    })
    expect(isSubtitleOutput(result)).toBe(true)
  })

  it('parses subtitle output with transcriptionUrl', () => {
    const sentences = [{ id: 's1', text: '测试', beginTime: 100, endTime: 500 }]
    const result = parseOutputResult({
      type: 'subtitle',
      sentences,
      transcriptionUrl: 'https://cdn/transcript.json',
    })
    expect(result).toEqual({
      type: 'subtitle',
      sentences,
      transcriptionUrl: 'https://cdn/transcript.json',
    })
    expect(isSubtitleOutput(result)).toBe(true)
  })

  it('defaults sentences to empty array when not provided', () => {
    const result = parseOutputResult({ type: 'subtitle' })
    expect(result).toEqual({ type: 'subtitle', sentences: [], transcriptionUrl: undefined })
    expect(isSubtitleOutput(result)).toBe(true)
  })

  it('defaults transcriptionUrl to undefined when not a string', () => {
    const sentences = [{ id: 's1', text: 'a', beginTime: 0, endTime: 100 }]
    const result = parseOutputResult({ type: 'subtitle', sentences, transcriptionUrl: null })
    expect(result?.transcriptionUrl).toBeUndefined()
  })
})

// ===== parseCostDetail =====

describe('parseCostDetail', () => {
  it('returns null for null/undefined', () => {
    expect(parseCostDetail(null)).toBeNull()
    expect(parseCostDetail(undefined)).toBeNull()
  })

  it('returns null for non-object', () => {
    expect(parseCostDetail('string')).toBeNull()
  })

  it('returns null for missing required unit field', () => {
    expect(parseCostDetail({ totalPrice: 1 })).toBeNull()
    expect(parseCostDetail({ totalPriceCents: 100 })).toBeNull()
  })

  it('returns null for missing totalPrice and totalPriceCents', () => {
    expect(parseCostDetail({ unit: 'token' })).toBeNull()
  })

  it('defaults unknown unit to token', () => {
    const result = parseCostDetail({ unit: 'other', totalPrice: 5 })
    expect(result?.unit).toBe('token')
  })

  it('parses complete text cost with cents', () => {
    const result = parseCostDetail({
      unit: 'token',
      totalPriceCents: 1,
      totalPrice: 0.01,
      quantity: 1000,
      unitPriceCents: 240,
      unitPrice: 2.4,
      inputTokens: 500,
      outputTokens: 500,
      inputUnitPriceCents: 240,
      inputUnitPrice: 2.4,
      outputUnitPriceCents: 960,
      outputUnitPrice: 9.6,
      inputCostCents: 0.12,
      inputCost: 0.0012,
      outputCostCents: 0.48,
      outputCost: 0.0048,
      estimated: true,
    })
    expect(result).toEqual({
      unit: 'token',
      totalPriceCents: 1,
      totalPrice: 0.01,
      quantity: 1000,
      unitPriceCents: 240,
      unitPrice: 2.4,
      inputTokens: 500,
      outputTokens: 500,
      inputUnitPriceCents: 240,
      inputUnitPrice: 2.4,
      outputUnitPriceCents: 960,
      outputUnitPrice: 9.6,
      inputCostCents: 0.12,
      inputCost: 0.0012,
      outputCostCents: 0.48,
      outputCost: 0.0048,
      resolution: undefined,
      duration: undefined,
      estimated: true,
    })
  })

  it('parses video cost with cents', () => {
    const result = parseCostDetail({
      unit: 'video',
      totalPriceCents: 250,
      totalPrice: 2.5,
      quantity: 5,
      unitPriceCents: 50,
      unitPrice: 0.5,
      resolution: '1080P',
      duration: 5,
    })
    expect(result).toEqual({
      unit: 'video',
      totalPriceCents: 250,
      totalPrice: 2.5,
      quantity: 5,
      unitPriceCents: 50,
      unitPrice: 0.5,
      inputTokens: undefined,
      outputTokens: undefined,
      inputUnitPriceCents: undefined,
      inputUnitPrice: undefined,
      outputUnitPriceCents: undefined,
      outputUnitPrice: undefined,
      inputCostCents: undefined,
      inputCost: undefined,
      outputCostCents: undefined,
      outputCost: undefined,
      resolution: '1080P',
      duration: 5,
      estimated: undefined,
    })
  })

  it('defaults totalPriceCents to 0 and totalPrice to totalPriceCents/100 when missing', () => {
    const result = parseCostDetail({
      unit: 'image',
      totalPriceCents: 25,
    })
    expect(result?.totalPriceCents).toBe(25)
    expect(result?.totalPrice).toBe(0.25)
  })

  it('defaults totalPrice to totalPriceCents/100 when only totalPriceCents present', () => {
    const result = parseCostDetail({
      unit: 'image',
      totalPriceCents: 100,
    })
    expect(result?.totalPrice).toBe(1)
  })

  it('defaults totalPriceCents to 0 when totalPrice is non-number', () => {
    const result = parseCostDetail({
      unit: 'image',
      totalPrice: true,
      totalPriceCents: 'bad',
    })
    expect(result?.totalPriceCents).toBe(0)
    expect(result?.totalPrice).toBe(0)
  })

  it('ignores non-string resolution and non-boolean estimated', () => {
    const result = parseCostDetail({
      unit: 'video',
      totalPriceCents: 250,
      totalPrice: 2.5,
      resolution: 1080,
      estimated: 'yes',
    })
    expect(result?.resolution).toBeUndefined()
    expect(result?.estimated).toBeUndefined()
  })

  // ── audio 计费 ──

  it('parses audio cost with duration and unitPrice', () => {
    const result = parseCostDetail({
      unit: 'audio',
      totalPriceCents: 0.48,
      totalPrice: 0.0048,
      duration: 60,
      unitPriceCents: 0.008,
      unitPrice: 0.00008,
    })
    expect(result).toEqual({
      unit: 'audio',
      totalPriceCents: 0.48,
      totalPrice: 0.0048,
      quantity: undefined,
      unitPriceCents: 0.008,
      unitPrice: 0.00008,
      inputTokens: undefined,
      outputTokens: undefined,
      inputUnitPriceCents: undefined,
      inputUnitPrice: undefined,
      outputUnitPriceCents: undefined,
      outputUnitPrice: undefined,
      inputCostCents: undefined,
      inputCost: undefined,
      outputCostCents: undefined,
      outputCost: undefined,
      resolution: undefined,
      duration: 60,
      estimated: undefined,
    })
  })

  it('parses audio cost with estimated flag', () => {
    const result = parseCostDetail({
      unit: 'audio',
      totalPriceCents: 0.48,
      duration: 60,
      unitPriceCents: 0.008,
      estimated: true,
    })
    expect(result?.unit).toBe('audio')
    expect(result?.duration).toBe(60)
    expect(result?.estimated).toBe(true)
    expect(result?.totalPrice).toBe(0.0048)
  })
})

// ===== Type guards =====

describe('OutputResult type guards', () => {
  it('isTextOutput', () => {
    expect(isTextOutput({ type: 'text', text: 'hi' })).toBe(true)
    expect(isTextOutput({ type: 'image', savedUrls: ['url'] })).toBe(false)
    expect(isTextOutput(null)).toBe(false)
  })

  it('isImageOutput', () => {
    expect(isImageOutput({ type: 'image', savedUrls: ['url'], urls: ['url2'] })).toBe(true)
    expect(isImageOutput({ type: 'image', savedUrls: ['url'] })).toBe(true)
    expect(isImageOutput({ type: 'video', savedUrls: ['url'], originalUrl: 'x' })).toBe(false) // video, not image
    expect(isImageOutput(null)).toBe(false)
  })

  it('isVideoOutput', () => {
    expect(isVideoOutput({ type: 'video', savedUrls: ['url'], originalUrl: 'x' })).toBe(true)
    expect(isVideoOutput({ type: 'video', savedUrls: ['url'], video_url: 'x' })).toBe(true)
    expect(isVideoOutput({ type: 'image', savedUrls: ['url'] })).toBe(false) // image, not video
    expect(isVideoOutput(null)).toBe(false)
  })

  it('isProcessingOutput', () => {
    expect(isProcessingOutput({ type: 'processing', taskId: 't1', status: 'RUNNING' })).toBe(true)
    expect(isProcessingOutput({ type: 'processing', taskId: 't1' })).toBe(true)
    expect(isProcessingOutput({ type: 'image', savedUrls: ['url'], taskId: 't1' })).toBe(false) // not processing
    expect(isProcessingOutput(null)).toBe(false)
  })

  it('isSubtitleOutput', () => {
    const sentences = [{ id: 's1', text: '你好', beginTime: 0, endTime: 2000 }]
    expect(isSubtitleOutput({ type: 'subtitle', sentences })).toBe(true)
    expect(isSubtitleOutput({ type: 'subtitle', sentences, transcriptionUrl: 'url' })).toBe(true)
    expect(isSubtitleOutput({ type: 'text', text: '你好' })).toBe(false) // text, not subtitle
    expect(isSubtitleOutput({ type: 'image', savedUrls: ['url'] })).toBe(false) // image, not subtitle
    expect(isSubtitleOutput(null)).toBe(false)
    expect(isSubtitleOutput(undefined)).toBe(false)
  })
})
