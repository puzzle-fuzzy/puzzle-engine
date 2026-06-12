/**
 * FFmpeg 字幕烧录 — 将 ASS 格式字幕嵌入视频
 *
 * 用 Bun.spawn 调用 ffmpeg 命令行工具，
 * 将 ASS 字幕文件烧录（hardsub）到视频中。
 *
 * 命令模板：
 *   ffmpeg -i <video> -vf "ass=<ass_path>" -c:a copy <output>
 *
 * 或者直接从 ASS 内容字符串写入临时文件再烧录。
 */

export interface BurnResult {
  /** 输出视频文件路径 */
  outputPath: string
  /** 输出文件大小（字节） */
  fileSize: number
}

/**
 * 将 ASS 字幕烧录到视频中
 *
 * 步骤：
 *   1. 将 assContent 写入临时 ASS 文件
 *   2. 用 FFmpeg -vf "ass=<path>" 烧录字幕到视频
 *   3. 返回输出视频路径和文件大小
 *
 * @param videoPath - 输入视频文件的本地路径
 * @param assContent - ASS 格式字幕内容字符串
 * @param outputDir - 输出目录（默认与视频同目录）
 * @returns 输出视频路径和文件大小
 */
export async function burnSubtitlesToVideo(
  videoPath: string,
  assContent: string,
  outputDir?: string,
): Promise<BurnResult> {
  const dir = outputDir ?? videoPath.substring(0, videoPath.lastIndexOf('/'))

  // 1. 写入临时 ASS 文件
  const assPath = `${dir}/subtitle_${Date.now()}.ass`
  await Bun.write(assPath, assContent)

  // 2. FFmpeg 烧录字幕
  const outputPath = `${dir}/output_${Date.now()}.mp4`

  const proc = Bun.spawn([
    'ffmpeg',
    '-i',
    videoPath,
    '-vf',
    `ass=${assPath}`,
    '-c:a',
    'copy', // 音频直接复制，不重新编码
    '-y', // 覆盖已存在的输出文件
    outputPath,
  ], {
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const exitCode = await proc.exited
  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text()
    throw new Error(`FFmpeg 字幕烧录失败 (exit=${exitCode}): ${stderr.slice(0, 500)}`)
  }

  // 3. 获取输出文件大小
  const file = Bun.file(outputPath)
  const fileSize = file.size

  // 4. 清理临时 ASS 文件
  try {
    await Bun.file(assPath).delete()
  }
  catch {
    // 临时文件清理失败不影响结果
  }

  return { outputPath, fileSize }
}
