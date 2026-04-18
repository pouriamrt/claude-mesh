import type { Envelope } from '@claude-mesh/shared'
import { envelopeToChannelNotification } from '@claude-mesh/shared'
import { SenderGate } from './gate.ts'
import type { PermissionTracker } from './permission.ts'
import { logJson } from './logger.ts'

export interface InboundDispatcherOpts {
  gate: SenderGate
  emit: (notification: { method: string; params: Record<string, unknown> }) => void
  setCursor: (id: string) => void
  permissionTracker?: PermissionTracker | undefined
}

export class InboundDispatcher {
  constructor(private opts: InboundDispatcherOpts) {}

  handle(e: Envelope): void {
    if (!this.opts.gate.accept(e.from)) {
      logJson('warn', 'peer.inbound.sender_gate_drop', { from: e.from, msg_id: e.id })
      return
    }
    if (e.kind === 'permission_request' && this.opts.permissionTracker) {
      const rid = e.meta.request_id ?? ''
      if (rid) this.opts.permissionTracker.recordIncoming(rid, e.id, e.from)
    }
    this.opts.emit(envelopeToChannelNotification(e))
    this.opts.setCursor(e.id)
  }
}
