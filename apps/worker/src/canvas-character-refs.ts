import type { WorkerConfig } from './config'
import { generateCanvasImageAsset } from '@excuse/canvas-runtime'
import {
  createCanvasAsset,
  markCanvasAssetFailed,
  markCanvasAssetRunning,
  updateCanvasCharacter,
  updateCanvasProject,
} from '@excuse/db'
import {
  AssetStorage,
  getModelById,
} from '@excuse/provider'
import {
  createDashScopeClient,
  getImageModel,
  loadRunnableCanvasProject,
} from './canvas-execution'

interface CharacterRefSpec {
  assetId: string
  characterId: string
  imageModel: string
  imageModelConfig: NonNullable<ReturnType<typeof getModelById>>
  prompt: string
  prefix: string
  updateField: 'referenceImageUrl' | 'turnaroundSheetUrl'
  client: ReturnType<typeof createDashScopeClient>
  storage: AssetStorage
}

export interface CanvasCharacterRefsResult extends Record<string, unknown> {
  phase: 'characterRefs'
  projectId: string
  charactersProcessed: number
  charactersSkipped: number
  charactersFailed: number
  portraitsCreated: number
  turnaroundsCreated: number
}

export async function executeCanvasCharacterRefs(
  projectId: string,
  workerConfig: WorkerConfig,
  runId?: string,
): Promise<CanvasCharacterRefsResult> {
  const detail = await loadRunnableCanvasProject(projectId)
  const project = detail.project
  const accountId = project.accountId
  const imageModel = getImageModel(project.modelPreferencesJson)
  const imageModelConfig = getModelById(imageModel)
  if (!imageModelConfig)
    throw new Error(`未知图片模型：${imageModel}`)

  const client = createDashScopeClient(workerConfig)
  const storage = new AssetStorage({ storageRoot: workerConfig.storageRoot, oss: workerConfig.oss })
  let charactersProcessed = 0
  let charactersSkipped = 0
  let charactersFailed = 0
  let portraitsCreated = 0
  let turnaroundsCreated = 0

  for (const character of detail.characters) {
    if (character.locked || !character.identityPrompt || character.referenceImageUrl) {
      charactersSkipped += 1
      continue
    }

    charactersProcessed += 1

    const portraitPrompt = `${character.identityPrompt}, portrait photo, neutral expression, solid background, front view, high quality`
    const turnaroundPrompt = `${character.identityPrompt}, character turnaround sheet showing front view, side view, and back view, white background, character design sheet`

    const portraitAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterPortrait',
      targetEntityType: 'character',
      targetEntityId: character.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: portraitPrompt, size: '2048*2048', n: 1 },
    })

    const turnaroundAsset = await createCanvasAsset({
      accountId,
      projectId,
      category: 'characterTurnaround',
      targetEntityType: 'character',
      targetEntityId: character.id,
      pipelineRunId: runId ?? undefined,
      model: imageModel,
      inputJson: { prompt: turnaroundPrompt, size: '2048*2048', n: 1 },
    })

    try {
      await markCanvasAssetRunning(portraitAsset.id)
      await markCanvasAssetRunning(turnaroundAsset.id)

      const portraitCreated = await generateCharacterRef({
        assetId: portraitAsset.id,
        characterId: character.id,
        imageModel,
        imageModelConfig,
        prompt: portraitPrompt,
        prefix: 'portrait',
        updateField: 'referenceImageUrl',
        client,
        storage,
      })
      if (portraitCreated)
        portraitsCreated += 1

      const turnaroundCreated = await generateCharacterRef({
        assetId: turnaroundAsset.id,
        characterId: character.id,
        imageModel,
        imageModelConfig,
        prompt: turnaroundPrompt,
        prefix: 'turnaround',
        updateField: 'turnaroundSheetUrl',
        client,
        storage,
      })
      if (turnaroundCreated)
        turnaroundsCreated += 1
    }
    catch (error) {
      charactersFailed += 1
      const errorMessage = error instanceof Error ? error.message : String(error)
      await markCanvasAssetFailed(portraitAsset.id, errorMessage).catch(() => {})
      await markCanvasAssetFailed(turnaroundAsset.id, errorMessage).catch(() => {})
    }
  }

  await updateCanvasProject(projectId, { status: 'refs_ready' })

  return {
    phase: 'characterRefs',
    projectId,
    charactersProcessed,
    charactersSkipped,
    charactersFailed,
    portraitsCreated,
    turnaroundsCreated,
  }
}

async function generateCharacterRef(args: CharacterRefSpec): Promise<boolean> {
  const generated = await generateCanvasImageAsset({
    assetId: args.assetId,
    imageModel: args.imageModel,
    imageModelConfig: args.imageModelConfig,
    prompt: args.prompt,
    subDir: `canvas/${args.characterId}`,
    prefix: args.prefix,
    errorMessage: '角色参考图生成失败',
    client: args.client,
    storage: args.storage,
  })
  if (!generated)
    return false

  await updateCanvasCharacter(args.characterId, { [args.updateField]: generated.publicUrl })
  return true
}
