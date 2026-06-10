import type { BillingStatistics, CategoryBreakdown, DailyTrendItem, ModelBreakdown } from '@excuse/shared'

interface CostRecord {
  model: string
  category: string
  cost: Record<string, unknown> | null
  createdAt: string | Date
}

/**
 * 从生成记录列表中聚合统计计费数据
 */
export function aggregateStatistics(records: CostRecord[]): BillingStatistics {
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const weekStart = new Date(todayStart)
  weekStart.setDate(weekStart.getDate() - 7)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  let total = 0
  let today = 0
  let week = 0
  let month = 0

  const categoryMap = new Map<string, number>()
  const modelMap = new Map<string, number>()
  const dailyMap = new Map<string, number>()

  for (const record of records) {
    const price = typeof record.cost?.totalPrice === 'number' ? record.cost.totalPrice : 0

    total += price

    const recordDate = new Date(record.createdAt)
    if (recordDate >= todayStart) {
      today += price
    }
    if (recordDate >= weekStart) {
      week += price
    }
    if (recordDate >= monthStart) {
      month += price
    }

    // 按类别聚合
    const categoryTotal = categoryMap.get(record.category) || 0
    categoryMap.set(record.category, categoryTotal + price)

    // 按模型聚合
    const modelTotal = modelMap.get(record.model) || 0
    modelMap.set(record.model, modelTotal + price)

    // 按日期聚合（最近 30 天）
    const dayKey = recordDate.toISOString().slice(0, 10)
    const dayTotal = dailyMap.get(dayKey) || 0
    dailyMap.set(dayKey, dayTotal + price)
  }

  const byCategory: CategoryBreakdown[] = Array.from(categoryMap.entries())
    .map(([category, catTotal]) => ({
      category,
      total: roundTo4(catTotal),
      percentage: total > 0 ? Math.round((catTotal / total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  const byModel: ModelBreakdown[] = Array.from(modelMap.entries())
    .map(([model, modelTotal]) => ({
      model,
      total: roundTo4(modelTotal),
      percentage: total > 0 ? Math.round((modelTotal / total) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  // 生成最近 30 天的趋势（填充空白天）
  const dailyTrend: DailyTrendItem[] = []
  for (let i = 29; i >= 0; i--) {
    const date = new Date(todayStart)
    date.setDate(date.getDate() - i)
    const key = date.toISOString().slice(0, 10)
    dailyTrend.push({
      date: key,
      total: roundTo4(dailyMap.get(key) || 0),
    })
  }

  return {
    total: roundTo4(total),
    today: roundTo4(today),
    week: roundTo4(week),
    month: roundTo4(month),
    byCategory,
    byModel,
    dailyTrend,
  }
}

function roundTo4(n: number): number {
  return Math.round(n * 10000) / 10000
}
