import type { Envelope } from '@claude-mesh/shared'
import { envelopeToChannelNotification } from '@claude-mesh/shared'
import { SenderGate } from './gate.ts'
import type { PermissionTracker } from './permission.ts'
import type { ReplyLimiter } from './reply-limiter.ts'
import { logJson } from './logger.ts'

export interface InboundDispatcherOpts {
  gate: SenderGate
  emit: (notification: { method: string; params: Record<string, unknown> }) => void
  setCursor: (id: string) => void
  permissionTracker?: PermissionTracker | undefined
  replyLimiter?: ReplyLimiter | undefined
  /** Called for gated inbound chats so approval routing sees both directions of a thread (spec §5). */
  recordDm?: ((handle: string) => void) | undefined
}

export class InboundDispatcher {
  constructor(private opts: InboundDispatcherOpts) {}

  handle(e: Envelope): void {
    logJson('info', 'peer.inbound.received', { from: e.from, kind: e.kind, msg_id: e.id })
    if (!this.opts.gate.accept(e.from)) {
      logJson('warn', 'peer.inbound.sender_gate_drop', { from: e.from, msg_id: e.id })
      return
    }
    if (e.kind === 'chat') this.opts.recordDm?.(e.from)
    if (e.kind === 'permission_request') {
      // Only show requests respond_to_permission can answer: relay on (the tool exists) and an ID to answer.
      const rid = e.meta.request_id ?? ''
      if (!this.opts.permissionTracker || !rid) {
        logJson('info', 'peer.permission.inbound_dropped', {
          from: e.from, msg_id: e.id, reason: this.opts.permissionTracker ? 'no_request_id' : 'relay_off',
        })
        this.opts.setCursor(e.id)
        return
      }
      this.opts.permissionTracker.recordIncoming(rid, e.id, e.from)
    }
    this.opts.replyLimiter?.recordInbound(e.from)
    const notification = envelopeToChannelNotification(e)
    try {
      this.opts.emit(notification)
      logJson('info', 'peer.inbound.emitted', { method: notification.method, msg_id: e.id })
    } catch (err) {
      logJson('error', 'peer.inbound.emit_error', {
        method: notification.method,
        msg_id: e.id,
        err: String(err instanceof Error ? err.message : err),
      })
    }
    this.opts.setCursor(e.id)
  }
}
