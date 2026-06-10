function killPort(port: number) {
  const result = Bun.spawnSync(['cmd', '/c', `netstat -ano | findstr :${port} | findstr LISTENING`])
  const lines = result.stdout?.toString().trim().split('\n').filter(Boolean)
  if (!lines?.length)
    return
  for (const line of lines) {
    const pid = line.trim().split(/\s+/).pop()
    if (pid)
      Bun.spawnSync(['taskkill', '/PID', pid, '/F'], { stderr: 'pipe' })
  }
}

killPort(5007)
killPort(8007)
