import { z } from 'zod'
import type { Envelope, OutboundMessage } from '@claude-mesh/shared'
import { MAX_META_VALUE_LENGTH } from '@claude-mesh/shared'
import type { ApprovalRouter } from './approval-routing.ts'
import { logJson } from './logger.ts'

/** Client→server notification Claude Code emits when its local approval dialog opens (spec §5 step 2). */
export const PERMISSION_REQUEST_NOTIFICATION_METHOD =
  'notifications/claude/channel/permission_request'

export const PermissionRequestParamsSchema = z.object({
  request_id: z.string().min(1),
  tool_name: z.string().default(''),
  description: z.string().default(''),
  input_preview: z.string().default(''),
}).passthrough()

export interface PermissionOutboundOpts {
  router: ApprovalRouter
  send: (msg: OutboundMessage) => Promise<Envelope>
  selfHandle: string
  ttlMs: number
  now?: () => Date
}

const clip = (s: string): string => s.slice(0, MAX_META_VALUE_LENGTH)

/**
 * Turn a Claude Code permission_request notification into outbound
 * kind=permission_request envelopes, per the approval_routing policy.
 * Never throws: the local approval dialog must keep working even if
 * params are malformed or the relay is down. Returns count relayed.
 */
export async function relayPermissionRequest(
  params: unknown,
  opts: PermissionOutboundOpts
): Promise<number> {
  const parsed = PermissionRequestParamsSchema.safeParse(params)
  if (!parsed.success) {
    logJson('warn', 'peer.permission.outbound_bad_params', { err: parsed.error.message })
    return 0
  }
  const p = parsed.data
  const targets = opts.router.pick({ excludeSelf: opts.selfHandle })
  if (!targets) return 0

  const nowMs = (opts.now?.() ?? new Date()).getTime()
  const expires_at = new Date(nowMs + opts.ttlMs).toISOString()
  const content = p.description || `${p.tool_name}: ${p.input_preview}`
  let relayed = 0
  for (const to of targets) {
    try {
      await opts.send({
        to,
        kind: 'permission_request',
        content,
        meta: {
          request_id: clip(p.request_id),
          tool_name: clip(p.tool_name),
          input_preview: clip(p.input_preview),
          requester: clip(opts.selfHandle),
          expires_at,
        },
      })
      relayed++
      logJson('info', 'peer.permission.outbound_relayed', { to, request_id: p.request_id })
    } catch (err) {
      logJson('warn', 'peer.permission.outbound_send_error', {
        to,
        request_id: p.request_id,
        err: String(err instanceof Error ? err.message : err),
      })
    }
  }
  return relayed
}
