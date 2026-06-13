import { describe, expect, it } from 'bun:test'
import {
  burnSubtitlesToVideo,
  checkFFmpegAsync,
  extractAudioFromVideo,
  getMediaDurationMs,
  getVideoResolution,
} from '../src'

describe('@excuse/ffmpeg exports', () => {
  it('exposes media probing and processing functions', () => {
    expect(typeof checkFFmpegAsync).toBe('function')
    expect(typeof extractAudioFromVideo).toBe('function')
    expect(typeof getMediaDurationMs).toBe('function')
    expect(typeof getVideoResolution).toBe('function')
    expect(typeof burnSubtitlesToVideo).toBe('function')
  })
})
