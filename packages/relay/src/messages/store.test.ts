import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase, type Db } from '../db/db.ts'
import { MessageStore } from './store.ts'
import type { OutboundMessage } from '@claude-mesh/shared'

function seed(db: Db) {
  const now = new Date().toISOString()
  db.prepare("INSERT INTO team(id,name,retention_days,created_at) VALUES (?,?,?,?)")
    .run('t1', 'acme', 7, now)
  for (const h of ['alice', 'bob', 'charlie']) {
    db.prepare("INSERT INTO human(id,team_id,handle,display_name,created_at) VALUES (?,?,?,?,?)")
      .run(`h_${h}`, 't1', h, h, now)
  }
}

describe('MessageStore', () => {
  let db: Db
  let store: MessageStore
  beforeEach(() => { db = openDatabase(':memory:'); seed(db); store = new MessageStore(db) })

  it('assigns id/from/sent_at and returns the full envelope', () => {
    const inbound: OutboundMessage = { to: 'bob', kind: 'chat', content: 'hi' }
    const e = store.insert('t1', 'alice', inbound)
    expect(e.id).toMatch(/^msg_/)
    expect(e.from).toBe('alice')
    expect(e.to).toBe('bob')
    expect(e.sent_at).toBeTruthy()
    expect(e.delivered_at).toBeNull()
    expect(e.thread_root).toBeNull()
  })

  it('denormalizes thread_root from in_reply_to chain', () => {
    const root = store.insert('t1', 'alice', { to: 'bob', kind: 'chat', content: 'root' })
    const r1 = store.insert('t1', 'bob', {
      to: 'alice', kind: 'chat', content: 'r1', in_reply_to: root.id
    })
    const r2 = store.insert('t1', 'alice', {
      to: 'bob', kind: 'chat', content: 'r2', in_reply_to: r1.id
    })
    expect(r1.thread_root).toBe(root.id)
    expect(r2.thread_root).toBe(root.id)
  })

  it('rejects unknown recipient handle', () => {
    expect(() => store.insert('t1', 'alice', {
      to: 'mallory', kind: 'chat', content: 'x'
    })).toThrow(/unknown recipient/)
  })

  it('allows broadcast with no other team members (stored as no-op fanout)', () => {
    // Broadcast with no other peers is NOT an error — it's just a no-op fanout.
    const e = store.insert('t1', 'alice', { to: '@team', kind: 'chat', content: 'anyone?' })
    expect(e.to).toBe('@team')
  })

  it('rejects permission_verdict without in_reply_to', () => {
    expect(() => store.insert('t1', 'alice', {
      to: 'bob', kind: 'permission_verdict', content: '',
      meta: { request_id: 'abcde', behavior: 'allow' }
    } as OutboundMessage)).toThrow(/in_reply_to/)
  })

  describe('permission_verdict must answer a live request routed to its sender', () => {
    const request = (to: string, meta: Record<string, string> = {}) =>
      store.insert('t1', 'alice', {
        to, kind: 'permission_request', content: 'rm -rf dist/',
        meta: { request_id: 'abcde', expires_at: new Date(Date.now() + 60_000).toISOString(), ...meta },
      })
    const verdict = (from: string, in_reply_to: string, meta: Record<string, string> = {}, to = 'alice') =>
      store.insert('t1', from, {
        to, kind: 'permission_verdict', content: '', in_reply_to: in_reply_to as OutboundMessage['in_reply_to'],
        meta: { request_id: 'abcde', behavior: 'allow', ...meta },
      })

    it('accepts a verdict from the approver the request was routed to', () => {
      expect(verdict('bob', request('bob').id).kind).toBe('permission_verdict')
    })

    it('accepts a verdict from any member when the request went to @team', () => {
      expect(verdict('charlie', request('@team').id).kind).toBe('permission_verdict')
    })

    it('rejects a verdict from a member the request was not routed to', () => {
      const req = request('bob')
      expect(() => verdict('charlie', req.id)).toThrow(/not routed/)
    })

    it('rejects a verdict that replies to something other than a permission_request', () => {
      const chat = store.insert('t1', 'alice', { to: 'bob', kind: 'chat', content: 'hi' })
      expect(() => verdict('bob', chat.id)).toThrow(/permission_request/)
    })

    it('rejects a verdict whose request_id does not match the request', () => {
      const req = request('bob')
      expect(() => verdict('bob', req.id, { request_id: 'zzzzz' })).toThrow(/request_id/)
    })

    it('rejects a verdict addressed to anyone but the requester', () => {
      const req = request('bob')
      expect(() => verdict('bob', req.id, {}, 'charlie')).toThrow(/requester/)
    })

    it('rejects a verdict for an expired request', () => {
      const req = request('bob', { expires_at: new Date(Date.now() - 1000).toISOString() })
      expect(() => verdict('bob', req.id)).toThrow(/expired/)
    })
  })

  it('fetchSince returns messages after the given ULID ordered ascending', () => {
    const a = store.insert('t1', 'alice', { to: 'bob', kind: 'chat', content: '1' })
    const b = store.insert('t1', 'alice', { to: 'bob', kind: 'chat', content: '2' })
    const c = store.insert('t1', 'alice', { to: 'bob', kind: 'chat', content: '3' })
    const list = store.fetchSince('t1', 'bob', a.id)
    expect(list.map(e => e.id)).toEqual([b.id, c.id])
  })

  it('fetchPendingFor returns undelivered messages for a handle', () => {
    const a = store.insert('t1', 'alice', { to: 'bob', kind: 'chat', content: '1' })
    store.markDelivered(a.id)
    store.insert('t1', 'alice', { to: 'bob', kind: 'chat', content: '2' })
    const pending = store.fetchPendingFor('t1', 'bob')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.content).toBe('2')
  })

  it('markDelivered is idempotent', () => {
    const a = store.insert('t1', 'alice', { to: 'bob', kind: 'chat', content: '1' })
    store.markDelivered(a.id)
    expect(() => store.markDelivered(a.id)).not.toThrow()
  })
})
