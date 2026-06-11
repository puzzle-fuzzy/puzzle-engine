import * as React from 'react'
import { cn } from '@/lib/utils'

interface DialogProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  if (!open)
    return null

  return (
    <div data-slot="dialog-overlay" className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="fixed inset-0 bg-black/80"
        onClick={() => onOpenChange?.(false)}
      />
      <div
        data-slot="dialog-content"
        className="relative z-50 grid w-full max-w-lg gap-4 border bg-background p-6 shadow-lg rounded-xl"
      >
        {children}
      </div>
    </div>
  )
}

function DialogContent({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div data-slot="dialog-inner" className={cn('', className)} {...props}>
      {children}
    </div>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-2 text-center sm:text-left', className)} {...props} />
}

function DialogTitle({ className, ...props }: React.ComponentProps<'h2'>) {
  return <h2 data-slot="dialog-title" className={cn('text-lg font-semibold', className)} {...props} />
}

export { Dialog, DialogContent, DialogHeader, DialogTitle }
