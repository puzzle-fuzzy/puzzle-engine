import { Download, X } from 'lucide-react'

interface MediaPreviewDialogProps {
  url: string | null
  onClose: () => void
}

export default function MediaPreviewDialog({ url, onClose }: MediaPreviewDialogProps) {
  if (!url)
    return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80" onClick={onClose}>
      <div className="relative max-h-[90vh] max-w-[90vw]">
        <img src={url} alt="Preview" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain" />
        <a
          href={url}
          download
          className="absolute right-2 top-2 rounded-lg bg-black/50 p-2 text-white hover:bg-black/70"
          onClick={e => e.stopPropagation()}
        >
          <Download className="size-4" />
        </a>
        <button
          className="absolute left-2 top-2 rounded-full bg-black/50 p-1.5 text-white hover:bg-black/70"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  )
}
