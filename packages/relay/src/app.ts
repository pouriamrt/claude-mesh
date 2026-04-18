import { Hono } from 'hono'
import type { Deps } from './deps.ts'
import { messagesRoute } from './routes/messages.ts'

export function buildApp(deps: Deps) {
  const app = new Hono()
  app.get('/health', c => c.json({ ok: true }))
  app.route('/v1/messages', messagesRoute(deps))
  return app
}
