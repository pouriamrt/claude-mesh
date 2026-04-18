#!/usr/bin/env node
import { openDatabase } from './db/db.ts'
import { initTeam } from './cli/init.ts'
import { startServer } from './cli/serve.ts'
import { writeFileSync, chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createInterface } from 'node:readline'
import { ulid } from 'ulid'

async function prompt(q: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => rl.question(q, a => { rl.close(); res(a.trim()) }))
}

async function main() {
  const [, , cmd] = process.argv
  const dataDir = process.env.MESH_DATA ?? '/data'
  const dbPath = join(dataDir, 'mesh.sqlite')
  const port = Number(process.env.PORT ?? 443)
  const host = process.env.HOST ?? '0.0.0.0'

  if (cmd === 'init') {
    if (existsSync(dbPath)) {
      console.error('refusing to init: db exists at', dbPath)
      process.exit(1)
    }
    mkdirSync(dirname(dbPath), { recursive: true })
    const db = openDatabase(dbPath)
    const team_name = await prompt('Team name: ')
    const admin_handle = await prompt('Admin handle: ')
    const admin_display_name = await prompt('Admin display name: ')
    const r = initTeam(db, { team_id: `team_${ulid()}`, team_name, admin_handle, admin_display_name })

    const adminTokenPath = join(dataDir, 'admin.token')
    const paircodePath = join(dataDir, `${admin_handle}.paircode`)
    writeFileSync(adminTokenPath, r.admin_token)
    chmodSync(adminTokenPath, 0o600)
    writeFileSync(paircodePath, r.human_pair_code)
    chmodSync(paircodePath, 0o600)
    console.log(`OK Team "${team_name}" created`)
    console.log(`OK Admin-tier token written to ${adminTokenPath}`)
    console.log(`OK Human-tier pair code for "${admin_handle}" written to ${paircodePath} (expires ${r.human_pair_expires_at})`)
    return
  }

  startServer({ db_path: dbPath, port, host })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { console.error(err); process.exit(1) })
}
