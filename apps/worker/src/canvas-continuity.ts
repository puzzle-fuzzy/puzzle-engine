import type { CanvasAssetOutput } from '@excuse/db'
import { runCanvasAssetStep, runContinuityPhase } from '@excuse/canvas-runtime'
import { updateCanvasProject } from '@excuse/db'
import { loadRunnableCanvasProject } from './canvas-execution'

export interface CanvasContinuityResult extends Record<string, unknown> {
  phase: 'continuity'
  projectId: string
  issuesFound: number
}

export async function executeCanvasContinuity(projectId: string, runId?: string): Promise<CanvasContinuityResult> {
  const detail = await loadRunnableCanvasProject(projectId)

  const accountId = detail.project.accountId
  const result = await runCanvasAssetStep<CanvasContinuityResult>({
    asset: {
      accountId,
      projectId,
      category: 'continuityReport',
      targetEntityType: 'project',
      targetEntityId: projectId,
      pipelineRunId: runId ?? undefined,
    },
    execute: async () => {
      const { issues } = await runContinuityPhase({ projectId, detail })

      const outputJson: CanvasAssetOutput = { type: 'json', data: { issuesCount: issues.length, issues } }
      return {
        result: { phase: 'continuity', projectId, issuesFound: issues.length },
        output: outputJson,
      }
    },
  })

  await updateCanvasProject(projectId, { status: 'continuity_checked' })
  return result
}
