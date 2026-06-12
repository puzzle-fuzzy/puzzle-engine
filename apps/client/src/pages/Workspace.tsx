import type { GenerateResponse, GenerationRecord, ModelConfig, ModelParameter } from '@/api/client'
import type { Category } from '@/lib/generation-utils'
import {
  FileText,
  FolderOpen,
  Loader2,
  Sparkles,
  Upload,
  Video,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  deleteRecord,
  fetchModels,
  generate,
  uploadFile,
} from '@/api/client'
import MediaPreviewDialog from '@/components/MediaPreviewDialog'
import RecordCard from '@/components/RecordCard'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CATEGORY_CONFIG } from '@/lib/generation-utils'
import { useGenerationStore } from '@/stores/generation'

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
                {groupRecords.map(record => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    models={models}
                    expanded={expandedPrompts.has(record.id)}
                    copied={copiedId === record.id}
                    onToggleExpand={togglePrompt}
                    onCopyPrompt={copyPrompt}
                    onRegenerate={handleRegenerate}
                    onDelete={handleDelete}
                    onPreview={setPreviewUrl}
                  />
                ))}
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
              {standalone.map(record => (
                <RecordCard
                  key={record.id}
                  record={record}
                  models={models}
                  expanded={expandedPrompts.has(record.id)}
                  copied={copiedId === record.id}
                  onToggleExpand={togglePrompt}
                  onCopyPrompt={copyPrompt}
                  onRegenerate={handleRegenerate}
                  onDelete={handleDelete}
                  onPreview={setPreviewUrl}
                />
              ))}
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
              {!groupedRecords && records.map(record => (
                <RecordCard
                  key={record.id}
                  record={record}
                  models={models}
                  expanded={expandedPrompts.has(record.id)}
                  copied={copiedId === record.id}
                  onToggleExpand={togglePrompt}
                  onCopyPrompt={copyPrompt}
                  onRegenerate={handleRegenerate}
                  onDelete={handleDelete}
                  onPreview={setPreviewUrl}
                />
              ))}
            </div>
          </ScrollArea>
        </div>
      </div>

      {/* 图片预览弹窗 */}
      <MediaPreviewDialog url={previewUrl} onClose={() => setPreviewUrl(null)} />

      <ConfirmDialog
        open={deleteConfirm.open}
        onOpenChange={open => !open && setDeleteConfirm({ open: false, id: '' })}
        title="确定要删除这条记录吗？"
        onConfirm={confirmDelete}
      />
    </div>
  )
}
