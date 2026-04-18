import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { ulid } from 'ulid'

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

export async function runSend(args: string[]): Promise<void> {
  const to = args[0]
  const content = args[1]
  if (!to || !content) {
    throw new Error('usage: mesh send <to> <content> [--relay <url>]')
  }
  const relayUrl = argValue(args, '--relay') ?? process.env.MESH_RELAY
  if (!relayUrl) throw new Error('missing --relay <url>')
  const token = readFileSync(join(homedir(), '.claude-mesh', 'token'), 'utf8').trim()
  const res = await fetch(new URL('/v1/messages', relayUrl), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'idempotency-key': ulid().toLowerCase(),
    },
    body: JSON.stringify({ to, kind: 'chat', content }),
  })
  const text = await res.text()
  if (res.status !== 201) throw new Error(`send failed: ${res.status} ${text}`)
  process.stdout.write(text + '\n')
}
