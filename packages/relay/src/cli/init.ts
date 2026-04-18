import { ulid } from 'ulid'
import { PAIR_CODE_TTL_MS } from '@claude-mesh/shared'
import { generateRawToken, hashToken } from '../auth/hash.ts'
import { generatePairCode } from '../auth/pair-code.ts'
import type { Db } from '../db/db.ts'

export interface InitOpts {
  team_id: string
  team_name: string
  admin_handle: string
  admin_display_name: string
}

export interface InitResult {
  admin_token: string
  human_pair_code: string
  human_pair_expires_at: string
}

export function initTeam(db: Db, opts: InitOpts): InitResult {
  const existing = db.prepare("SELECT COUNT(*) AS c FROM team").get() as { c: number }
  if (existing.c > 0) throw new Error('relay database already initialized')

  const now = new Date().toISOString()
  const humanId = `h_${ulid()}`
  const tokenId = `tk_${ulid()}`
  const adminRaw = generateRawToken()
  const humanCode = generatePairCode()
  const expires = new Date(Date.now() + PAIR_CODE_TTL_MS).toISOString()

  const tx = db.transaction(() => {
    db.prepare("INSERT INTO team(id,name,retention_days,created_at) VALUES (?,?,?,?)")
      .run(opts.team_id, opts.team_name, 7, now)
    db.prepare("INSERT INTO human(id,team_id,handle,display_name,created_at) VALUES (?,?,?,?,?)")
      .run(humanId, opts.team_id, opts.admin_handle, opts.admin_display_name, now)
    db.prepare("INSERT INTO token(id,human_id,token_hash,label,tier,created_at) VALUES (?,?,?,?,?,?)")
      .run(tokenId, humanId, hashToken(adminRaw), 'bootstrap-admin', 'admin', now)
    db.prepare("INSERT INTO pair_code(code_hash,human_id,tier,expires_at,created_at) VALUES (?,?,?,?,?)")
      .run(hashToken(humanCode), humanId, 'human', expires, now)
    db.prepare("INSERT INTO audit_log(team_id,at,actor_human_id,event,detail_json) VALUES (?,?,?,?,?)")
      .run(opts.team_id, now, humanId, 'team.init', JSON.stringify({ admin_handle: opts.admin_handle }))
  })
  tx()

  return { admin_token: adminRaw, human_pair_code: humanCode, human_pair_expires_at: expires }
}
