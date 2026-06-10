const isWindows = process.platform === 'win32'

function killPort(port: number) {
  if (isWindows) {
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
  else {
    const result = Bun.spawnSync(['lsof', '-ti', `:${port}`])
    const pids = result.stdout?.toString().trim().split('\n').filter(Boolean)
    if (!pids?.length)
      return
    for (const pid of pids) {
      Bun.spawnSync(['kill', '-9', pid], { stderr: 'pipe' })
    }
  }
}

killPort(5007)
killPort(8007)
