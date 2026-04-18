import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { isValidMessageId, type Envelope } from '@claude-mesh/shared'
import { bearerAuth, type AuthContext } from '../auth/middleware.ts'
import type { Deps } from '../deps.ts'
import type { Subscriber } from '../fanout.ts'

const PING_INTERVAL_MS = 25_000

export function streamRoute(deps: Deps) {
  const app = new Hono<{ Variables: AuthContext }>()
  app.use('*', bearerAuth(deps.db, { requireTier: 'human' }))

  app.get('/', c => {
    const since = c.req.query('since')
    if (since !== undefined && !isValidMessageId(since)) {
      return c.json({ error: 'invalid_since' }, 400)
    }

    return streamSSE(c, async stream => {
      const team_id = c.get('team_id')
      const handle = c.get('human').handle

      const backlog = since
        ? deps.store.fetchSince(team_id, handle, since)
        : deps.store.fetchPendingFor(team_id, handle)
      for (const e of backlog) {
        await stream.writeSSE({ event: 'message', data: JSON.stringify(e) })
        deps.store.markDelivered(e.id)
      }

      const queue: string[] = []
      let notify: (() => void) | null = null
      const sub: Subscriber = {
        handle,
        team_id,
        deliver: (e: Envelope) => {
          queue.push(JSON.stringify(e))
          notify?.()
        }
      }
      deps.fanout.subscribe(sub)

      const pingTimer = setInterval(() => {
        stream.writeSSE({ event: 'ping', data: String(Date.now()) }).catch(() => { /* client gone */ })
      }, PING_INTERVAL_MS)

      const cleanup = () => {
        deps.fanout.unsubscribe(sub)
        clearInterval(pingTimer)
      }
      c.req.raw.signal?.addEventListener('abort', cleanup)

      try {
        while (!c.req.raw.signal?.aborted) {
          if (queue.length === 0) {
            await new Promise<void>(resolve => {
              notify = () => { notify = null; resolve() }
            })
            continue
          }
          const payload = queue.shift()!
          await stream.writeSSE({ event: 'message', data: payload })
          const parsed = JSON.parse(payload) as Envelope
          deps.store.markDelivered(parsed.id)
        }
      } finally {
        cleanup()
      }
    })
  })
  return app
}
