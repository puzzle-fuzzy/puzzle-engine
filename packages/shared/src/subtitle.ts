import type { Serialize, SubtitleProjectRow } from '@excuse/db'
import type { EntityResponse, ListResponse, MutationOkResponse } from './api-response'

export type {
  SubtitleSentence,
  SubtitleStyleConfig,
  SubtitleStylePreset,
} from '@excuse/subtitle-engine'
export {
  getDefaultStyleConfig,
  getPresetById,
  sentencesToAss,
  SUBTITLE_STYLE_PRESETS,
} from '@excuse/subtitle-engine'

export type SubtitleProjectDTO = Serialize<SubtitleProjectRow>

export type SubtitleProjectResponse = EntityResponse<SubtitleProjectDTO>

export type SubtitleProjectListResponse = ListResponse<SubtitleProjectDTO>

export type SubtitleMutationOkResponse = MutationOkResponse
