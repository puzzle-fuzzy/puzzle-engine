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
  /** 失败/取消任务的成本汇总（审计用，不计入账单） */
  auditFailedCents: number
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
