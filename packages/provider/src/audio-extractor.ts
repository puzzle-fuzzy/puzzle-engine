/**
 * FFmpeg 音频提取 — 从视频文件中提取音频轨道
 *
 * 用 Bun.spawn 调用 ffmpeg 命令行工具，
 * 提取音频为 WAV 格式（Paraformer 要求的输入格式）。
 */

export interface AudioExtractionResult {
  /** 提取的音频文件路径 */
  audioPath: string
  /** 音频时长（毫秒） */
  durationMs: number
}

/**
 * 从视频文件中提取音频轨道
 *
 * 默认提取为 WAV 格式（16kHz 单声道，Paraformer 推荐输入格式）。
 * FFmpeg 命令：ffmpeg -i <video> -vn -acodec pcm_s16le -ar 16000 -ac 1 <output>
 *
 * @param videoPath - 输入视频文件的本地路径
 * @param outputDir - 音频输出目录（默认与视频同目录）
 * @returns 音频文件路径和时长信息
 */
export async function extractAudioFromVideo(
  videoPath: string,
  outputDir?: string,
): Promise<AudioExtractionResult> {
  const dir = outputDir ?? videoPath.substring(0, videoPath.lastIndexOf('/'))
  const audioPath = `${dir}/audio_${Date.now()}.wav`

  // 提取音频：-vn（去除视频）, -acodec pcm_s16le（WAV格式）, -ar 16000（16kHz）, -ac 1（单声道）
  const proc = Bun.spawn([
    'ffmpeg',
    '-i',
    videoPath,
    '-vn',
    '-acodec',
    'pcm_s16le',
    '-ar',
    '16000',
    '-ac',
    '1',
    '-y', // 覆盖已存在的输出文件
    audioPath,
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`FFmpeg 音频提取失败 (exit=${exitCode}): ${stderr.slice(0, 500)}`)
  }

  // 获取音频时长 — ffprobe
  const durationMs = await getMediaDurationMs(audioPath)

  return { audioPath, durationMs }
}

/**
 * 用 ffprobe 获取媒体文件时长（毫秒）
 */
export async function getMediaDurationMs(filePath: string): Promise<number> {
  const proc = Bun.spawn([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    // ffprobe 失败时返回 0（时长未知），不阻止后续流程
    return 0
  }

  const stdout = await new Response(proc.stdout).text()
  const seconds = Number.parseFloat(stdout.trim())
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : 0
}

/**
 * 用 ffprobe 获取视频分辨率
 */
export async function getVideoResolution(filePath: string): Promise<{ width: number, height: number } | null> {
  const proc = Bun.spawn([
    'ffprobe',
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=s=x:p=0',
    filePath,
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0)
    return null

  const stdout = await new Response(proc.stdout).text()
  const parts = stdout.trim().split('x')
  if (parts.length !== 2)
    return null

  const width = Number.parseInt(parts[0]!, 10)
  const height = Number.parseInt(parts[1]!, 10)
  return Number.isFinite(width) && Number.isFinite(height) ? { width, height } : null
}
