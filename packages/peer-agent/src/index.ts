#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { PERMISSION_REQUEST_TTL_MS } from '@claude-mesh/shared'
import { createMcpServer } from './mcp-server.ts'
import { loadConfig, loadToken, assertTokenNotInRepo } from './config.ts'
import { RelayClient } from './outbound.ts'
import { registerTools, TOOL_DESCRIPTORS, TOOL_DESCRIPTOR_RESPOND } from './tools.ts'
import { SenderGate } from './gate.ts'
import { InboundDispatcher } from './inbound.ts'
import { StreamClient } from './stream.ts'
import { PermissionTracker } from './permission.ts'
import { ApprovalRouter, type RoutingPolicy } from './approval-routing.ts'
import { logJson } from './logger.ts'

async function main(): Promise<void> {
  const cfg = loadConfig()
  assertTokenNotInRepo(cfg.token_path)
  const token = loadToken(cfg.token_path)

  const permissionRelayEnabled = cfg.permission_relay.enabled
  const { server } = createMcpServer({ permissionRelay: permissionRelayEnabled })
  const client = new RelayClient({ relayUrl: cfg.relay_url, token })
  const permissionTracker = permissionRelayEnabled
    ? new PermissionTracker({ ttlMs: PERMISSION_REQUEST_TTL_MS })
    : undefined
  const approvalRouter = new ApprovalRouter({ routing: cfg.permission_relay.routing as RoutingPolicy })
  const originalSend = client.send.bind(client)
  client.send = async msg => {
    if (msg.kind === 'chat' && typeof msg.to === 'string' && msg.to !== '@team') {
      approvalRouter.recordDm(msg.to)
    }
    return originalSend(msg)
  }
  const { callTool } = registerTools(client, cfg.presence, permissionTracker)

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...TOOL_DESCRIPTORS,
      ...(permissionRelayEnabled ? [TOOL_DESCRIPTOR_RESPOND] : []),
    ],
  }))
  server.setRequestHandler(CallToolRequestSchema, async req => {
    try { return await callTool(req.params.name, req.params.arguments ?? {}) }
    catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      return { content: [{ type: 'text', text: `error: ${message}` }], isError: true }
    }
  })

  const initialPeers = await client.listPeers()
  const gate = new SenderGate(initialPeers.map(p => p.handle))
  setInterval(async () => {
    try { gate.setRoster((await client.listPeers()).map(p => p.handle)) }
    catch (err) {
      logJson('warn', 'peer.roster.refresh_error', {
        err: String(err instanceof Error ? err.message : err),
      })
    }
  }, 60_000)

  let cursor: string | undefined
  const dispatcher = new InboundDispatcher({
    gate,
    emit: n => { void server.notification(n as never) },
    setCursor: id => { cursor = id },
    permissionTracker,
  })

  const stream = new StreamClient({
    relayUrl: cfg.relay_url,
    token,
    sinceCursor: () => cursor,
    onEnvelope: e => dispatcher.handle(e),
    onAuthError: () => { logJson('error', 'peer.auth_failed'); process.exit(2) },
  })
  await server.connect(new StdioServerTransport())
  stream.start().catch(err => {
    logJson('error', 'peer.stream.fatal', {
      err: String(err instanceof Error ? err.message : err),
    })
    process.exit(1)
  })
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    logJson('error', 'peer.fatal', { err: String(err instanceof Error ? err.message : err) })
    process.exit(1)
  })
}
