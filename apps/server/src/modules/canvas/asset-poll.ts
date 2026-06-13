/**
 * Canvas 资产轮询服务 — 组装项目资产和任务状态的一次性快照
 *
 * 核心职责：
 *   1. 获取项目 + 角色/场景/镜头实体数据
 *   2. 获取项目关联的所有 generation_records（视频）
 *   3. 获取项目关联的所有 canvas_assets（文本/图片/视频）
 *   4. 内存分区：active（非终态）vs terminal
 *   5. 按 shotId/characterId/locationId 建立活跃任务映射
 *   6. 组装 activeTasks、costs、generatedAt
 *
 * 数据来源双轨：
 *   - generation_records: 视频异步任务（legacy，Worker 轮询 DashScope）
 *   - canvas_assets: 所有 canvas 管线输出（文本/图片/视频/分析/分镜等）
 *
 * 注意：
 *   - shotId 从 inputParams JSONB 或 canvas_assets.targetEntityId 提取
 *   - 这不是权威数据通道，ProjectDTO（getProjectDetail）仍是权威
 */
import type { CanvasAssetsPoll } from '@excuse/shared'
import {
  getCanvasProjectById,
  getCanvasProjectDetail,
  listActiveCanvasAssetsByProject,
  listCanvasGenerationRecordsByProject,
  listTerminalCanvasAssetsByProject,
} from '@excuse/db'

/** generation record 非终态 status 列表 */
const ACTIVE_GEN_STATUSES = new Set(['pending', 'submitting', 'processing', 'saving_output'])

/** 将 generation record status 映射为 cost state */
function mapCostState(status: string): 'active' | 'completed' | 'failed' {
  if (status === 'succeeded')
    return 'completed'
  if (status === 'failed' || status === 'cancelled')
    return 'failed'
  return 'active'
}

/** canvas_asset category → activeTask category */
function mapAssetCategoryToTaskCategory(category: string): 'text' | 'image' | 'video' {
  if (category === 'shotVideo')
    return 'video'
  if (['characterPortrait', 'characterTurnaround', 'locationRef'].includes(category))
    return 'image'
  return 'text'
}

/** canvas_asset category → activeTask targetType */
function mapAssetCategoryToTargetType(category: string): 'character' | 'location' | 'shot' | 'project' {
  if (['characterPortrait', 'characterTurnaround', 'characterProfile'].includes(category))
    return 'character'
  if (['locationRef', 'locationProfile'].includes(category))
    return 'location'
  if (['shotVideo', 'videoPrompt'].includes(category))
    return 'shot'
  return 'project'
}

/**
 * 获取 Canvas 项目资产轮询快照
 *
 * @returns CanvasAssetsPoll 或 null（项目不存在）
 */
