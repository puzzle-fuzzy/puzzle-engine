import { greet } from '@puzzle-engine/shared'
import { describe, expect, it } from 'bun:test'

describe('shared', () => {
  it('greet should return formatted greeting', () => {
    expect(greet('World')).toBe('Hello, World!')
  })
})
