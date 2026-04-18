#!/usr/bin/env node
import { runPair } from './cli/pair.ts'
import { ensureMcpRegistered } from './mcp-registration.ts'

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

async function main(): Promise<void> {
  const [, , cmd, ...args] = process.argv
  if (cmd === 'pair') {
    const relayUrl = argValue(args, '--relay') ?? process.env.MESH_RELAY ?? ''
    const pairCode = args.find(a => /^MESH-/.test(a)) ?? process.env.MESH_PAIR_CODE ?? ''
    const label = argValue(args, '--label') ?? process.env.HOSTNAME ?? 'device'
    if (!relayUrl || !pairCode) {
      console.error('usage: mesh pair --relay <url> <pair-code> [--label <device>]')
      process.exit(2)
    }
    await runPair({ relayUrl, pairCode, deviceLabel: label })
    ensureMcpRegistered()
    console.log('OK MCP server entry added to ~/.claude.json under "claude-mesh-peers"')
    return
  }
  if (cmd === 'admin') {
    const { runAdmin } = await import('./cli/admin.ts')
    await runAdmin(args)
    return
  }
  if (cmd === 'respond') {
    const { runRespond } = await import('./cli/respond.ts')
    await runRespond(args)
    return
  }
  if (cmd === 'send') {
    const { runSend } = await import('./cli/send.ts')
    await runSend(args)
    return
  }
  console.error('commands: pair, admin, respond, send')
  process.exit(2)
}

main().catch(err => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
