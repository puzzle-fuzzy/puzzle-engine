import type { OSSConfig } from '@excuse/provider'
import type { CanvasModelPreferences } from '@excuse/shared'
import {
  getGenerationRecordsByTaskIds,
  listCanvasShotsByProject,
  updateCanvasProject,
  updateCanvasShot,
} from '@excuse/db'
import { DashScopeClient } from '@excuse/provider'
import { dispatchToUser } from '../../services/sse-manager'

export function createClient(config: { dashscopeApiKey: string, dashscopeBaseUrl?: string }) {
  return new DashScopeClient({ apiKey: config.dashscopeApiKey, baseUrl: config.dashscopeBaseUrl })
}

export function notifyNode(accountId: string, projectId: string, nodeType: string, nodeId: string, status: 'running' | 'completed' | 'failed', data?: Record<string, unknown>, error?: string, runId?: string) {
  dispatchToUser(accountId, 'pipeline_node_update', { projectId, nodeType, nodeId, status, data, error, runId })
}

export const DEFAULT_TEXT_MODEL = 'qwen3.7-plus'
export const DEFAULT_IMAGE_MODEL = 'qwen-image-2.0-pro'

export function getTextModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.textModel || DEFAULT_TEXT_MODEL
}

export function getImageModel(prefs: CanvasModelPreferences | null | undefined): string {
  return prefs?.imageModel || DEFAULT_IMAGE_MODEL
}

export function getVideoModel(prefs: CanvasModelPreferences | null | undefined, referenceUrls: string[]): string {
  const base = prefs?.videoModel || 'happyhorse-1.0'
  const strippedBase = base.replace(/-r2v$|-t2v$|-i2v$/, '')
  return referenceUrls.length > 0 ? `${strippedBase}-r2v` : `${strippedBase}-t2v`
}

export function assertNotGenerating(status: string | null | undefined): void {
  if (status === 'generating') {
    throw new Error('项目正在生成中，请等待完成后再操作')
  }
}

export async function reconcileProjectShots(projectId: string) {
  const shots = await listCanvasShotsByProject(projectId)
  const staleShots = shots.filter(s => s.status === 'generating' && s.videoTaskId)

  if (staleShots.length === 0)
    return

  const taskIds = staleShots.map(s => s.videoTaskId!).filter(Boolean)
  const records = await getGenerationRecordsByTaskIds(taskIds)
  const recordMap = new Map(records.map(r => [r.taskId, r]))

  let anyUpdated = false
  for (const shot of staleShots) {
    const record = recordMap.get(shot.videoTaskId!)
    if (!record)
      continue

    if (record.status === 'succeeded') {
      const output = record.outputResult
      if (!output || !('savedUrls' in output))
        continue
      const savedUrls = output.savedUrls
      await updateCanvasShot(shot.id, {
        status: 'completed',
        videoUrl: savedUrls?.[0] || undefined,
      })
      anyUpdated = true
    }
    else if (record.status === 'failed') {
      await updateCanvasShot(shot.id, {
        status: 'failed',
        errorMessage: record.errorMessage || undefined,
      })
      anyUpdated = true
    }
  }

  if (anyUpdated) {
    const updatedShots = await listCanvasShotsByProject(projectId)
    const stillGenerating = updatedShots.some(s => s.status === 'generating')
    if (!stillGenerating && updatedShots.length > 0) {
      const allSucceeded = updatedShots.every(s => s.status === 'completed')
      await updateCanvasProject(projectId, {
        status: allSucceeded ? 'completed' : 'partial_failed',
      })
    }
  }
}

export type { OSSConfig }
