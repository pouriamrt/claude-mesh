import type { Envelope } from '@claude-mesh/shared'
import { envelopeToChannelNotification } from '@claude-mesh/shared'
import { SenderGate } from './gate.ts'
import { logJson } from './logger.ts'

export interface InboundDispatcherOpts {
  gate: SenderGate
  emit: (notification: { method: string; params: Record<string, unknown> }) => void
  setCursor: (id: string) => void
}

export class InboundDispatcher {
  constructor(private opts: InboundDispatcherOpts) {}

  handle(e: Envelope): void {
    if (!this.opts.gate.accept(e.from)) {
      logJson('warn', 'peer.inbound.sender_gate_drop', { from: e.from, msg_id: e.id })
      return
    }
    const n = envelopeToChannelNotification(e)
    this.opts.emit(n)
    this.opts.setCursor(e.id)
  }
}
