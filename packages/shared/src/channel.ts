import { META_KEY_REGEX } from './constants.ts'
import type { Envelope } from './envelope.ts'

export interface ChannelNotification {
  method: string
  params: {
    content: string
    meta: Record<string, string>
    request_id?: string
    behavior?: 'allow' | 'deny'
  }
}

export function envelopeToChannelNotification(e: Envelope): ChannelNotification {
  const safeMeta = sanitizeMeta(e.meta)

  if (e.kind === 'permission_verdict') {
    return {
      method: 'notifications/claude/channel/permission',
      params: {
        content: '',
        meta: safeMeta,
        request_id: safeMeta.request_id ?? '',
        behavior: safeMeta.behavior === 'deny' ? 'deny' : 'allow'
      }
    }
  }

  // Peer permission requests ride the plain channel event too: Claude Code only
  // sends notifications/claude/channel/permission_request, it never handles one.
  return {
    method: 'notifications/claude/channel',
    params: {
      content: escapeChannelBody(e.content),
      meta: {
        from: e.from,
        msg_id: e.id,
        ...(e.kind === 'permission_request' ? { kind: e.kind } : {}),
        ...(e.in_reply_to ? { in_reply_to: e.in_reply_to } : {}),
        ...(e.thread_root ? { thread_root: e.thread_root } : {}),
        ...withoutReserved(safeMeta)
      }
    }
  }
}

// Attributes set from the authenticated envelope, plus `source` (Claude Code sets
// it) and `requester` (a sender-claimed copy of `from`): sender meta never shadows them.
const RESERVED_META_KEYS: ReadonlySet<string> = new Set([
  'from', 'msg_id', 'in_reply_to', 'thread_root', 'source', 'kind', 'requester'
])

function withoutReserved(meta: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(meta).filter(([k]) => !RESERVED_META_KEYS.has(k)))
}

function sanitizeMeta(meta: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(meta)) {
    if (META_KEY_REGEX.test(k)) out[k] = escapeChannelAttr(v)
  }
  return out
}

export function escapeChannelAttr(s: string): string {
  return s.replace(/[<>&"]/g, c =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '&' ? '&amp;' : '&quot;')
}

export function escapeChannelBody(s: string): string {
  return s.replace(/[<>&]/g, c =>
    c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;')
}
