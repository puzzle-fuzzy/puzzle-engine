// ===== 计费相关类型定义 =====

export interface BillingStatistics {
  total: number
  today: number
  week: number
  month: number
  byCategory: CategoryBreakdown[]
  byModel: ModelBreakdown[]
  dailyTrend: DailyTrendItem[]
}

export interface CategoryBreakdown {
  category: string
  total: number
  percentage: number
}

export interface ModelBreakdown {
  model: string
  total: number
  percentage: number
}

export interface DailyTrendItem {
  date: string
  total: number
}
