// ===== 计费相关类型定义 =====

export interface BillingStatistics {
  totalCents: number
  total: number // 向后兼容
  todayCents: number
  today: number // 向后兼容
  weekCents: number
  week: number // 向后兼容
  monthCents: number
  month: number // 向后兼容
  byCategory: CategoryBreakdown[]
  byModel: ModelBreakdown[]
  dailyTrend: DailyTrendItem[]
}

export interface CategoryBreakdown {
  category: string
  totalCents: number
  total: number // 向后兼容
  percentage: number
}

export interface ModelBreakdown {
  model: string
  totalCents: number
  total: number // 向后兼容
  percentage: number
}

export interface DailyTrendItem {
  date: string
  totalCents: number
  total: number // 向后兼容
}
