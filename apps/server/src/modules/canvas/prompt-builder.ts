import type { NormalizedCharacter, NormalizedLocation, NormalizedShot } from './continuity'

export type { NormalizedCharacter, NormalizedLocation, NormalizedShot }

function parseTimeRange(timeRange: string): { start: number; end: number } {
  const match = timeRange.match(/(\d+)s-(\d+)s/)
  if (!match) return { start: 0, end: 5 }
  return { start: Number.parseInt(match[1]), end: Number.parseInt(match[2]) }
}

function expandTimelineToPerSecond(timeline: Array<{ time: string; action: string }>): Array<{ time: string; action: string }> {
  const perSecond: Array<{ time: string; action: string }> = []

  for (const entry of timeline) {
    const { start, end } = parseTimeRange(entry.time)
    for (let second = start; second < end; second++) {
      perSecond.push({
        time: `${second}s-${second + 1}s`,
        action: entry.action,
      })
    }
  }

  return perSecond
}

function buildTimelineSection(
  timeline: Array<{ time: string; action: string }>,
  actionStart: string,
  actionEnd: string,
  duration: number,
): string {
  if (timeline && timeline.length > 0) {
    const perSecondTimeline = expandTimelineToPerSecond(timeline)
    const sections: string[] = []
    let currentAction = perSecondTimeline[0]?.action || ''
    let startTime = 0
    let endTime = 0

    for (let i = 0; i < perSecondTimeline.length; i++) {
      const entry = perSecondTimeline[i]
      if (entry.action !== currentAction || i === perSecondTimeline.length - 1) {
        if (currentAction) {
          if (startTime === endTime) {
            sections.push(`  ${startTime}s-${startTime + 1}s: ${currentAction}`)
          }
          else {
            sections.push(`  ${startTime}s-${endTime + 1}s: ${currentAction}`)
          }
        }
        currentAction = entry.action
        startTime = Number.parseInt(entry.time.split('-')[0])
        endTime = startTime
      }
      else {
        endTime = Number.parseInt(entry.time.split('-')[0])
      }
    }

    return sections.join('\n')
  }

  const fallback: string[] = []
  const totalSeconds = Math.floor(duration)

  for (let second = 0; second < totalSeconds; second++) {
    const action = second === totalSeconds - 1 ? actionEnd : actionStart
    fallback.push(`  ${second}s-${second + 1}s: ${action}`)
  }

  return fallback.join('\n')
}

export function buildShotVideoPrompt(args: {
  shot: NormalizedShot
  characters: NormalizedCharacter[]
  location: NormalizedLocation
  timeline?: Array<{ time: string; action: string }>
  environment?: { backgroundMotion?: string; lighting?: string; mood?: string; style?: string }
}): { videoPrompt: string; negativePrompt: string } {
  const { shot, characters, location, timeline, environment } = args

  const idToName = new Map(characters.map(c => [c.id, c.name]))

  const characterSection = characters
    .map(c => `Character "${c.name}": ${c.identityPrompt}`)
    .join('\n')

  const facingEntries = Object.entries(shot.continuity.characterFacing)
  const facingSection = facingEntries
    .map(([idOrName, dir]) => {
      const name = idToName.get(idOrName) || idOrName
      return `  ${name}: facing ${dir}`
    })
    .join('\n')

  const duration = shot.duration || 5
  const timelineSection = buildTimelineSection(
    timeline || [],
    shot.continuity.actionStart,
    shot.continuity.actionEnd,
    duration,
  )

  const environmentSection = environment
    ? `Background motion: ${environment.backgroundMotion || 'static'}
Lighting: ${environment.lighting || 'natural'}
Mood: ${environment.mood || 'neutral'}
Style: ${environment.style || 'cinematic'}`
    : ''

  const cameraSection = [
    `Shot size: ${shot.camera.shotSize}`,
    `Angle: ${shot.camera.angle}`,
    `Movement: ${shot.camera.movement}`,
    `Lens: ${shot.camera.lens}`,
  ].join(', ')

  const videoPrompt = `Character consistency:
${characterSection}

Scene consistency:
${location.scenePrompt}

Current shot:
${shot.narrative}

Frame-by-frame timeline (total ${duration}s):
${timelineSection}

Emotion continuity:
  Start emotion: ${shot.continuity.emotionStart}
  End emotion: ${shot.continuity.emotionEnd}

Character facing:
${facingSection}

${environmentSection ? `Environment:\n${environmentSection}\n` : ''}Camera:
${cameraSection}

Important requirements for high-coherence AI video:
- Each second must have explicit, meaningful action
- No static frames - continuous motion required
- Smooth transitions between consecutive seconds
- Maintain character appearance consistency across all frames
- Maintain costume and hairstyle consistency
- Keep scene structure and lighting consistent
- Do not cross the 180-degree axis
- Do not suddenly change character facing direction
- Do not suddenly change lighting or mood
- Do not introduce new characters mid-shot
- Natural, realistic human movements
- Cinematic quality with professional framing`

  const charNegatives = characters
    .map(c => c.negativePrompt || '')
    .filter(Boolean)
    .join(', ')

  const negativePrompt = [
    charNegatives,
    location.negativePrompt || '',
    'blurry, low quality, distorted faces, extra limbs, watermark, text overlay, motion blur, camera shake, static pose, frozen frame, sudden movement changes',
  ]
    .filter(Boolean)
    .join(', ')

  return { videoPrompt, negativePrompt }
}
