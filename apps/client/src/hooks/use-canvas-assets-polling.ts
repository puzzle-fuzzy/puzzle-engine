/**
 * Canvas 资产轮询 Hook — 自适应间隔轮询项目资产快照
 *
 * 核心职责：
 *   1. 根据 connectionMode 决定轮询间隔
 *     - SSE 正常: 5s 补充性安全轮询
 *     - SSE 断线 → polling 降级: 有 activeTasks 时 2s，空闲时 10s
 *     - 断开: 不轮询
 *   2. projectVersion 变化时立即刷新（SSE 事件触发的轻量补充）
 *   3. 返回 pollData、connectionMode、isPolling、refresh 供 CanvasEditor 使用
 *
 * 注意：polling 是补充性数据通道，ProjectDTO（getCanvasProject）仍是权威。
 * CanvasEditor 通过比较 pollData 和 project 的状态差异来决定是否触发 loadProject()。
 */
import type { CanvasAssetsPoll } from '@excuse/shared'
import type { ConnectionMode } from '@/stores/realtime-sync'
import { useCallback, useEffect, useRef, useState } from 'react'
import { pollCanvasAssets } from '@/api/client'
import { useRealtimeSync } from '@/stores/realtime-sync'

interface UseCanvasAssetsPollingResult {
  /** 最新轮询数据（null 直到首次成功轮询） */
  pollData: CanvasAssetsPoll | null
  /** SSE/轮询连接模式 */
  connectionMode: ConnectionMode
  /** 是否正在轮询 */
  isPolling: boolean
  /** 最近轮询时间戳 */
  lastPollAt: number | null
  /** 手动触发一次轮询 */
  refresh: () => void
}

/** 各 connectionMode 下的轮询间隔（ms） */
const POLL_INTERVALS: Record<ConnectionMode, number> = {
  sse: 5000, // 补充性安全轮询
  polling: 2000, // 降级时活跃轮询（动态调整：有任务 2s，无任务 10s）
  disconnected: 0, // 不轮询
}

/** 降级模式下无活跃任务时的空闲轮询间隔（ms） */
const IDLE_POLL_INTERVAL = 10000

export function useCanvasAssetsPolling(projectId: string | undefined): UseCanvasAssetsPollingResult {
  const connectionMode = useRealtimeSync(s => s.connectionMode)
  const projectVersion = useRealtimeSync(s => projectId ? s.projectVersions[projectId] : 0)

  const [pollData, setPollData] = useState<CanvasAssetsPoll | null>(null)
  const [lastPollAt, setLastPollAt] = useState<number | null>(null)
  const cancelledRef = useRef(false)

  // refresh 定义在 useEffect 之前，避免 no-use-before-define
  const refresh = useCallback(async () => {
    if (!projectId)
      return
    try {
      const data = await pollCanvasAssets(projectId)
      setPollData(data)
      setLastPollAt(Date.now())
    }
    catch {
      // 静默失败
    }
  }, [projectId])

  // 根据连接模式和活跃任务数决定轮询间隔
  const hasActiveTasks = (pollData?.activeTasks?.length ?? 0) > 0
  const interval = connectionMode === 'polling'
    ? (hasActiveTasks ? POLL_INTERVALS.polling : IDLE_POLL_INTERVAL)
    : POLL_INTERVALS[connectionMode]

  const isPolling = interval > 0

  // 轮询定时器
  useEffect(() => {
    if (!projectId || interval === 0)
      return

    cancelledRef.current = false

    const poll = async () => {
      if (cancelledRef.current)
        return
      try {
        const data = await pollCanvasAssets(projectId)
        if (!cancelledRef.current) {
          setPollData(data)
          setLastPollAt(Date.now())
        }
      }
      catch {
        // 静默失败 — 下次轮询周期重试
      }
    }

    // 立即首次轮询
    poll()

    const timer = setInterval(poll, interval)
    return () => {
      cancelledRef.current = true
      clearInterval(timer)
    }
  }, [projectId, interval])

  // projectVersion 变化时立即刷新（SSE 事件驱动的轻量补充）
  useEffect(() => {
    if (!projectId || !projectVersion)
      return
    // projectVersion 从 0 变为正数时是首次递增，需要刷新
    refresh()
    // eslint-disable-next-line react/exhaustive-deps
  }, [projectVersion])

  return { pollData, connectionMode, isPolling, lastPollAt, refresh }
}
