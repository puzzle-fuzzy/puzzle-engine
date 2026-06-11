import type { CanvasCharacterRow, CanvasContinuityRow, CanvasLocationRow, CanvasProjectRow, CanvasShotRow } from '@excuse/db'
import type {
  CanvasModelPreferences,
  CharacterDTO,
  CharacterProfile,
  ContinuityIssue,
  LocationDTO,
  LocationProfile,
  ProjectDTO,
  ShotDTO,
} from '@excuse/shared'

export function mapCharacter(row: CanvasCharacterRow): CharacterDTO {
  let profile: CharacterProfile | null = null
  if (row.profileJson) {
    try {
      profile = row.profileJson as unknown as CharacterProfile
    }
    catch { profile = null }
  }

  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    role: row.role ?? null,
    description: row.description ?? null,
    profile,
    identityPrompt: row.identityPrompt ?? null,
    negativePrompt: row.negativePrompt ?? null,
    referenceImageUrl: row.referenceImageUrl ?? null,
    turnaroundSheetUrl: row.turnaroundSheetUrl ?? null,
    locked: row.locked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function mapLocation(row: CanvasLocationRow): LocationDTO {
  let profile: LocationProfile | null = null
  if (row.profileJson) {
    try {
      profile = row.profileJson as unknown as LocationProfile
    }
    catch { profile = null }
  }

  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    type: row.type,
    profile,
    scenePrompt: row.scenePrompt ?? null,
    negativePrompt: row.negativePrompt ?? null,
    referenceImageUrl: row.referenceImageUrl ?? null,
    locked: row.locked,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function mapShot(row: CanvasShotRow): ShotDTO {
  return {
    id: row.id,
    projectId: row.projectId,
    shotIndex: row.shotIndex,
    duration: row.duration,
    locationId: row.locationId ?? null,
    characterIds: row.characterIdsJson ?? [],
    narrative: row.narrative,
    camera: row.cameraJson ?? {},
    continuity: row.continuityJson ?? {},
    timeline: row.timelineJson ?? null,
    environment: row.environmentJson ?? null,
    videoPrompt: row.videoPrompt ?? null,
    negativePrompt: row.negativePrompt ?? null,
    videoTaskId: row.videoTaskId ?? null,
    videoUrl: row.videoUrl ?? null,
    status: row.status,
    errorMessage: row.errorMessage ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function mapProjectDetail(
  project: CanvasProjectRow,
  characters: CanvasCharacterRow[],
  locations: CanvasLocationRow[],
  shots: CanvasShotRow[],
  continuityReport: CanvasContinuityRow | null,
): ProjectDTO {
  let continuityIssues: ContinuityIssue[] = []
  if (continuityReport?.issuesJson) {
    try {
      continuityIssues = continuityReport.issuesJson as unknown as ContinuityIssue[]
    }
    catch { continuityIssues = [] }
  }

  return {
    id: project.id,
    accountId: project.accountId,
    title: project.title ?? null,
    storyText: project.storyText,
    status: project.status,
    analysis: project.analysisJson as unknown as ProjectDTO['analysis'] ?? null,
    modelPreferences: (project.modelPreferencesJson ?? null) as unknown as CanvasModelPreferences | null,
    characters: characters.map(mapCharacter),
    locations: locations.map(mapLocation),
    shots: shots.map(mapShot),
    continuityIssues,
    canvasLayout: project.canvasLayout ?? null,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }
}
