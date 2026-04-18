import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../../src/db/db.ts'
import { MessageStore } from '../../src/messages/store.ts'
import { Fanout } from '../../src/fanout.ts'
import { PresenceRegistry } from '../../src/presence/registry.ts'
import { buildApp } from '../../src/app.ts'
import { hashToken, generateRawToken } from '../../src/auth/hash.ts'

function seedAdmin(db: Db) {
  const now = new Date().toISOString()
  db.prepare("INSERT INTO team(id,name,retention_days,created_at) VALUES (?,?,?,?)").run('t1','acme',7,now)
  db.prepare("INSERT INTO human(id,team_id,handle,display_name,created_at) VALUES (?,?,?,?,?)").run('h_alice','t1','alice','Alice', now)
  const raw = generateRawToken()
  db.prepare("INSERT INTO token(id,human_id,token_hash,label,tier,created_at) VALUES (?,?,?,?,?,?)")
    .run('tk_admin','h_alice',hashToken(raw),'admin','admin',now)
  return raw
}

function appFor(db: Db) {
  return buildApp({
    db, store: new MessageStore(db), fanout: new Fanout(),
    presence: new PresenceRegistry(), now: () => new Date(),
  })
}

describe('admin routes', () => {
  let db: Db
  let app: ReturnType<typeof buildApp>
  let adminToken: string
  beforeEach(() => { db = openDatabase(':memory:'); adminToken = seedAdmin(db); app = appFor(db) })

  async function admin(path: string, method: 'GET'|'POST'|'DELETE', body?: unknown) {
    return app.request(`/v1/admin${path}`, {
      method,
      headers: {
        authorization: `Bearer ${adminToken}`,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  }

  it('creates user and issues pair code', async () => {
    const res = await admin('/users', 'POST', { handle: 'bob', display_name: 'Bob' })
    expect(res.status).toBe(201)
    const j = await res.json() as any
    expect(j.handle).toBe('bob')
    expect(j.pair_code).toMatch(/^MESH-/)
  })

  it('rejects duplicate handle', async () => {
    await admin('/users', 'POST', { handle: 'bob', display_name: 'Bob' })
    const res2 = await admin('/users', 'POST', { handle: 'bob', display_name: 'Bob2' })
    expect(res2.status).toBe(409)
  })

  it('disables a user', async () => {
    await admin('/users', 'POST', { handle: 'bob', display_name: 'Bob' })
    const res = await admin('/users/bob', 'DELETE')
    expect(res.status).toBe(200)
    const human = db.prepare("SELECT disabled_at FROM human WHERE handle='bob'").get() as any
    expect(human.disabled_at).toBeTruthy()
  })

  it('lists tokens with masked hashes', async () => {
    const res = await admin('/tokens', 'GET')
    expect(res.status).toBe(200)
    const list = await res.json() as any[]
    expect(list[0]).toHaveProperty('id')
    expect(list[0]).not.toHaveProperty('token_hash')
  })

  it('revokes a specific token', async () => {
    const list = await (await admin('/tokens', 'GET')).json() as any[]
    const res = await admin(`/tokens/${list[0].id}`, 'DELETE')
    expect(res.status).toBe(200)
  })

  it('dumps audit log', async () => {
    await admin('/users', 'POST', { handle: 'bob', display_name: 'Bob' })
    const res = await admin('/audit?since=2020-01-01T00:00:00Z', 'GET')
    expect(res.status).toBe(200)
    const rows = await res.json() as any[]
    expect(rows.some(r => r.event === 'user.create')).toBe(true)
  })

  it('rejects human-tier token on admin routes', async () => {
    const now = new Date().toISOString()
    const rawH = generateRawToken()
    db.prepare("INSERT INTO token(id,human_id,token_hash,label,tier,created_at) VALUES (?,?,?,?,?,?)")
      .run('tk_h', 'h_alice', hashToken(rawH), 'laptop', 'human', now)
    const res = await app.request('/v1/admin/tokens',
      { headers: { authorization: `Bearer ${rawH}` } })
    expect(res.status).toBe(401)
  })
})
