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
import { ReplyLimiter } from './reply-limiter.ts'
import { pathToFileURL } from 'node:url'
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
  const replyLimiter = new ReplyLimiter({ windowMs: 10_000, maxReplies: 2 })
  const { callTool } = registerTools(client, cfg.presence, permissionTracker, replyLimiter)

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

  logJson('info', 'peer.startup', { relay_url: cfg.relay_url })

  // Seed the roster. Failing here used to crash the peer-agent hard, breaking
  // every Claude Code session if the relay happened to be down. Now: start
  // with an empty roster, let the refresh loop recover once the relay is back.
  const gate = new SenderGate([])
  const refreshRoster = async () => {
    try {
      const peers = await client.listPeers()
      gate.setRoster(peers.map(p => p.handle))
      logJson('info', 'peer.roster.refreshed', { count: peers.length })
    } catch (err) {
      logJson('warn', 'peer.roster.refresh_error', describeError(err))
    }
  }
  void refreshRoster()
  setInterval(refreshRoster, 60_000)

  let cursor: string | undefined
  const dispatcher = new InboundDispatcher({
    gate,
    emit: n => { void server.notification(n as never) },
    setCursor: id => { cursor = id },
    permissionTracker,
    replyLimiter,
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

function describeError(err: unknown): Record<string, string> {
  if (!(err instanceof Error)) return { err: String(err) }
  const out: Record<string, string> = { err: err.message, name: err.name }
  const anyErr = err as { code?: unknown; cause?: unknown }
  if (typeof anyErr.code === 'string') out.code = anyErr.code
  if (anyErr.cause instanceof Error) {
    out.cause_message = anyErr.cause.message
    out.cause_name = anyErr.cause.name
    const anyCause = anyErr.cause as { code?: unknown; address?: unknown; port?: unknown }
    if (typeof anyCause.code === 'string') out.cause_code = anyCause.code
    if (typeof anyCause.address === 'string') out.cause_address = anyCause.address
    if (typeof anyCause.port === 'number') out.cause_port = String(anyCause.port)
  } else if (anyErr.cause !== undefined) {
    out.cause = String(anyErr.cause)
  }
  return out
}

const invokedAsScript = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]!).href
if (invokedAsScript) {
  main().catch(err => {
    logJson('error', 'peer.fatal', describeError(err))
    process.exit(1)
  })
}
