/**
 * Canvas 资产轮询服务 — 组装项目资产和任务状态的一次性快照
 *
 * 核心职责：
 *   1. 获取项目 + 角色/场景/镜头实体数据
 *   2. 获取项目关联的所有 generation_records
 *   3. 内存分区：active（非终态）vs terminal
 *   4. 按 shotId 建立 activeVideoTaskIds 映射
 *   5. 组装 activeTasks、costs、generatedAt
 *
 * 注意：
 *   - character/location 参考图不走 generation_records，activeImageTaskIds 暂为空
 *   - shotId 是唯一可从 inputParams JSONB 中提取的 targetId
 *   - 这不是权威数据通道，ProjectDTO（getProjectDetail）仍是权威
 */
import type { CanvasAssetsPoll } from '@excuse/shared'
import {
  getCanvasProjectById,
  getCanvasProjectDetail,
  listCanvasGenerationRecordsByProject,
} from '@excuse/db'

/** generation record 非终态 status 列表 */
const ACTIVE_STATUSES = new Set(['pending', 'submitting', 'processing', 'saving_output'])

/** 将 generation record status 映射为 cost state */
function mapCostState(status: string): 'active' | 'completed' | 'failed' {
  if (status === 'succeeded')
    return 'completed'
  if (status === 'failed' || status === 'cancelled')
    return 'failed'
  return 'active'
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

  // 2. 获取实体数据（4 并行查询）
  const detail = await getCanvasProjectDetail(projectId)
  if (!detail)
    return null

  // 3. 获取所有 canvas 关联的 generation_records（一次查询）
  const genRecords = await listCanvasGenerationRecordsByProject(projectId)

  // 4. 按 shotId 分组活跃视频任务
  const activeVideoTaskIdsByShot = new Map<string, string[]>()
  const activeTasks: CanvasAssetsPoll['activeTasks'] = []
  const costs: CanvasAssetsPoll['costs'] = []

  for (const record of genRecords) {
    const isActive = ACTIVE_STATUSES.has(record.status)
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
        targetType: 'shot', // 目前只有 shot 有 shotId
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

  // 5. 组装 characters
  const characters: CanvasAssetsPoll['characters'] = detail.characters.map(c => ({
    characterId: c.id,
    name: c.name,
    referenceImageUrl: c.referenceImageUrl ?? null,
    turnaroundSheetUrl: c.turnaroundSheetUrl ?? null,
    activeImageTaskIds: [], // P3 补齐：character refs 不走 generation_records
  }))

  // 6. 组装 locations
  const locations: CanvasAssetsPoll['locations'] = detail.locations.map(l => ({
    locationId: l.id,
    name: l.name,
    referenceImageUrl: l.referenceImageUrl ?? null,
    activeImageTaskIds: [], // P3 补齐：location refs 不走 generation_records
  }))

  // 7. 组装 shots
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
