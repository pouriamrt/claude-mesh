import type { Db } from './db/db.ts'
import type { MessageStore } from './messages/store.ts'
import type { Fanout } from './fanout.ts'

export interface Deps {
  db: Db
  store: MessageStore
  fanout: Fanout
  now: () => Date
}