export async function getCanvasAssetsPoll(projectId: string): Promise<CanvasAssetsPoll | null> {
  // 1. 获取项目基础信息
  const project = await getCanvasProjectById(projectId)
  if (!project)
    return null

  // 2. 获取实体数据
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    return null

  // 3. 并行获取 generation_records + canvas_assets
  const genRecords = await listCanvasGenerationRecordsByProject(projectId)
  const activeAssets = await listActiveCanvasAssetsByProject(projectId)
  const terminalAssets = await listTerminalCanvasAssetsByProject(projectId)

  // 4. 按 shotId 分组活跃视频 generation_records
  const activeVideoTaskIdsByShot = new Map<string, string[]>()
  const activeTasks: CanvasAssetsPoll['activeTasks'] = []
  const costs: CanvasAssetsPoll['costs'] = []

  for (const record of genRecords) {
    const isActive = ACTIVE_GEN_STATUSES.has(record.status)
    const shotId = record.shotId

    // 活跃视频任务 → shot.activeVideoTaskIds
    if (isActive && shotId && record.category === 'video') {
      const existing = activeVideoTaskIdsByShot.get(shotId) ?? []
      existing.push(record.id)
      activeVideoTaskIdsByShot.set(shotId, existing)
    }

    // 组装 activeTasks
    if (isActive) {
      activeTasks.push({
        id: record.id,
        category: record.category === 'image' ? 'image' : 'video',
        status: record.status,
        targetId: shotId ?? '',
        targetType: 'shot',
      })
    }

    // 组装 costs
    const state = mapCostState(record.status)
    const isFinal = state !== 'active'
    costs.push({
      recordId: record.id,
      category: record.category === 'image' ? 'image' : 'video',
      state,
      estimatedCostCents: isFinal ? null : record.totalPriceCents ?? null,
      finalCostCents: isFinal ? record.totalPriceCents ?? null : null,
    })
  }

  // 5. 从 canvas_assets 建立活跃图片任务映射（characters/locations）
  const activeImageTaskIdsByCharacter = new Map<string, string[]>()
  const activeImageTaskIdsByLocation = new Map<string, string[]>()

  for (const asset of activeAssets) {
    // 活跃图片资产 → character/location.activeImageTaskIds
    if (['characterPortrait', 'characterTurnaround'].includes(asset.category) && asset.targetEntityType === 'character') {
      const existing = activeImageTaskIdsByCharacter.get(asset.targetEntityId) ?? []
      existing.push(asset.id)
      activeImageTaskIdsByCharacter.set(asset.targetEntityId, existing)
    }
    else if (asset.category === 'locationRef' && asset.targetEntityType === 'location') {
      const existing = activeImageTaskIdsByLocation.get(asset.targetEntityId) ?? []
      existing.push(asset.id)
      activeImageTaskIdsByLocation.set(asset.targetEntityId, existing)
    }

    // 组装 activeTasks（canvas_asset 也纳入）
    activeTasks.push({
      id: asset.id,
      category: mapAssetCategoryToTaskCategory(asset.category),
      status: asset.status,
      targetId: asset.targetEntityId,
      targetType: mapAssetCategoryToTargetType(asset.category),
    })
  }

  // 6. 终态 canvas_assets 也纳入 costs（文本/图片等非视频管线成本）
  for (const asset of terminalAssets) {
    const state = mapCostState(asset.status)
    const isFinal = state !== 'active'
    costs.push({
      recordId: asset.id,
      category: mapAssetCategoryToTaskCategory(asset.category),
      state,
      estimatedCostCents: isFinal ? null : asset.totalPriceCents ?? null,
      finalCostCents: isFinal ? asset.totalPriceCents ?? null : null,
    })
  }

  // 7. 组装 characters
  const characters: CanvasAssetsPoll['characters'] = detail.characters.map(c => ({
    characterId: c.id,
    name: c.name,
    referenceImageUrl: c.referenceImageUrl ?? null,
    turnaroundSheetUrl: c.turnaroundSheetUrl ?? null,
    activeImageTaskIds: activeImageTaskIdsByCharacter.get(c.id) ?? [],
  }))

  // 8. 组装 locations
  const locations: CanvasAssetsPoll['locations'] = detail.locations.map(l => ({
    locationId: l.id,
    name: l.name,
    referenceImageUrl: l.referenceImageUrl ?? null,
    activeImageTaskIds: activeImageTaskIdsByLocation.get(l.id) ?? [],
  }))

  // 9. 组装 shots
  const shots: CanvasAssetsPoll['shots'] = detail.shots.map(s => ({
    shotId: s.id,
    shotIndex: s.shotIndex,
    status: s.status,
    videoUrl: s.videoUrl ?? null,
    activeVideoTaskIds: activeVideoTaskIdsByShot.get(s.id) ?? [],
  }))

  return {
    scope: 'canvas',
    projectId,
    projectStatus: project.status,
    characters,
    locations,
    shots,
    activeTasks,
    costs,
    generatedAt: Date.now(),
  }
}
