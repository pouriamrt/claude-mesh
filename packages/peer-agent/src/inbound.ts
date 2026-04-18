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
}

export class InboundDispatcher {
  constructor(private opts: InboundDispatcherOpts) {}

  handle(e: Envelope): void {
    logJson('info', 'peer.inbound.received', { from: e.from, kind: e.kind, msg_id: e.id })
    if (!this.opts.gate.accept(e.from)) {
      logJson('warn', 'peer.inbound.sender_gate_drop', { from: e.from, msg_id: e.id })
      return
    }
    if (e.kind === 'permission_request' && this.opts.permissionTracker) {
      const rid = e.meta.request_id ?? ''
      if (rid) this.opts.permissionTracker.recordIncoming(rid, e.id, e.from)
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
