import { Hono } from 'hono'
import type { Deps } from './deps.ts'
import { messagesRoute } from './routes/messages.ts'
import { streamRoute } from './routes/stream.ts'
import { presenceRoute } from './routes/presence.ts'
import { peersRoute } from './routes/peers.ts'

export function buildApp(deps: Deps) {
  const app = new Hono()
  app.get('/health', c => c.json({ ok: true }))
  app.route('/v1/messages', messagesRoute(deps))
  app.route('/v1/stream', streamRoute(deps))
  app.route('/v1/presence', presenceRoute(deps))
  app.route('/v1/peers', peersRoute(deps))
  return app
}
