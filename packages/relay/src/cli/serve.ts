import { serve } from '@hono/node-server'
import { buildApp } from '../app.ts'
import { openDatabase } from '../db/db.ts'
import { MessageStore } from '../messages/store.ts'
import { Fanout } from '../fanout.ts'
import { PresenceRegistry } from '../presence/registry.ts'
import { logJson } from '../logger.ts'

export interface ServeOpts {
  db_path: string
  port: number
  host: string
}

export function startServer(opts: ServeOpts) {
  const db = openDatabase(opts.db_path)
  const store = new MessageStore(db)
  const fanout = new Fanout()
  const presence = new PresenceRegistry()
  const app = buildApp({ db, store, fanout, presence, now: () => new Date() })
  const server = serve({ fetch: app.fetch, port: opts.port, hostname: opts.host })
  logJson('info', 'relay.started', { host: opts.host, port: opts.port, db_path: opts.db_path })
  return server
}
