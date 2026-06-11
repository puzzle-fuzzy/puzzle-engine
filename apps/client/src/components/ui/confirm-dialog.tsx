import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

interface ConfirmDialogProps {
  /** 是否显示 */
  open: boolean
  /** 关闭回调 */
  onOpenChange: (open: boolean) => void
  /** 标题 */
  title: string
  /** 描述文字 */
  description?: string
  /** 确认按钮文字，默认"确认" */
  confirmText?: string
  /** 取消按钮文字，默认"取消" */
  cancelText?: string
  /** 确认按钮样式，默认 destructive */
  variant?: 'destructive' | 'default'
  /** 确认回调（支持异步） */
  onConfirm: () => void | Promise<void>
}

/**
 * 通用确认弹窗 — 替代原生 confirm()
 *
 * 使用现有 Dialog 组件 + Button 构建，保持 shadcn 风格统一。
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText = '确认',
  cancelText = '取消',
  variant = 'destructive',
  onConfirm,
}: ConfirmDialogProps) {
  const [loading, setLoading] = React.useState(false)

  async function handleConfirm() {
    try {
      setLoading(true)
      await onConfirm()
      onOpenChange(false)
    }
    finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 text-center sm:text-left">
          <h2 className="text-lg font-semibold">
            {title}
          </h2>
          {description && (
            <p className="text-sm text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            {cancelText}
          </Button>
          <Button
            variant={variant}
            size="sm"
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading ? '处理中...' : confirmText}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
