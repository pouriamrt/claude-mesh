import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export function ensureMcpRegistered(): void {
  const path = join(homedir(), '.claude.json')
  let json: Record<string, unknown> = {}
  if (existsSync(path)) {
    try { json = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown> }
    catch { json = {} }
  }
  const mcpServers = (json.mcpServers as Record<string, unknown> | undefined) ?? {}
  const here = dirname(fileURLToPath(import.meta.url))
  const entry = {
    command: process.execPath,
    args: [resolve(join(here, 'index.js'))]
  }
  if (JSON.stringify(mcpServers['claude-mesh-peers']) === JSON.stringify(entry)) return
  mcpServers['claude-mesh-peers'] = entry
  json.mcpServers = mcpServers
  writeFileSync(path, JSON.stringify(json, null, 2))
}
