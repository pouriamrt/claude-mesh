import { mkdirSync, writeFileSync, chmodSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { resolveRelayUrl } from './relay-url.ts'
import { readTokenFile } from './token-file.ts'

function argValue(args: string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined
}

function readAdminToken(): string {
  const p = join(homedir(), '.claude-mesh', 'admin-token')
  if (!existsSync(p)) throw new Error(`admin token not found at ${p}. Run "mesh admin bootstrap --token-file <path>" first.`)
  return readTokenFile(p)
}

export interface AddUserOpts {
  relayUrl: string
  adminToken: string
  handle: string
  displayName: string
  tier: 'human' | 'admin'
  fetch?: typeof globalThis.fetch
  out?: (s: string) => void
}

interface AddUserResponse {
  handle: string
  display_name: string
  tier: 'human' | 'admin'
  pair_code: string
  expires_at: string
}

export async function runAdminAddUser(opts: AddUserOpts): Promise<void> {
  const fetchImpl = opts.fetch ?? globalThis.fetch
  const out = opts.out ?? ((s: string) => process.stdout.write(s + '\n'))
  const res = await fetchImpl(new URL('/v1/admin/users', opts.relayUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${opts.adminToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ handle: opts.handle, display_name: opts.displayName, tier: opts.tier })
  })
  const text = await res.text()
  if (res.status !== 201) throw new Error(`add-user failed: ${res.status} ${text}`)
  const r = JSON.parse(text) as AddUserResponse
  out(`OK Created "${r.handle}" (${r.tier})`)
  out(`OK Pair code: ${r.pair_code} (expires ${r.expires_at})`)
  out(`  Share with: mesh pair --relay ${opts.relayUrl} ${r.pair_code}`)
}

export async function runAdmin(args: string[]): Promise<void> {
  const [sub, ...rest] = args

  if (sub === 'bootstrap') {
    const file = argValue(rest, '--token-file')
    if (!file || !existsSync(file)) throw new Error('need --token-file <path>')
    const raw = readTokenFile(file)
    const dir = join(homedir(), '.claude-mesh')
    mkdirSync(dir, { recursive: true })
    const p = join(dir, 'admin-token')
    writeFileSync(p, raw, { mode: 0o600 })
    try { chmodSync(p, 0o600) } catch { /* Windows */ }
    process.stdout.write(`OK Admin token saved to ${p}\n`)
    return
  }

  const relayUrl = resolveRelayUrl(rest)
  const adminToken = readAdminToken()
  if (sub === 'add-user') {
    const handle = argValue(rest, '--handle')
    if (!handle) throw new Error('missing --handle <name>')
    const displayName = argValue(rest, '--display-name') ?? handle
    const tier = (argValue(rest, '--tier') ?? 'human') as 'human' | 'admin'
    await runAdminAddUser({ relayUrl, adminToken, handle, displayName, tier })
    return
  }
  if (sub === 'disable-user') {
    const h = rest[0]
    if (!h) throw new Error('usage: mesh admin disable-user <handle>')
    const res = await fetch(new URL(`/v1/admin/users/${h}`, relayUrl),
      { method: 'DELETE', headers: { authorization: `Bearer ${adminToken}` } })
    if (res.status !== 200) throw new Error(`disable failed: ${res.status}`)
    process.stdout.write(`OK Disabled ${h}\n`)
    return
  }
  if (sub === 'revoke-token') {
    const id = rest[0]
    if (!id) throw new Error('usage: mesh admin revoke-token <token_id>')
    const res = await fetch(new URL(`/v1/admin/tokens/${id}`, relayUrl),
      { method: 'DELETE', headers: { authorization: `Bearer ${adminToken}` } })
    if (res.status !== 200) throw new Error(`revoke failed: ${res.status}`)
    process.stdout.write(`OK Revoked ${id}\n`)
    return
  }
  if (sub === 'audit') {
    const since = argValue(rest, '--since') ?? '1970-01-01T00:00:00Z'
    const res = await fetch(new URL(`/v1/admin/audit?since=${encodeURIComponent(since)}`, relayUrl),
      { headers: { authorization: `Bearer ${adminToken}` } })
    process.stdout.write(await res.text() + '\n')
    return
  }
  throw new Error('commands: bootstrap, add-user, disable-user, revoke-token, audit')
}
