interface RunningOverlayProps {
  label?: string
}

export function RunningOverlay({ label = '正在生成...' }: RunningOverlayProps) {
  return (
    <div className="absolute inset-0 bg-white/30 flex items-center justify-center rounded-lg pointer-events-none">
      <div className="bg-yellow-100 text-yellow-700 text-xs font-medium px-3 py-1.5 rounded-full shadow animate-pulse">
        {label}
      </div>
    </div>
  )
}

/** 返回节点边框样式：运行中显示黄色高亮，否则使用默认颜色 */
export function runningBorder(isRunning: boolean | undefined, defaultBorder: string): string {
  return isRunning ? 'border-yellow-400 ring-2 ring-yellow-200' : defaultBorder
}

/** 运行中的标签 badge */
export function RunningBadge() {
  return (
    <span className="text-[10px] bg-yellow-100 text-yellow-700 rounded-full px-1.5 animate-pulse">生成中</span>
  )
}
