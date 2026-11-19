import {
  EnvelopeSchema,
  envelopeFromRow,
  newMessageId,
  PROTOCOL_VERSION,
  TEAM_BROADCAST_HANDLE,
  type Envelope,
  type EnvelopeRow,
  type OutboundMessage,
} from '@claude-mesh/shared'
import type { Db } from '../db/db.ts'

interface ParentRow {
  id: string
  thread_root: string | null
  kind: string
  from_handle: string
  to_handle: string
  meta_json: string
}

// The requester's peer-agent forwards any verdict it receives to Claude Code, so
// the relay is the only place to check that the sender was actually asked.
function assertVerdictAnswers(parent: ParentRow | undefined, from_handle: string, msg: OutboundMessage): void {
  if (parent?.kind !== 'permission_request') {
    throw new Error('permission_verdict needs in_reply_to pointing at a permission_request')
  }
  if (parent.to_handle !== from_handle && parent.to_handle !== TEAM_BROADCAST_HANDLE) {
    throw new Error('permission_verdict sender was not routed this permission_request')
  }
  if (msg.to !== parent.from_handle) throw new Error('permission_verdict must go to the requester')
  const req = JSON.parse(parent.meta_json) as Record<string, string>
  const rid = (req.request_id ?? '').toLowerCase()
  if (!rid || rid !== (msg.meta?.request_id ?? '').toLowerCase()) {
    throw new Error('permission_verdict request_id does not match the permission_request')
  }
  if (req.expires_at && Date.parse(req.expires_at) < Date.now()) {
    throw new Error('permission_request expired')
  }
}

export class MessageStore {
  constructor(private readonly db: Db) {}

  insert(team_id: string, from_handle: string, msg: OutboundMessage): Envelope {
    if (msg.to !== TEAM_BROADCAST_HANDLE) {
      const rcpt = this.db.prepare(
        "SELECT 1 AS x FROM human WHERE team_id=? AND handle=? AND disabled_at IS NULL"
      ).get(team_id, msg.to)
      if (!rcpt) throw new Error(`unknown recipient: ${msg.to}`)
    }

    let thread_root: string | null = null
    let parent: ParentRow | undefined
    if (msg.in_reply_to) {
      parent = this.db.prepare(
        "SELECT id, thread_root, kind, from_handle, to_handle, meta_json FROM message WHERE id=? AND team_id=?"
      ).get(msg.in_reply_to, team_id) as ParentRow | undefined
      if (!parent) throw new Error(`unknown in_reply_to: ${msg.in_reply_to}`)
      thread_root = parent.thread_root ?? parent.id
    }
    if (msg.kind === 'permission_verdict') assertVerdictAnswers(parent, from_handle, msg)

    const envelope: Envelope = EnvelopeSchema.parse({
      id: newMessageId(),
      v: PROTOCOL_VERSION,
      team: team_id,
      from: from_handle,
      to: msg.to,
      in_reply_to: msg.in_reply_to ?? null,
      thread_root,
      kind: msg.kind,
      content: msg.content,
      meta: msg.meta ?? {},
      sent_at: new Date().toISOString(),
      delivered_at: null,
    })

    this.db.prepare(`
      INSERT INTO message(id,v,team_id,from_handle,to_handle,in_reply_to,thread_root,kind,content,meta_json,sent_at,delivered_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      envelope.id, envelope.v, envelope.team, envelope.from, envelope.to,
      envelope.in_reply_to, envelope.thread_root, envelope.kind, envelope.content,
      JSON.stringify(envelope.meta), envelope.sent_at, envelope.delivered_at
    )
    return envelope
  }

  fetchSince(team_id: string, to_handle: string, since_id: string): Envelope[] {
    const rows = this.db.prepare(`
      SELECT id, v, team_id, from_handle, to_handle, in_reply_to, thread_root,
             kind, content, meta_json, sent_at, delivered_at
      FROM message
      WHERE team_id=? AND id > ?
        AND (to_handle=? OR (to_handle='@team' AND from_handle != ?))
      ORDER BY id ASC LIMIT 1000
    `).all(team_id, since_id, to_handle, to_handle) as EnvelopeRow[]
    return rows.map(envelopeFromRow)
  }

  fetchPendingFor(team_id: string, to_handle: string): Envelope[] {
    const rows = this.db.prepare(`
      SELECT id, v, team_id, from_handle, to_handle, in_reply_to, thread_root,
             kind, content, meta_json, sent_at, delivered_at
      FROM message
      WHERE team_id=? AND delivered_at IS NULL
        AND (to_handle=? OR (to_handle='@team' AND from_handle != ?))
      ORDER BY id ASC LIMIT 1000
    `).all(team_id, to_handle, to_handle) as EnvelopeRow[]
    return rows.map(envelopeFromRow)
  }

  markDelivered(id: string): void {
    this.db.prepare(
      "UPDATE message SET delivered_at=COALESCE(delivered_at,?) WHERE id=?"
    ).run(new Date().toISOString(), id)
  }
}
