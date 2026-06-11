import type { GenerateResponse, GenerationRecord, ModelConfig, ModelParameter } from '@/api/client'
import { isImageOutput, isTextOutput, isVideoOutput } from '@excuse/shared'
import currency from 'currency.js'
import {
  CheckCircle2,
  Clock,
  Copy,
  Download,
  FileText,
  FolderOpen,
  ImageIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  Trash2,
  Upload,
  Video,
  X,
  XCircle,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  deleteRecord,
  fetchModels,
  generate,
  uploadFile,
} from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useGenerationStore } from '@/stores/generation'

const CATEGORY_CONFIG = {
  text: { label: '文本生成', color: 'bg-blue-500', icon: FileText, activeColor: 'bg-blue-500 text-white' },
  image: { label: '图像生成', color: 'bg-purple-500', icon: ImageIcon, activeColor: 'bg-purple-500 text-white' },
  video: { label: '视频生成', color: 'bg-pink-500', icon: Video, activeColor: 'bg-pink-500 text-white' },
} as const

type Category = keyof typeof CATEGORY_CONFIG

const STATUS_CONFIG: Record<string, { label: string, color: string, icon: typeof Clock }> = {
  pending: { label: '等待中', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  processing: { label: '处理中', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  succeeded: { label: '已完成', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  failed: { label: '失败', color: 'bg-red-100 text-red-700', icon: XCircle },
}

/** 格式化时间为相对时间 + 完整日期 */
function formatTime(iso: string) {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffHour = Math.floor(diffMs / 3600000)
  const diffDay = Math.floor(diffMs / 86400000)
  const dateStr = date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  if (diffMin < 1)
    return `刚刚 ${dateStr}`
  if (diffMin < 60)
    return `${diffMin} 分钟前 ${dateStr}`
  if (diffHour < 24)
    return `${diffHour} 小时前 ${dateStr}`
  if (diffDay < 7)
    return `${diffDay} 天前 ${dateStr}`
  return dateStr
}

/** 计算 pending/processing 的持续时间 */
function formatDuration(startIso: string, endIso?: string | null) {
  const start = new Date(startIso).getTime()
  const end = endIso ? new Date(endIso).getTime() : Date.now()
  const diffSec = Math.round((end - start) / 1000)
  if (diffSec < 60)
    return `${diffSec}秒`
  if (diffSec < 3600)
    return `${Math.floor(diffSec / 60)}分${diffSec % 60}秒`
  return `${Math.floor(diffSec / 3600)}时${Math.floor((diffSec % 3600) / 60)}分`
}

/** 需要在参数展示中隐藏的字段 */
const HIDDEN_PARAMS = new Set(['prompt', 'negative_prompt', 'referenceFileIds'])

/** 判断字符串是否为 URL（媒体文件） */
function isUrl(v: unknown): v is string {
  return typeof v === 'string' && (v.startsWith('http://') || v.startsWith('https://'))
}

/** 判断 URL 是否为图片 */
function isImageUrl(url: string) {
  return /\.(?:jpg|jpeg|png|gif|webp|bmp|svg)(?:\?.*)?$/i.test(url) || url.includes('/image')
}

/** 判断 URL 是否为视频 */
function isVideoUrl(url: string) {
  return /\.(?:mp4|webm|mov|avi)(?:\?.*)?$/i.test(url) || url.includes('/video')
}

/** 将整数分格式化为人民币字符串 */
function formatCents(cents: number, precision = 2): string {
  return currency(cents, { fromCents: true, precision }).format()
}

export default function Workspace() {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category>('image')
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [parameters, setParameters] = useState<Record<string, unknown>>({})
  const [loading, setLoading] = useState(false)
  const [uploadingRefs, setUploadingRefs] = useState(false)
  const [referenceFiles, setReferenceFiles] = useState<{ id: string, url: string, name: string }[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [expandedPrompts, setExpandedPrompts] = useState<Set<string>>(() => new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [groupByProject, setGroupByProject] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<{ open: boolean, id: string }>({ open: false, id: '' })
  // 每个媒体参数的上传状态：paramName → { uploading, uploadedUrl, uploadedName }
  const [mediaUploadState, setMediaUploadState] = useState<Record<string, {
    uploading: boolean
    uploadedUrl?: string
    uploadedName?: string
  }>>({})

  // 从 Zustand store 获取 records / projectMap
  const records = useGenerationStore(s => s.records)
  const projectMap = useGenerationStore(s => s.projectMap)
  const addRecord = useGenerationStore(s => s.addRecord)
  const removeRecord = useGenerationStore(s => s.removeRecord)
  const fetchRecords = useGenerationStore(s => s.fetchRecords)
  const fetchProjects = useGenerationStore(s => s.fetchProjects)
  const subscribeSSE = useGenerationStore(s => s.subscribeSSE)

  // 加载模型列表
  useEffect(() => {
    fetchModels().then((data) => {
      setModels(data.models)
    })
  }, [])

  // 加载 Canvas 项目列表 + 生成记录 + SSE 订阅
  useEffect(() => {
    fetchProjects()
    fetchRecords()
    const unsubscribe = subscribeSSE()
    return unsubscribe
  }, [fetchProjects, fetchRecords, subscribeSSE])

  // 按类别筛选模型
  const categoryModels = models.filter(m => m.category === selectedCategory)
  const selectedModel = models.find(m => m.id === selectedModelId)

  // 切换类别时自动选择第一个模型
  useEffect(() => {
    if (categoryModels.length > 0 && !categoryModels.some(m => m.id === selectedModelId)) {
      setSelectedModelId(categoryModels[0].id)
      setParameters({})
    }
  }, [selectedCategory, categoryModels, selectedModelId])

  // 获取参数默认值
  function getParamDefault(param: ModelParameter): unknown {
    if (param.name === 'prompt')
      return ''
    return param.defaultValue ?? (param.type === 'number' ? 0 : param.type === 'boolean' ? false : '')
  }

  // 初始化参数
  useEffect(() => {
    if (!selectedModel)
      return
    const defaults: Record<string, unknown> = {}
    for (const p of selectedModel.parameters) {
      defaults[p.name] = getParamDefault(p)
    }
    setParameters(defaults)
    setMediaUploadState({})
    // eslint-disable-next-line react/exhaustive-deps
  }, [selectedModelId])

  // 检查必填参数是否都已填写
  const missingRequired = selectedModel
    ? selectedModel.parameters.filter(p => p.required && !parameters[p.name])
    : []
  const canGenerate = selectedModel && missingRequired.length === 0

  // 处理生成 — 提交后直接用响应数据更新列表，后续状态变更由 SSE 推送
  async function handleGenerate() {
    if (!selectedModel || !canGenerate)
      return
    setLoading(true)
    try {
      const referenceFileIds = referenceFiles.map(f => f.id)
      const result: GenerateResponse = await generate({
        model: selectedModel.id,
        parameters,
        referenceFileIds: referenceFileIds.length > 0 ? referenceFileIds : undefined,
      })
      if (result.success && result.record) {
        addRecord(result.record)
      }
    }
    catch {
      toast.error('生成请求失败')
    }
    finally {
      setLoading(false)
    }
  }

  // 重新生成 — 提交后直接插入新记录，SSE 推送最终状态
  async function handleRegenerate(record: GenerationRecord) {
    setLoading(true)
    try {
      const result: GenerateResponse = await generate({
        model: record.model,
        parameters: record.inputParams,
      })
      if (result.success && result.record) {
        addRecord(result.record)
      }
    }
    catch {
      toast.error('生成请求失败')
    }
    finally {
      setLoading(false)
    }
  }

  // 删除记录 — 弹出确认弹窗
  async function handleDelete(id: string) {
    setDeleteConfirm({ open: true, id })
  }

  async function confirmDelete() {
    try {
      await deleteRecord(deleteConfirm.id)
      removeRecord(deleteConfirm.id)
    }
    catch {
      toast.error('删除记录失败')
    }
    finally {
      setDeleteConfirm({ open: false, id: '' })
    }
  }

  // 参考图上传（r2v 模型）
  async function handleReferenceUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0)
      return
    setUploadingRefs(true)
    try {
      for (const file of Array.from(files)) {
        const result = await uploadFile(file)
        if (result.success) {
          setReferenceFiles(prev => [...prev, { id: result.file.id, url: result.file.publicUrl, name: result.file.fileName }])
        }
      }
    }
    finally {
      setUploadingRefs(false)
    }
  }

  // 媒体参数上传（单个参数，如 first_frame_url、video_url 等）
  async function handleMediaUpload(paramName: string, accept: string) {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file)
        return
      setMediaUploadState(prev => ({ ...prev, [paramName]: { uploading: true } }))
      try {
        const result = await uploadFile(file)
        if (result.success) {
          setParameters(p => ({ ...p, [paramName]: result.file.publicUrl }))
          setMediaUploadState(prev => ({
            ...prev,
            [paramName]: { uploading: false, uploadedUrl: result.file.publicUrl, uploadedName: result.file.fileName },
          }))
        }
        else {
          setMediaUploadState(prev => ({ ...prev, [paramName]: { uploading: false } }))
        }
      }
      catch {
        setMediaUploadState(prev => ({ ...prev, [paramName]: { uploading: false } }))
      }
    }
    input.click()
  }

  // 清除已上传的媒体
  function handleClearMedia(paramName: string) {
    setParameters(p => ({ ...p, [paramName]: '' }))
    setMediaUploadState((prev) => {
      const next = { ...prev }
      delete next[paramName]
      return next
    })
  }

  // 渲染媒体上传控件
  function renderMediaUpload(param: ModelParameter) {
    const state = mediaUploadState[param.name]
    const currentUrl = String(parameters[param.name] || '')
    const hasUrl = currentUrl.trim() !== ''
    const isImage = param.mediaUpload?.accept.startsWith('image/')
    const isVideo = param.mediaUpload?.accept.startsWith('video/')
    const isAudio = param.mediaUpload?.accept.startsWith('audio/')

    return (
      <div key={param.name} className="space-y-2">
        {/* 已上传 → 显示预览 + 清除按钮 */}
        {hasUrl && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-2">
            {isImage && (
              <img src={currentUrl} alt={param.description || ''} className="size-12 rounded border object-cover" />
            )}
            {isVideo && (
              <div className="flex size-12 items-center justify-center rounded border bg-muted">
                <Video className="size-5 text-muted-foreground" />
              </div>
            )}
            {isAudio && (
              <div className="flex size-12 items-center justify-center rounded border bg-muted">
                <FileText className="size-5 text-muted-foreground" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs text-muted-foreground">
                {state?.uploadedName || currentUrl}
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="size-7 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => handleClearMedia(param.name)}
            >
              <X className="size-4" />
            </Button>
          </div>
        )}

        {/* 未上传 → 显示上传按钮 */}
        {!hasUrl && (
          <button
            type="button"
            className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 p-3 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:bg-muted/30"
            onClick={() => handleMediaUpload(param.name, param.mediaUpload!.accept)}
            disabled={state?.uploading}
          >
            {state?.uploading
              ? (
                  <Loader2 className="size-4 animate-spin" />
                )
              : (
                  <Upload className="size-4" />
                )}
            {state?.uploading ? '上传中...' : `点击上传${isImage ? '图片' : isVideo ? '视频' : isAudio ? '音频' : '文件'}`}
          </button>
        )}
      </div>
    )
  }

  // 渲染参数输入
  function renderParamInput(param: ModelParameter) {
    const value = parameters[param.name]

    switch (param.type) {
      case 'text':
        // 媒体参数 → 上传控件
        if (param.mediaUpload)
          return renderMediaUpload(param)
        // prompt / negative_prompt → 文本域
        if (param.name === 'prompt' || param.name === 'negative_prompt') {
          return (
            <Textarea
              key={param.name}
              placeholder={param.description || param.name}
              value={String(value || '')}
              onChange={e => setParameters(p => ({ ...p, [param.name]: e.target.value }))}
              rows={param.name === 'prompt' ? 4 : 2}
              className="resize-none"
            />
          )
        }
        return (
          <Input
            key={param.name}
            placeholder={param.description || param.name}
            value={String(value || '')}
            onChange={e => setParameters(p => ({ ...p, [param.name]: e.target.value }))}
          />
        )
      case 'number':
        return (
          <Input
            key={param.name}
            type="number"
            placeholder={param.description || param.name}
            value={String(value ?? param.defaultValue ?? '')}
            min={param.min}
            max={param.max}
            onChange={e => setParameters(p => ({ ...p, [param.name]: Number(e.target.value) }))}
          />
        )
      case 'select':
        return (
          <Select
            key={param.name}
            value={String(value ?? param.defaultValue ?? '')}
            onChange={e => setParameters(p => ({ ...p, [param.name]: e.target.value }))}
            options={param.options?.map(o => ({ label: o.label, value: String(o.value) }))}
          />
        )
      case 'boolean':
        return (
          <label key={param.name} className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(value ?? param.defaultValue ?? false)}
              onChange={e => setParameters(p => ({ ...p, [param.name]: e.target.checked }))}
              className="rounded border-input"
            />
            <span className="text-sm text-muted-foreground">{param.description || param.name}</span>
          </label>
        )
    }
  }

  // 数据驱动：r2v 模型通过 referenceMediaType 判断
  const showReferenceUpload = selectedModel?.referenceMediaType != null

  // 按项目分组：canvas 记录按 projectId 聚合，非 canvas 记录单独展示
  const groupedRecords = useMemo(() => {
    if (!groupByProject)
      return null
    const projectGroups = new Map<string, GenerationRecord[]>()
    const standalone: GenerationRecord[] = []
    for (const r of records) {
      const p = r.inputParams
      if (p?.source === 'canvas' && p.projectId) {
        const pid = String(p.projectId)
        const arr = projectGroups.get(pid) || []
        arr.push(r)
        projectGroups.set(pid, arr)
      }
      else {
        standalone.push(r)
      }
    }
    return { projectGroups, standalone }
  }, [records, groupByProject])

  function togglePrompt(id: string) {
    setExpandedPrompts((prev) => {
      const next = new Set(prev)
      if (next.has(id))
        next.delete(id)
      else next.add(id)
      return next
    })
  }

  function copyPrompt(id: string, text: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(setCopiedId, 1500, null)
  }

  function renderRecordCard(record: GenerationRecord) {
    const statusCfg = STATUS_CONFIG[record.status] || STATUS_CONFIG.pending
    const StatusIcon = statusCfg.icon
    const catCfg = CATEGORY_CONFIG[record.category as Category]
    const CatIcon = catCfg?.icon || FileText
    const modelConfig = models.find(m => m.id === record.model)
    const modelDisplayName = modelConfig?.name || record.model
    const prompt = String(record.inputParams?.prompt || '')
    const promptExpanded = expandedPrompts.has(record.id)
    const visibleParams = Object.entries(record.inputParams || {}).filter(
      ([k, v]) => !HIDDEN_PARAMS.has(k) && v != null && v !== '' && v !== undefined,
    )
    const mediaUrlParams = Object.entries(record.inputParams || {}).filter(
      ([, v]) => isUrl(v),
    )
    const isPending = record.status === 'pending' || record.status === 'processing'
    const duration = formatDuration(record.createdAt, isPending ? null : record.updatedAt)

    return (
      <Card key={record.id} className="overflow-hidden">
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

          {/* Prompt（长文本可展开/收起 + 复制） */}
          {prompt && (
            <div className="mt-2">
              <div className="flex items-center gap-1">
                <p className={`flex-1 text-xs text-muted-foreground ${promptExpanded ? '' : 'line-clamp-2'}`}>
                  {prompt}
                </p>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-6 p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => copyPrompt(record.id, prompt)}
                    title="复制提示词"
                  >
                    <Copy className="size-3" />
                  </Button>
                  {prompt.length > 80 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="size-6 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => togglePrompt(record.id)}
                    >
                      {promptExpanded ? '收起' : '展开'}
                    </Button>
                  )}
                </div>
              </div>
              {copiedId === record.id && (
                <p className="text-[10px] text-green-600">已复制</p>
              )}
            </div>
          )}

          {/* 参数标签（全部展示） */}
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
                {record.cost.unitPriceCents != null && (
                  <span>
                    单价: ¥
                    {formatCents(record.cost.unitPriceCents, 4)}
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
                  {formatCents(record.cost.totalPriceCents, 4)}
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
                        onClick={() => setPreviewUrl(u)}
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
                      onClick={() => setPreviewUrl(url)}
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
            {record.status === 'succeeded'
              && record.outputResult
              && (isImageOutput(record.outputResult) || isVideoOutput(record.outputResult))
              && (isImageOutput(record.outputResult) ? record.outputResult.savedUrls : record.outputResult.savedUrls).map((url, i, arr) => (
                <Button key={url} variant="outline" size="sm" asChild>
                  <a href={url} download>
                    <Download className="size-3" />
                    {arr.length > 1 ? `下载 ${i + 1}` : '下载'}
                  </a>
                </Button>
              ))}
            {record.status === 'failed' && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleRegenerate(record)}
              >
                <RotateCcw className="size-3" />
                重新生成
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-muted-foreground hover:text-destructive"
              onClick={() => handleDelete(record.id)}
            >
              <Trash2 className="size-3" />
              删除
            </Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  // 分组模式下的项目分组渲染
  function renderGroupedRecords() {
    if (!groupedRecords)
      return null
    const entries = [...groupedRecords.projectGroups.entries()]
    const standalone = groupedRecords.standalone

    return (
      <>
        {entries.map(([projectId, groupRecords]) => {
          const project = projectMap.get(projectId)
          const projectName = project?.title || `项目 ${projectId.slice(0, 8)}`
          const hasProcessing = groupRecords.some(r => r.status === 'pending' || r.status === 'processing')
          const allFailed = groupRecords.every(r => r.status === 'failed')
          const statusText = hasProcessing ? '生成中' : allFailed ? '全部失败' : '已完成'
          const statusColor = hasProcessing ? 'text-blue-500' : allFailed ? 'text-destructive' : 'text-green-600'
          return (
            <div key={projectId}>
              <div className="flex items-center gap-2 mb-1 px-1">
                <FolderOpen className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium">{projectName}</span>
                <span className={`text-xs ${statusColor}`}>{statusText}</span>
                <span className="text-xs text-muted-foreground">
                  {groupRecords.length}
                  {' '}
                  条记录
                </span>
              </div>
              <div className="space-y-2">
                {groupRecords.map(record => renderRecordCard(record))}
              </div>
            </div>
          )
        })}
        {standalone.length > 0 && (
          <>
            {entries.length > 0 && (
              <div className="flex items-center gap-2 mb-1 px-1">
                <FileText className="size-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">独立记录</span>
              </div>
            )}
            <div className="space-y-2">
              {standalone.map(record => renderRecordCard(record))}
            </div>
          </>
        )}
      </>
    )
  }

  return (
    <div className="mx-auto max-w-7xl p-4">
      <div className="grid gap-6 lg:grid-cols-2">
        {/* 左栏 — 生成控制区 */}
        <div className="space-y-4">
          {/* 类别选择 */}
          <div className="flex gap-2">
            {(Object.entries(CATEGORY_CONFIG) as [Category, typeof CATEGORY_CONFIG[Category]][]).map(([key, cfg]) => {
              const Icon = cfg.icon
              return (
                <Button
                  key={key}
                  variant={selectedCategory === key ? 'default' : 'outline'}
                  className={selectedCategory === key ? cfg.activeColor : ''}
                  onClick={() => setSelectedCategory(key)}
                >
                  <Icon className="size-4" />
                  {cfg.label}
                </Button>
              )
            })}
          </div>

          {/* 模型选择 */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">模型选择</CardTitle>
            </CardHeader>
            <CardContent>
              <Select
                value={selectedModelId}
                onChange={e => setSelectedModelId(e.target.value)}
                options={categoryModels.map(m => ({
                  label: `${m.name} — ${m.description}`,
                  value: m.id,
                }))}
              />
              {selectedModel?.pricing.note && (
                <p className="mt-2 text-xs text-muted-foreground">{selectedModel.pricing.note}</p>
              )}
            </CardContent>
          </Card>

          {/* 参考图上传（r2v 模型） — 移到参数设置上方 */}
          {showReferenceUpload && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">参考图片</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  <label className="flex cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/25 p-4 transition-colors hover:border-muted-foreground/50">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={handleReferenceUpload}
                      disabled={uploadingRefs}
                    />
                    {uploadingRefs
                      ? (
                          <Loader2 className="size-5 animate-spin text-muted-foreground" />
                        )
                      : (
                          <span className="text-sm text-muted-foreground">点击上传参考图片（最多 5 张）</span>
                        )}
                  </label>
                  {referenceFiles.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {referenceFiles.map(file => (
                        <div key={file.id} className="relative size-16 overflow-hidden rounded-lg border">
                          <img src={file.url} alt={file.name} className="size-full object-cover" />
                          <button
                            className="absolute -right-1 -top-1 flex size-5 items-center justify-center rounded-full bg-destructive text-white text-xs"
                            onClick={() => setReferenceFiles(prev => prev.filter(f => f.id !== file.id))}
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* 参数设置 */}
          {selectedModel && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">参数设置</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {selectedModel.parameters.map(param => (
                  <div key={param.name}>
                    {param.type !== 'boolean' && (
                      <label className="mb-1 block text-xs font-medium text-muted-foreground">
                        {param.description || param.name}
                        {param.required && <span className="ml-1 text-destructive">*</span>}
                      </label>
                    )}
                    {renderParamInput(param)}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* 生成按钮 */}
          <Button
            className="w-full"
            size="lg"
            disabled={loading || !canGenerate}
            onClick={handleGenerate}
          >
            {loading
              ? (
                  <>
                    <Loader2 className="size-4 animate-spin" />
                    生成中...
                  </>
                )
              : (
                  <>
                    <Sparkles className="size-4" />
                    开始生成
                  </>
                )}
          </Button>
        </div>

        {/* 右栏 — 生成记录 */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-muted-foreground">生成记录</h3>
            <Button
              variant={groupByProject ? 'default' : 'outline'}
              size="sm"
              className="h-6 text-xs"
              onClick={() => setGroupByProject(v => !v)}
            >
              <FolderOpen className="size-3.5" />
              按项目排布
            </Button>
          </div>
          <ScrollArea className="h-[calc(100vh-8rem)]">
            <div className="space-y-3 pr-2">
              {records.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="mb-2 size-8" />
                  <p className="text-sm">暂无生成记录</p>
                </div>
              )}

              {/* 分组模式 */}
              {groupedRecords && renderGroupedRecords()}

              {/* 默认平铺模式 */}
              {!groupedRecords && records.map(record => renderRecordCard(record))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* 图片预览弹窗 */}
      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={() => setPreviewUrl(null)}>
          <div className="relative max-h-[90vh] max-w-[90vw]">
            <img src={previewUrl} alt="Preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
            <a
              href={previewUrl}
              download
              className="absolute right-2 top-2 rounded-lg bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={e => e.stopPropagation()}
            >
              <Download className="size-4" />
            </a>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={open => !open && setDeleteConfirm({ open: false, id: '' })}
        title="确定要删除这条记录吗？"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
