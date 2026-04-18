import { spawn } from 'node:child_process'

export interface DriveOpts {
  cwd: string
  prompt: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export async function drive(opts: DriveOpts): Promise<string> {
  const driver = process.env.CLAUDE_DRIVER ?? ''
  if (driver === 'agent-sdk') {
    // @ts-expect-error — optional peer dependency installed only when agent-sdk driver is selected
    const mod = await import('@anthropic-ai/claude-agent-sdk').catch(() => null)
    const query = (mod as { query?: (o: unknown) => AsyncIterable<{ type: string; text?: string }> } | null)?.query
    if (!query) throw new Error('agent-sdk not installed')
    const out: string[] = []
    for await (const msg of query({ prompt: opts.prompt, options: { cwd: opts.cwd, env: opts.env } })) {
      if (msg.type === 'text' && msg.text) out.push(msg.text)
    }
    return out.join('\n')
  }
  return new Promise((resolve, reject) => {
    const p = spawn('claude', ['--print', '--dangerously-load-development-channels', 'server:claude-mesh-peers'], {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env, HOME: opts.cwd },
    })
    let out = ''
    p.stdout.on('data', d => { out += d.toString() })
    p.on('close', code => code === 0 ? resolve(out) : reject(new Error(`claude exited ${code}: ${out}`)))
    p.stdin.end(opts.prompt)
    if (opts.timeoutMs) setTimeout(() => p.kill('SIGKILL'), opts.timeoutMs).unref()
  })
}

/** Gate L3 scenario tests that need a real Claude. Opt in explicitly via CLAUDE_DRIVER env var. */
export function canDrive(): boolean {
  return process.env.CLAUDE_DRIVER === 'cli' || process.env.CLAUDE_DRIVER === 'agent-sdk'
}
