import type { CanvasAssetOutput } from '@excuse/db'
import type { NovelAnalysis } from '@excuse/shared'
import type { WorkerConfig } from './config'
import { runAnalysisPhase, runCanvasAssetStep } from '@excuse/canvas-runtime'
import { getCanvasProjectById } from '@excuse/db'
import { createDashScopeClient, getTextModel } from './canvas-execution'

export interface CanvasAnalysisResult extends Record<string, unknown> {
  phase: 'analyze'
  projectId: string
  analysis: NovelAnalysis
}

export async function executeCanvasAnalysis(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasAnalysisResult> {
  const project = await getCanvasProjectById(projectId)
  if (!project)
    throw new Error('项目不存在')

  const textModel = getTextModel(project.modelPreferencesJson)

  return runCanvasAssetStep<CanvasAnalysisResult>({
    asset: {
      accountId: project.accountId,
      projectId,
      category: 'analysis',
      targetEntityType: 'project',
      targetEntityId: projectId,
      pipelineRunId: runId ?? undefined,
      model: textModel,
    },
    execute: async () => {
      const { analysis } = await runAnalysisPhase({
        projectId,
        storyText: project.storyText,
        isReanalysis: project.status !== 'draft',
        client: createDashScopeClient(workerConfig),
        textModel,
      })
      const output: CanvasAssetOutput = { type: 'json', data: { ...analysis } }
      return {
        result: { phase: 'analyze', projectId, analysis },
        output,
      }
    },
  })
}
