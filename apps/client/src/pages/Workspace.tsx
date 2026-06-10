import { useState, useEffect, useRef, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  FileText,
  ImageIcon,
  Video,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  RotateCcw,
  Sparkles,
  Download,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  fetchModels,
  generate,
  fetchRecords,
  deleteRecord,
  uploadFile,
  type ModelConfig,
  type ModelParameter,
  type GenerateResponse,
  type GenerationRecord,
} from '@/api/client'

const CATEGORY_CONFIG = {
  text: { label: '文本生成', color: 'bg-blue-500', icon: FileText, activeColor: 'bg-blue-500 text-white' },
  image: { label: '图像生成', color: 'bg-purple-500', icon: ImageIcon, activeColor: 'bg-purple-500 text-white' },
  video: { label: '视频生成', color: 'bg-pink-500', icon: Video, activeColor: 'bg-pink-500 text-white' },
} as const

type Category = keyof typeof CATEGORY_CONFIG

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof Clock }> = {
  pending: { label: '等待中', color: 'bg-yellow-100 text-yellow-700', icon: Clock },
  processing: { label: '处理中', color: 'bg-blue-100 text-blue-700', icon: Loader2 },
  succeeded: { label: '已完成', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  failed: { label: '失败', color: 'bg-red-100 text-red-700', icon: XCircle },
}

export default function Workspace() {
  const [models, setModels] = useState<ModelConfig[]>([])
  const [selectedCategory, setSelectedCategory] = useState<Category>('image')
  const [selectedModelId, setSelectedModelId] = useState<string>('')
  const [parameters, setParameters] = useState<Record<string, unknown>>({})
  const [records, setRecords] = useState<GenerationRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [uploadingRefs, setUploadingRefs] = useState(false)
  const [referenceFiles, setReferenceFiles] = useState<{ id: string; url: string; name: string }[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  // 每个媒体参数的上传状态：paramName → { uploading, uploadedUrl, uploadedName }
  const [mediaUploadState, setMediaUploadState] = useState<Record<string, {
    uploading: boolean
    uploadedUrl?: string
    uploadedName?: string
  }>>({})
  const recordsEndRef = useRef<HTMLDivElement>(null)

  // 加载模型列表
  useEffect(() => {
    fetchModels().then((data) => {
      setModels(data.models)
    })
  }, [])

  // 按类别筛选模型
  const categoryModels = models.filter(m => m.category === selectedCategory)
  const selectedModel = models.find(m => m.id === selectedModelId)

  // 切换类别时自动选择第一个模型
  useEffect(() => {
    if (categoryModels.length > 0 && !categoryModels.find(m => m.id === selectedModelId)) {
      setSelectedModelId(categoryModels[0].id)
      setParameters({})
    }
  }, [selectedCategory, categoryModels, selectedModelId])

  // 加载生成记录
  const loadRecords = useCallback(async () => {
    try {
      const data = await fetchRecords({ limit: 100 })
      setRecords(data.records)
    }
    catch {}
  }, [])

  useEffect(() => {
    loadRecords()
    const interval = setInterval(loadRecords, 5000)
    return () => clearInterval(interval)
  }, [loadRecords])

  // 自动滚动到底部
  useEffect(() => {
    recordsEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [records.length])

  // 获取参数默认值
  function getParamDefault(param: ModelParameter): unknown {
    if (param.name === 'prompt') return ''
    return param.defaultValue ?? (param.type === 'number' ? 0 : param.type === 'boolean' ? false : '')
  }

  // 初始化参数
  useEffect(() => {
    if (!selectedModel) return
    const defaults: Record<string, unknown> = {}
    for (const p of selectedModel.parameters) {
      defaults[p.name] = getParamDefault(p)
    }
    setParameters(defaults)
    setMediaUploadState({})
  }, [selectedModelId])

  // 处理生成
  async function handleGenerate() {
    if (!selectedModel || !parameters.prompt) return
    setLoading(true)
    try {
      const referenceFileIds = referenceFiles.map(f => f.id)
      const result: GenerateResponse = await generate({
        model: selectedModel.id,
        parameters,
        referenceFileIds: referenceFileIds.length > 0 ? referenceFileIds : undefined,
      })
      if (result.success) {
        await loadRecords()
      }
    }
    catch (error) {
      console.error('Generate failed:', error)
    }
    finally {
      setLoading(false)
    }
  }

  // 重新生成
  async function handleRegenerate(record: GenerationRecord) {
    setLoading(true)
    try {
      await generate({
        model: record.model,
        parameters: record.inputParams as Record<string, unknown>,
      })
      await loadRecords()
    }
    catch {}
    finally {
      setLoading(false)
    }
  }

  // 删除记录
  async function handleDelete(id: string) {
    if (!confirm('确定要删除这条记录吗？'))
      return
    try {
      await deleteRecord(id)
      await loadRecords()
    }
    catch {}
  }

  // 参考图上传（r2v 模型）
  async function handleReferenceUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return
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
      if (!file) return
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
    setMediaUploadState(prev => {
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
            {state?.uploading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
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
        if (param.mediaUpload) return renderMediaUpload(param)
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
                    {uploadingRefs ? (
                      <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    ) : (
                      <span className="text-sm text-muted-foreground">点击上传参考图片（最多 5 张）</span>
                    )}
                  </label>
                  {referenceFiles.length > 0 && (
                    <div className="flex gap-2 flex-wrap">
                      {referenceFiles.map((file) => (
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
            disabled={loading || !parameters.prompt}
            onClick={handleGenerate}
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                生成中...
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                开始生成
              </>
            )}
          </Button>
        </div>

        {/* 右栏 — 生成记录 */}
        <div className="space-y-2">
          <h3 className="text-sm font-semibold text-muted-foreground">生成记录</h3>
          <ScrollArea className="h-[calc(100vh-8rem)]">
            <div className="space-y-3 pr-2">
              {records.length === 0 && (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <FileText className="mb-2 size-8" />
                  <p className="text-sm">暂无生成记录</p>
                </div>
              )}
              {records.map((record) => {
                const statusCfg = STATUS_CONFIG[record.status] || STATUS_CONFIG.pending
                const StatusIcon = statusCfg.icon
                const catCfg = CATEGORY_CONFIG[record.category as Category]
                const CatIcon = catCfg?.icon || FileText
                const prompt = String(record.inputParams?.prompt || '').slice(0, 80)

                return (
                  <Card key={record.id} className="overflow-hidden">
                    <CardContent className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <CatIcon className={`size-4 ${catCfg?.color?.replace('bg-', 'text-')}`} />
                          <span className="text-sm font-medium">{record.model}</span>
                          <Badge variant="secondary" className={`text-[10px] ${statusCfg.color}`}>
                            <StatusIcon className={`mr-1 size-3 ${record.status === 'processing' ? 'animate-spin' : ''}`} />
                            {statusCfg.label}
                          </Badge>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {new Date(record.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>

                      <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{prompt}</p>

                      {/* 参数标签 */}
                      <div className="mt-2 flex flex-wrap gap-1">
                        {record.category === 'video' && record.inputParams?.resolution ? (
                          <Badge variant="outline" className="text-[10px]">{String(record.inputParams.resolution)}</Badge>
                        ) : null}
                        {record.category === 'video' && record.inputParams?.duration ? (
                          <Badge variant="outline" className="text-[10px]">{String(record.inputParams.duration)}秒</Badge>
                        ) : null}
                        {record.category === 'image' && record.inputParams?.size ? (
                          <Badge variant="outline" className="text-[10px]">{String(record.inputParams.size)}</Badge>
                        ) : null}
                      </div>

                      {/* 费用 */}
                      {record.cost?.totalPrice != null && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          费用: ¥{Number(record.cost.totalPrice).toFixed(4)}
                        </p>
                      )}

                      {/* 输出预览 */}
                      {record.outputResult && (
                        <div className="mt-2">
                          {record.category === 'image' && (record.outputResult as any).savedUrls && (
                            <div className="flex gap-2 flex-wrap">
                              {((record.outputResult as any).savedUrls as string[]).map((url: string, i: number) => (
                                <img
                                  key={i}
                                  src={url}
                                  alt={`生成图片 ${i + 1}`}
                                  className="size-32 cursor-pointer rounded-lg border object-cover hover:opacity-80 transition-opacity"
                                  onClick={() => setPreviewUrl(url)}
                                />
                              ))}
                            </div>
                          )}
                          {record.category === 'text' && (record.outputResult as any).text && (
                            <p className="rounded-lg bg-muted p-2 text-xs line-clamp-3">
                              {String((record.outputResult as any).text).slice(0, 200)}
                            </p>
                          )}
                          {record.category === 'video' && (record.outputResult as any).savedUrls && (
                            <div className="flex gap-2">
                              {((record.outputResult as any).savedUrls as string[]).map((url: string, i: number) => (
                                <video
                                  key={i}
                                  src={url}
                                  className="w-full max-w-xs rounded-lg border aspect-video object-cover"
                                  controls
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
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => handleDelete(record.id)}
                        >
                          <Trash2 className="size-3" />
                          删除
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              <div ref={recordsEndRef} />
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
    </div>
  )
}
