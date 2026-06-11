import type { CostDetail } from '@excuse/shared'
import type { CostRecord } from '../src/statistics'
import { describe, expect, it } from 'bun:test'
import { aggregateStatistics } from '../src/statistics'

// ── 辅助：创建测试用 CostRecord ─────────────────────────────

function makeRecord(overrides: Partial<CostRecord> & { model: string, category: string }): CostRecord {
  return {
    cost: { unit: 'token', totalPriceCents: 0, totalPrice: 0 } as CostDetail,
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

function daysAgo(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString()
}

// ── aggregateStatistics ───────────────────────────────────

describe('aggregateStatistics', () => {
  it('空记录返回全零 + 空分类 + 空模型 + 30天零趋势', () => {
    const stats = aggregateStatistics([])

    expect(stats.total).toBe(0)
    expect(stats.totalCents).toBe(0)
    expect(stats.today).toBe(0)
    expect(stats.week).toBe(0)
    expect(stats.month).toBe(0)
    expect(stats.byCategory).toEqual([])
    expect(stats.byModel).toEqual([])
    expect(stats.dailyTrend).toHaveLength(30)
    expect(stats.dailyTrend.every(d => d.total === 0)).toBe(true)
  })

  it('正确聚合 total/today/week/month（分→元）', () => {
    const records: CostRecord[] = [
      makeRecord({ model: 'm1', category: 'text', cost: { unit: 'token', totalPriceCents: 150, totalPrice: 1.5 }, createdAt: new Date().toISOString() }),
      makeRecord({ model: 'm2', category: 'image', cost: { unit: 'image', totalPriceCents: 200, totalPrice: 2 }, createdAt: daysAgo(3) }),
      makeRecord({ model: 'm3', category: 'video', cost: { unit: 'video', totalPriceCents: 350, totalPrice: 3.5 }, createdAt: daysAgo(8) }),
      makeRecord({ model: 'm4', category: 'text', cost: { unit: 'token', totalPriceCents: 400, totalPrice: 4 }, createdAt: daysAgo(35) }),
    ]

    const stats = aggregateStatistics(records)

    // 150+200+350+400 = 1100分 = 11元
    expect(stats.totalCents).toBe(1100)
    expect(stats.total).toBe(11)
    expect(stats.todayCents).toBe(150)
    expect(stats.today).toBe(1.5)
    expect(stats.weekCents).toBe(350) // today(150) + 3天前(200)，8天前超出本周
    expect(stats.week).toBe(3.5)
    expect(stats.monthCents).toBe(700) // today(150) + 3天前(200) + 8天前(350)
    expect(stats.month).toBe(7)
  })

  it('cost 为 null 或缺少 totalPriceCents 时视为 0', () => {
    const records: CostRecord[] = [
      makeRecord({ model: 'm1', category: 'text', cost: null }),
      makeRecord({ model: 'm2', category: 'text', cost: {} as CostDetail }),
    ]

    const stats = aggregateStatistics(records)

    expect(stats.total).toBe(0)
    expect(stats.totalCents).toBe(0)
    expect(stats.byCategory).toEqual([{ category: 'text', totalCents: 0, total: 0, percentage: 0 }])
  })

  it('按类别聚合并计算百分比（分→元）', () => {
    const records: CostRecord[] = [
      makeRecord({ model: 'm1', category: 'text', cost: { unit: 'token', totalPriceCents: 300, totalPrice: 3 } }),
      makeRecord({ model: 'm2', category: 'text', cost: { unit: 'token', totalPriceCents: 200, totalPrice: 2 } }),
      makeRecord({ model: 'm3', category: 'image', cost: { unit: 'image', totalPriceCents: 500, totalPrice: 5 } }),
    ]

    const stats = aggregateStatistics(records)

    // image: 500分=5元, text: 500分=5元 → 各 50%
    expect(stats.byCategory).toHaveLength(2)
    expect(stats.byCategory.find(c => c.category === 'image')!.percentage).toBe(50)
    expect(stats.byCategory.find(c => c.category === 'image')!.totalCents).toBe(500)
    expect(stats.byCategory.find(c => c.category === 'text')!.percentage).toBe(50)
  })

  it('按类别排序（降序）', () => {
    const records: CostRecord[] = [
      makeRecord({ model: 'm1', category: 'text', cost: { unit: 'token', totalPriceCents: 100, totalPrice: 1 } }),
      makeRecord({ model: 'm2', category: 'image', cost: { unit: 'image', totalPriceCents: 500, totalPrice: 5 } }),
      makeRecord({ model: 'm3', category: 'video', cost: { unit: 'video', totalPriceCents: 300, totalPrice: 3 } }),
    ]

    const stats = aggregateStatistics(records)
    const categories = stats.byCategory.map(c => c.category)

    expect(categories).toEqual(['image', 'video', 'text'])
  })

  it('按模型聚合并计算百分比', () => {
    const records: CostRecord[] = [
      makeRecord({ model: 'qwen-max', category: 'text', cost: { unit: 'token', totalPriceCents: 800, totalPrice: 8 } }),
      makeRecord({ model: 'qwen-plus', category: 'text', cost: { unit: 'token', totalPriceCents: 200, totalPrice: 2 } }),
    ]

    const stats = aggregateStatistics(records)

    expect(stats.byModel).toHaveLength(2)
    expect(stats.byModel.find(m => m.model === 'qwen-max')!.percentage).toBe(80)
    expect(stats.byModel.find(m => m.model === 'qwen-max')!.totalCents).toBe(800)
    expect(stats.byModel.find(m => m.model === 'qwen-plus')!.percentage).toBe(20)
  })

  it('按模型排序（降序）', () => {
    const records: CostRecord[] = [
      makeRecord({ model: 'cheap', category: 'text', cost: { unit: 'token', totalPriceCents: 100, totalPrice: 1 } }),
      makeRecord({ model: 'expensive', category: 'text', cost: { unit: 'token', totalPriceCents: 1000, totalPrice: 10 } }),
    ]

    const stats = aggregateStatistics(records)
    const models = stats.byModel.map(m => m.model)

    expect(models).toEqual(['expensive', 'cheap'])
  })

  it('生成最近 30 天的日趋势（填充空白天）', () => {
    const today = new Date().toISOString().slice(0, 10)
    const records: CostRecord[] = [
      makeRecord({ model: 'm1', category: 'text', cost: { unit: 'token', totalPriceCents: 150, totalPrice: 1.5 }, createdAt: new Date().toISOString() }),
    ]

    const stats = aggregateStatistics(records)

    expect(stats.dailyTrend).toHaveLength(30)
    expect(stats.dailyTrend[29]!.date).toBe(today)
    expect(stats.dailyTrend[29]!.totalCents).toBe(150)
    expect(stats.dailyTrend[29]!.total).toBe(1.5)
    expect(stats.dailyTrend.slice(0, 29).every(d => d.total === 0)).toBe(true)
  })

  it('同一日期的多条记录合并（分→元）', () => {
    const today = new Date().toISOString()
    const records: CostRecord[] = [
      makeRecord({ model: 'm1', category: 'text', cost: { unit: 'token', totalPriceCents: 100, totalPrice: 1 }, createdAt: today }),
      makeRecord({ model: 'm2', category: 'image', cost: { unit: 'image', totalPriceCents: 200, totalPrice: 2 }, createdAt: today }),
      makeRecord({ model: 'm3', category: 'video', cost: { unit: 'video', totalPriceCents: 300, totalPrice: 3 }, createdAt: today }),
    ]

    const stats = aggregateStatistics(records)

    // 100+200+300 = 600分 = 6元
    expect(stats.todayCents).toBe(600)
    expect(stats.today).toBe(6)
    const todayTrend = stats.dailyTrend[29]!
    expect(todayTrend.totalCents).toBe(600)
    expect(todayTrend.total).toBe(6)
  })

  it('createdAt 使用 Date 对象也能正常工作', () => {
    const records: CostRecord[] = [
      makeRecord({ model: 'm1', category: 'text', cost: { unit: 'token', totalPriceCents: 500, totalPrice: 5 }, createdAt: new Date() }),
    ]

    const stats = aggregateStatistics(records)

    expect(stats.todayCents).toBe(500)
    expect(stats.today).toBe(5)
    expect(stats.total).toBe(5)
  })

  it('currency.js 保证整数分累加精度', () => {
    const records: CostRecord[] = [
      makeRecord({ model: 'm1', category: 'text', cost: { unit: 'token', totalPriceCents: 10, totalPrice: 0.1 } }),
      makeRecord({ model: 'm2', category: 'text', cost: { unit: 'token', totalPriceCents: 15, totalPrice: 0.15 } }),
    ]

    const stats = aggregateStatistics(records)

    // 10+15 = 25分 = 0.25元
    expect(stats.totalCents).toBe(25)
    expect(stats.total).toBe(0.25)
  })
})