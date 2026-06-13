import type { CanvasAssetOutput } from '@excuse/db'
import type { WorkerConfig } from './config'
import { generateCharacterEntity, runCanvasAssetStep } from '@excuse/canvas-runtime'
import {
  deleteCanvasCharactersByProject,
  deleteCanvasShotsByProject,
  getCanvasProjectById,
  updateCanvasProject,
} from '@excuse/db'
import {
  assertCanvasProjectNotGenerating,
  createDashScopeClient,
  getTextModel,
} from './canvas-execution'

export interface CanvasCharactersResult extends Record<string, unknown> {
  phase: 'characters'
  projectId: string
  charactersCreated: number
  charactersFailed: number
}

export async function executeCanvasCharacters(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasCharactersResult> {
  const project = await getCanvasProjectById(projectId)
  if (!project || !project.analysisJson)
    throw new Error('项目不存在或未分析')
  assertCanvasProjectNotGenerating(project.status)

  const analysis = project.analysisJson
  const accountId = project.accountId
  const textModel = getTextModel(project.modelPreferencesJson)
  const client = createDashScopeClient(workerConfig)
  let charactersCreated = 0
  let charactersFailed = 0

  await deleteCanvasCharactersByProject(projectId, { excludeLocked: true })
  await deleteCanvasShotsByProject(projectId)

  for (const name of analysis.characterNames) {
    try {
      await runCanvasAssetStep({
        asset: {
          accountId,
          projectId,
          category: 'characterProfile',
          targetEntityType: 'project',
          targetEntityId: projectId,
          pipelineRunId: runId ?? undefined,
          model: textModel,
        },
        execute: async () => {
          const result = await generateCharacterEntity({ projectId, storyText: project.storyText, analysis, name, client, textModel })
          const output: CanvasAssetOutput = { type: 'json', data: { ...result.profile } }
          return {
            result: undefined,
            output,
          }
        },
      })
      charactersCreated += 1
    }
    catch {
      charactersFailed += 1
    }
  }

  await updateCanvasProject(projectId, { status: 'characters_ready' })

  return {
    phase: 'characters',
    projectId,
    charactersCreated,
    charactersFailed,
  }
}
