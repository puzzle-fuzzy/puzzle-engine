import { useCallback, useRef, useState } from 'react'

interface ReferenceUploadZoneProps {
  currentUrl: string | null
  onUpload: (file: File) => Promise<string>
  onRemove?: () => Promise<void>
  accept?: string
  label?: string
}

export function ReferenceUploadZone({
  currentUrl,
  onUpload,
  onRemove,
  accept = 'image/*',
  label = '参考图',
}: ReferenceUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentUrl)
  const [error, setError] = useState<string | null>(null)

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) {
      setError('仅支持图片文件')
      return
    }
    setError(null)
    setUploading(true)

    try {
      // Show local preview immediately
      const localUrl = URL.createObjectURL(file)
      setPreviewUrl(localUrl)

      const url = await onUpload(file)
      setPreviewUrl(url)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '上传失败')
      setPreviewUrl(currentUrl)
    }
    finally {
      setUploading(false)
    }
  }, [onUpload, currentUrl])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file)
      handleFile(file)
  }, [handleFile])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setDragging(false)
  }, [])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file)
      handleFile(file)
    // Reset input so same file can be re-selected
    e.target.value = ''
  }, [handleFile])

  const handleRemove = useCallback(async () => {
    if (!onRemove)
      return
    setUploading(true)
    try {
      await onRemove()
      setPreviewUrl(null)
    }
    catch (err) {
      setError(err instanceof Error ? err.message : '删除失败')
    }
    finally {
      setUploading(false)
    }
  }, [onRemove])

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>

      {previewUrl
        ? (
            <div className="relative group rounded-lg overflow-hidden border">
              <img
                src={previewUrl}
                alt="参考图"
                className="w-full h-40 object-cover"
              />
              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="px-3 py-1.5 bg-white text-black rounded text-xs font-medium hover:bg-gray-100"
                  disabled={uploading}
                >
                  替换
                </button>
                {onRemove && (
                  <button
                    type="button"
                    onClick={handleRemove}
                    className="px-3 py-1.5 bg-red-500 text-white rounded text-xs font-medium hover:bg-red-600"
                    disabled={uploading}
                  >
                    删除
                  </button>
                )}
              </div>
            </div>
          )
        : (
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onClick={() => inputRef.current?.click()}
              className={`
            flex flex-col items-center justify-center h-40 rounded-lg border-2 border-dashed cursor-pointer transition-colors
            ${dragging ? 'border-primary bg-primary/5' : 'border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50'}
            ${uploading ? 'opacity-50 pointer-events-none' : ''}
          `}
            >
              {uploading
                ? (
                    <p className="text-xs text-muted-foreground">上传中...</p>
                  )
                : (
                    <>
                      <svg
                        className="w-8 h-8 text-muted-foreground/50 mb-2"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.5}
                          d="M12 16V4m0 0l-4 4m4-4l4 4M4 20h16"
                        />
                      </svg>
                      <p className="text-xs text-muted-foreground">拖拽图片到此处，或点击上传</p>
                    </>
                  )}
            </div>
          )}

      <input
        ref={inputRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />

      {error && (
        <p className="text-xs text-red-600">{error}</p>
      )}
    </div>
  )
}
