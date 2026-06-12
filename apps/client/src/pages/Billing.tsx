import type { BillingStatistics } from '@/api/client'
import { Calendar, CalendarDays, DollarSign, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { fetchBillingStatistics } from '@/api/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatCents } from '@/lib/generation-utils'

const CATEGORY_LABELS: Record<string, string> = {
  text: '文本生成',
  image: '图像生成',
  video: '视频生成',
  audio: '音频生成',
}

const CATEGORY_COLORS: Record<string, string> = {
  text: 'bg-blue-500',
  image: 'bg-purple-500',
  video: 'bg-pink-500',
  audio: 'bg-green-500',
}

export default function Billing() {
  const [stats, setStats] = useState<BillingStatistics | null>(null)

  useEffect(() => {
    fetchBillingStatistics().then((data) => {
      if (data.success)
        setStats(data.statistics)
    }).catch(() => { toast.error('加载费用统计失败') })
  }, [])

  if (!stats) {
    return (
      <div className="mx-auto max-w-7xl p-4">
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          加载中...
        </div>
      </div>
    )
  }

  const overviewCards = [
    { label: '总额', valueCents: stats.totalCents, icon: DollarSign },
    { label: '今日', valueCents: stats.todayCents, icon: TrendingUp },
    { label: '本周', valueCents: stats.weekCents, icon: CalendarDays },
    { label: '本月', valueCents: stats.monthCents, icon: Calendar },
  ]

  return (
    <div className="mx-auto max-w-7xl p-4 space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <DollarSign className="size-5" />
        <h1 className="text-lg font-semibold">费用统计</h1>
      </div>

      {/* 概览卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {overviewCards.map(({ label, valueCents, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">
                  ¥
                  {formatCents(valueCents)}
                </p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 类别分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">类别分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.byCategory.length === 0
              ? (
                  <p className="text-sm text-muted-foreground">暂无数据</p>
                )
              : (
                  stats.byCategory.map(item => (
                    <div key={item.category} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span>{CATEGORY_LABELS[item.category] || item.category}</span>
                        <span className="text-muted-foreground">
                          ¥
                          {formatCents(item.totalCents, 4)}
                          {' '}
                          (
                          {item.percentage}
                          %)
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full ${CATEGORY_COLORS[item.category] || 'bg-gray-500'}`}
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
          </CardContent>
        </Card>

        {/* 模型分布 */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">模型分布</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {stats.byModel.length === 0
              ? (
                  <p className="text-sm text-muted-foreground">暂无数据</p>
                )
              : (
                  stats.byModel.map(item => (
                    <div key={item.model} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="truncate">{item.model}</span>
                        <span className="text-muted-foreground">
                          ¥
                          {formatCents(item.totalCents, 4)}
                          {' '}
                          (
                          {item.percentage}
                          %)
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${item.percentage}%` }}
                        />
                      </div>
                    </div>
                  ))
                )}
          </CardContent>
        </Card>
      </div>

      {/* 30天趋势 */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">30 天趋势</CardTitle>
        </CardHeader>
        <CardContent>
          {stats.dailyTrend.every(d => d.totalCents === 0)
            ? (
                <p className="text-sm text-muted-foreground">暂无数据</p>
              )
            : (
                <div className="flex items-end gap-1 h-32">
                  {stats.dailyTrend.map((item) => {
                    const maxCents = Math.max(...stats.dailyTrend.map(d => d.totalCents), 1)
                    const height = Math.max((item.totalCents / maxCents) * 100, 1)
                    return (
                      <div
                        key={item.date}
                        className="group relative flex-1 rounded-t bg-primary/20 hover:bg-primary/40 transition-colors"
                        style={{ height: `${height}%` }}
                        title={`${item.date}: ¥${formatCents(item.totalCents, 4)}`}
                      >
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 hidden group-hover:block whitespace-nowrap rounded bg-black/80 px-1.5 py-0.5 text-[10px] text-white">
                          ¥
                          {formatCents(item.totalCents)}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
        </CardContent>
      </Card>
    </div>
  )
}
