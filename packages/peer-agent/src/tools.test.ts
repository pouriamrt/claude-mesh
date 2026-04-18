import { describe, it, expect, vi } from 'vitest'
import { registerTools } from './tools.ts'
import type { RelayClient } from './outbound.ts'

describe('registerTools', () => {
  it('send_to_peer calls RelayClient.send', async () => {
    const send = vi.fn(async () => ({
      id: 'msg_01HRK7Y000000000000000000A', v: 1, team: 't1', from: 'a', to: 'bob',
      in_reply_to: null, thread_root: null, kind: 'chat', content: 'hi', meta: {},
      sent_at: '2026-01-01T00:00:00.000Z', delivered_at: null,
    }))
    const client = { send, listPeers: vi.fn(async () => []), setPresence: vi.fn() } as unknown as RelayClient
    const { callTool } = registerTools(client, { auto_publish_cwd: false, auto_publish_branch: false, auto_publish_repo: false })
    const result = await callTool('send_to_peer', { to: 'bob', content: 'hi' })
    expect(send).toHaveBeenCalledWith({ to: 'bob', kind: 'chat', content: 'hi', meta: {} })
    expect((result.content[0] as any).text).toContain('msg_')
  })

  it('list_peers returns snapshot', async () => {
    const client = { send: vi.fn(), listPeers: vi.fn(async () => [{ handle: 'alice', online: true }]),
                     setPresence: vi.fn() } as unknown as RelayClient
    const { callTool } = registerTools(client, { auto_publish_cwd: false, auto_publish_branch: false, auto_publish_repo: false })
    const result = await callTool('list_peers', {})
    expect((result.content[0] as any).text).toContain('alice')
  })

  it('set_summary posts presence', async () => {
    const setPresence = vi.fn(async () => { /* no-op */ })
    const client = { send: vi.fn(), listPeers: vi.fn(async () => []),
                     setPresence } as unknown as RelayClient
    const { callTool } = registerTools(client, { auto_publish_cwd: false, auto_publish_branch: false, auto_publish_repo: false })
    await callTool('set_summary', { summary: 'hacking' })
    expect(setPresence).toHaveBeenCalledWith({ summary: 'hacking' })
  })
})
