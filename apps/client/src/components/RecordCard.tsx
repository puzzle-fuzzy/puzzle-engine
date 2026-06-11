import type { GenerationRecord, ModelConfig } from '@/api/client'
import type { Category } from '@/pages/workspace-utils'
import { isImageOutput, isTextOutput, isVideoOutput } from '@excuse/shared'
import currency from 'currency.js'
import {
  Copy,
  Download,
  FileText,
  Trash2,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { CATEGORY_CONFIG, formatDuration, formatTime, HIDDEN_PARAMS, isImageUrl, isUrl, isVideoUrl, STATUS_CONFIG } from '@/pages/workspace-utils'

interface RecordCardProps {
  record: GenerationRecord
  models: ModelConfig[]
  expanded: boolean
  copied: boolean
  onToggleExpand: (id: string) => void
  onCopyPrompt: (id: string, text: string) => void
  onRegenerate: (record: GenerationRecord) => void
  onDelete: (id: string) => void
  onPreview: (url: string) => void
}

export default function RecordCard({
  record,
  models,
  expanded,
  copied,
  onToggleExpand,
  onCopyPrompt,
  onRegenerate,
  onDelete,
  onPreview,
}: RecordCardProps) {
  const statusCfg = STATUS_CONFIG[record.status] || STATUS_CONFIG.pending
  const StatusIcon = statusCfg.icon
  const catCfg = CATEGORY_CONFIG[record.category as Category]
  const CatIcon = catCfg?.icon || FileText
  const modelConfig = models.find(m => m.id === record.model)
  const modelDisplayName = modelConfig?.name || record.model
  const prompt = String(record.inputParams?.prompt || '')
  const visibleParams = Object.entries(record.inputParams || {}).filter(
    ([k, v]) => !HIDDEN_PARAMS.has(k) && v != null && v !== '' && v !== undefined,
  )
  const mediaUrlParams = Object.entries(record.inputParams || {}).filter(
    ([, v]) => isUrl(v),
  )
  const isPending = record.status === 'pending' || record.status === 'processing'
  const duration = formatDuration(record.createdAt, isPending ? null : record.updatedAt)

  // 获取下载用的 savedUrls（image 或 video 输出）
  const downloadUrls = record.outputResult
    && (isImageOutput(record.outputResult) || isVideoOutput(record.outputResult))
    ? (isImageOutput(record.outputResult) ? record.outputResult.savedUrls : record.outputResult.savedUrls)
    : null

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-3">
        {/* 头部：模型名 + 状态 + 时间 */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <CatIcon className={`size-4 shrink-0 ${catCfg?.color?.replace('bg-', 'text-')}`} />
            <span className="text-sm font-medium truncate">{modelDisplayName}</span>
            <Badge variant="secondary" className={`text-[10px] shrink-0 ${statusCfg.color}`}>
              <StatusIcon className={`mr-1 size-3 ${record.status === 'processing' ? 'animate-spin' : ''}`} />
              {statusCfg.label}
            </Badge>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {(isPending || record.status === 'succeeded') && (
              <span className={`text-[10px] text-muted-foreground ${isPending ? 'animate-pulse' : ''}`}>
                {duration}
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              {formatTime(record.createdAt)}
            </span>
          </div>
        </div>

        {/* Prompt */}
        {prompt && (
          <div className="mt-2">
            <div className="flex items-center gap-1">
              <p className={`flex-1 text-xs text-muted-foreground ${expanded ? '' : 'line-clamp-2'}`}>
                {prompt}
              </p>
              <div className="flex shrink-0 gap-0.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="size-6 p-0 text-muted-foreground hover:text-foreground"
                  onClick={() => onCopyPrompt(record.id, prompt)}
                  title="复制提示词"
                >
                  <Copy className="size-3" />
                </Button>
                {prompt.length > 80 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => onToggleExpand(record.id)}
                  >
                    {expanded ? '收起' : '展开'}
                  </Button>
                )}
              </div>
            </div>
            {copied && (
              <p className="text-[10px] text-green-600">已复制</p>
            )}
          </div>
        )}

        {/* 参数标签 */}
        {visibleParams.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {visibleParams.map(([key, val]) => (
              <Badge key={key} variant="outline" className="text-[10px]">
                {key}
                :
                {String(val).slice(0, 30)}
              </Badge>
            ))}
          </div>
        )}

        {/* 费用 */}
        {record.cost && (
          <div className="mt-1.5 text-xs text-muted-foreground space-y-0.5">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5">
              {record.cost.unit && (
                <span>
                  {'计费: '}
                  {record.cost.unit}
                </span>
              )}
              {record.cost.quantity != null && (
                <span>
                  {'数量: '}
                  {record.cost.quantity}
                </span>
              )}
              {record.cost.unitPrice != null && (
                <span>
                  单价: ¥
                  {Number(record.cost.unitPrice).toFixed(4)}
                </span>
              )}
              {record.cost.inputTokens != null && (
                <span>
                  {'输入 Tokens: '}
                  {record.cost.inputTokens}
                </span>
              )}
              {record.cost.outputTokens != null && (
                <span>
                  {'输出 Tokens: '}
                  {record.cost.outputTokens}
                </span>
              )}
              {record.cost.resolution && (
                <span>
                  {'分辨率: '}
                  {record.cost.resolution}
                </span>
              )}
              {record.cost.duration != null && (
                <span>
                  {'时长: '}
                  {record.cost.duration}
                  s
                </span>
              )}
            </div>
            {record.cost.totalPriceCents != null && (
              <p className="font-medium text-foreground">
                总计: ¥
                {currency(record.cost.totalPriceCents, { fromCents: true, precision: 4 }).format()}
                {record.cost.estimated && ' (预估)'}
              </p>
            )}
          </div>
        )}

        {/* 参考素材 */}
        {mediaUrlParams.length > 0 && (
          <div className="mt-2">
            <p className="mb-1 text-[10px] font-medium text-muted-foreground">参考素材</p>
            <div className="flex gap-1.5 flex-wrap">
              {mediaUrlParams.map(([key, url]) => {
                const u = url as string
                if (isImageUrl(u)) {
                  return (
                    <img
                      key={key}
                      src={u}
                      alt={key}
                      className="size-16 cursor-pointer rounded border object-cover hover:opacity-80 transition-opacity"
                      onClick={() => onPreview(u)}
                    />
                  )
                }
                if (isVideoUrl(u)) {
                  return (
                    <video key={key} src={u} className="w-full max-w-xs rounded-lg border" controls />
                  )
                }
                return (
                  <Badge key={key} variant="outline" className="text-[10px]">
                    {key}
                    :
                    {u.slice(0, 30)}
                  </Badge>
                )
              })}
            </div>
          </div>
        )}

        {/* 输出预览 */}
        {record.outputResult && (
          <div className="mt-2">
            {isImageOutput(record.outputResult) && (
              <div className="flex gap-2 flex-wrap">
                {record.outputResult.savedUrls.map(url => (
                  <img
                    key={url}
                    src={url}
                    alt="生成图片"
                    className="size-28 cursor-pointer rounded-lg border object-cover hover:opacity-80 transition-opacity"
                    onClick={() => onPreview(url)}
                  />
                ))}
              </div>
            )}
            {isTextOutput(record.outputResult) && (
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-muted p-2 text-xs">
                {record.outputResult.text}
              </pre>
            )}
            {isVideoOutput(record.outputResult) && (
              <div className="flex gap-2">
                {record.outputResult.savedUrls.map(url => (
                  <video
                    key={url}
                    src={url}
                    className="w-full max-w-xs rounded-lg border aspect-video object-cover"
                    controls
                    loop
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* 错误信息 */}
        {record.status === 'failed' && record.errorMessage && (
          <p className="mt-2 text-xs text-destructive">{record.errorMessage}</p>
        )}

        {/* 操作按钮 */}
        <div className="mt-2 flex gap-2">
          {downloadUrls && downloadUrls.map((url, i) => (
            <Button key={url} variant="outline" size="sm" asChild>
              <a href={url} download>
                <Download className="size-3" />
                {downloadUrls.length > 1 ? `下载 ${i + 1}` : '下载'}
              </a>
            </Button>
          ))}
          {record.status === 'failed' && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onRegenerate(record)}
            >
              <RotateRcw className="size-3" />
              重新生成
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto text-muted-foreground hover:text-destructive"
            onClick={() => onDelete(record.id)}
          >
            <Trash2 className="size-3" />
            删除
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
