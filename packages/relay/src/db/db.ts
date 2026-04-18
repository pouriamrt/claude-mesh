import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export type Db = Database.Database

const __dirname = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(__dirname, 'schema.sql')

export function openDatabase(path: string): Db {
  const db = new Database(path)
  const schema = readFileSync(SCHEMA_PATH, 'utf8')
  db.exec(schema)
  return db
}

export function getSchemaVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as { v: number | null }
  return row.v ?? 0
}

export function closeDatabase(db: Db): void {
  db.close()
}
