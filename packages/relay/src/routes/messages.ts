import { Hono } from 'hono'
import { OutboundMessageSchema, TEAM_BROADCAST_HANDLE, type Envelope } from '@claude-mesh/shared'
import { bearerAuth, type AuthContext } from '../auth/middleware.ts'
import { hashToken } from '../auth/hash.ts'
import type { Deps } from '../deps.ts'

export function messagesRoute(deps: Deps) {
  const app = new Hono<{ Variables: AuthContext }>()
  app.use('*', bearerAuth(deps.db, { requireTier: 'human' }))

  app.post('/', async c => {
    const idemKey = c.req.header('idempotency-key')
    const tokenId = c.get('token').id
    if (idemKey) {
      const row = deps.db.prepare(
        "SELECT response_json FROM idempotency_key WHERE key_hash=? AND token_id=?"
      ).get(hashToken(`${tokenId}:${idemKey}`), tokenId) as { response_json: string } | undefined
      if (row) return c.body(row.response_json, 201, { 'content-type': 'application/json' })
    }

    const raw = await c.req.json().catch(() => null)
    const parsed = OutboundMessageSchema.safeParse(raw)
    if (!parsed.success) {
      return c.json({ error: 'invalid_body', issues: parsed.error.issues }, 400)
    }

    let envelope: Envelope
    try {
      envelope = deps.store.insert(c.get('team_id'), c.get('human').handle, parsed.data)
    } catch (err) {
      const message = err instanceof Error ? err.message : ''
      return c.json({ error: 'invalid_message', message }, 400)
    }

    deps.fanout.deliver(envelope)
    const isDelivered = envelope.to === TEAM_BROADCAST_HANDLE
      ? deps.fanout.onlineHandles(envelope.team).some(h => h !== envelope.from)
      : deps.fanout.isOnline(envelope.team, envelope.to)
    if (isDelivered) {
      deps.store.markDelivered(envelope.id)
      envelope = { ...envelope, delivered_at: deps.now().toISOString() }
    }

    const responseJson = JSON.stringify(envelope)
    if (idemKey) {
      deps.db.prepare(`
        INSERT OR IGNORE INTO idempotency_key(key_hash, token_id, response_json, created_at)
        VALUES (?, ?, ?, ?)
      `).run(hashToken(`${tokenId}:${idemKey}`), tokenId, responseJson, deps.now().toISOString())
    }
    return c.body(responseJson, 201, { 'content-type': 'application/json' })
  })

  return app
}
