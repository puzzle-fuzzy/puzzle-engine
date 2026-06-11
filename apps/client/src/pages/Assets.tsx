import type { GenerationRecord } from '@/api/client'
import { isImageOutput, isTextOutput, isVideoOutput } from '@excuse/shared'
import currency from 'currency.js'
import {
  Download,
  FileText,
  FolderOpen,
  ImageIcon,
  Layers,
  Video,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { fetchRecords } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'

type FilterType = 'all' | 'image' | 'video' | 'text'

const TYPE_ICONS = {
  image: ImageIcon,
  video: Video,
  text: FileText,
}

export default function Assets() {
  const [records, setRecords] = useState<GenerationRecord[]>([])
  const [filter, setFilter] = useState<FilterType>('all')
  const [previewRecord, setPreviewRecord] = useState<GenerationRecord | null>(null)

  const loadRecords = useCallback(async () => {
    try {
      const data = await fetchRecords({ limit: 200 })
      setRecords(data.records.filter(r => r.status === 'succeeded'))
    }
    catch {
      toast.error('加载资产列表失败')
    }
  }, [])

  useEffect(() => {
    loadRecords()
  }, [loadRecords])

  const filtered = filter === 'all' ? records : records.filter(r => r.category === filter)

  const stats = {
    total: records.length,
    image: records.filter(r => r.category === 'image').length,
    video: records.filter(r => r.category === 'video').length,
    text: records.filter(r => r.category === 'text').length,
  }

  return (
    <div className="mx-auto max-w-7xl p-4 space-y-6">
      {/* 标题 */}
      <div className="flex items-center gap-2">
        <FolderOpen className="size-5" />
        <h1 className="text-lg font-semibold">资产库</h1>
      </div>

      {/* 统计卡片 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: '全部', count: stats.total, value: 'all' as FilterType, icon: Layers },
          { label: '图片', count: stats.image, value: 'image' as FilterType, icon: ImageIcon },
          { label: '视频', count: stats.video, value: 'video' as FilterType, icon: Video },
          { label: '文本', count: stats.text, value: 'text' as FilterType, icon: FileText },
        ].map(({ label, count, value, icon: Icon }) => (
          <Card
            key={value}
            className={`cursor-pointer transition-colors ${filter === value ? 'ring-2 ring-primary' : ''}`}
            onClick={() => setFilter(value)}
          >
            <CardContent className="flex items-center gap-3 p-4">
              <Icon className="size-5 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{count}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* 筛选栏 */}
      <div className="flex gap-2">
        {(['all', 'image', 'video', 'text'] as FilterType[]).map(type => (
          <Button
            key={type}
            variant={filter === type ? 'default' : 'outline'}
            size="sm"
            onClick={() => setFilter(type)}
          >
            {type === 'all' ? '全部' : type === 'image' ? '图片' : type === 'video' ? '视频' : '文本'}
          </Button>
        ))}
      </div>

      {/* 资产网格 */}
      {filtered.length === 0
        ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <FolderOpen className="mb-2 size-10" />
              <p>暂无资产</p>
            </div>
          )
        : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {filtered.map((record) => {
                const Icon = TYPE_ICONS[record.category as keyof typeof TYPE_ICONS] || FileText
                const urls = getAssetUrls(record)

                return (
                  <Card
                    key={record.id}
                    className="group cursor-pointer overflow-hidden transition-shadow hover:shadow-md"
                    onClick={() => setPreviewRecord(record)}
                  >
                    <div className="relative aspect-video bg-muted">
                      {record.category === 'image' && urls[0] && (
                        <img src={urls[0]} alt="" className="size-full object-cover" />
                      )}
                      {record.category === 'video' && urls[0] && (
                        <div className="relative size-full">
                          <video src={urls[0]} className="size-full object-cover" />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                            <Video className="size-6 text-white" />
                          </div>
                        </div>
                      )}
                      {record.category === 'text' && (
                        <div className="flex size-full items-center justify-center">
                          <FileText className="size-8 text-muted-foreground" />
                        </div>
                      )}
                      <Badge variant="secondary" className="absolute left-1.5 top-1.5 text-[10px]">
                        <Icon className="mr-1 size-3" />
                        {record.category === 'image' ? '图片' : record.category === 'video' ? '视频' : '文本'}
                      </Badge>
                    </div>
                    <CardContent className="p-2">
                      <p className="text-xs font-medium truncate">{record.model}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {new Date(record.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    </CardContent>
                  </Card>
                )
              })}
            </div>
          )}

      {/* 预览弹窗 */}
      {previewRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreviewRecord(null)}>
          <div className="relative max-h-[90vh] max-w-[90vw] space-y-3 rounded-xl bg-background p-4" onClick={e => e.stopPropagation()}>
            <button
              className="absolute right-2 top-2 z-10 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
              onClick={() => setPreviewRecord(null)}
            >
              <X className="size-4" />
            </button>

            {/* 媒体内容 */}
            {previewRecord.category === 'image' && getAssetUrls(previewRecord)[0] && (
              <img
                src={getAssetUrls(previewRecord)[0]}
                alt=""
                className="max-h-[70vh] rounded-lg object-contain"
              />
            )}
            {previewRecord.category === 'video' && getAssetUrls(previewRecord)[0] && (
              <video
                src={getAssetUrls(previewRecord)[0]}
                controls
                loop
                className="max-h-[70vh] rounded-lg"
              />
            )}
            {previewRecord.category === 'text' && isTextOutput(previewRecord.outputResult) && (
              <div className="max-h-[70vh] overflow-auto rounded-lg bg-muted p-4">
                <p className="text-sm whitespace-pre-wrap">{previewRecord.outputResult.text}</p>
              </div>
            )}

            {/* 信息 */}
            <div className="space-y-1">
              <p className="text-sm font-medium">{previewRecord.model}</p>
              <p className="text-xs text-muted-foreground">
                Prompt:
                {' '}
                {String(previewRecord.inputParams?.prompt || '').slice(0, 200)}
              </p>
              {previewRecord.cost?.totalPriceCents != null && (
                <p className="text-xs text-muted-foreground">
                  费用: ¥
                  {currency(previewRecord.cost.totalPriceCents, { fromCents: true, precision: 4 }).format()}
                </p>
              )}
            </div>

            {/* 下载 */}
            {getAssetUrls(previewRecord)[0] && (
              <a href={getAssetUrls(previewRecord)[0]} download className="inline-flex">
                <Button variant="outline" size="sm">
                  <Download className="size-3" />
                  下载
                </Button>
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function getAssetUrls(record: GenerationRecord): string[] {
  const output = record.outputResult
  if (!output)
    return []
  if (isImageOutput(output) && output.savedUrls.length > 0)
    return output.savedUrls
  if (isVideoOutput(output) && output.savedUrls.length > 0)
    return output.savedUrls
  // Image output may have raw `urls` before download-and-save completed
  if (isImageOutput(output) && output.urls?.length)
    return output.urls
  return []
}
