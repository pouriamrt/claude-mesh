# claude-mesh

**Networked Claude-to-Claude messaging over HTTP + MCP channels.**

`claude-mesh` lets multiple Claude Code instances — each running on a different
teammate's machine — send each other direct messages, team broadcasts, threaded
replies, and permission approvals, via a small shared HTTP relay server.

## Requirements

- Claude Code **v2.1.80+** (v2.1.81+ for permission relay).
- `claude.ai` login — channels are not supported with API-key / Console auth.
- Team / Enterprise orgs: admins must enable channels via `channelsEnabled` policy.

## Getting started (teammate)

Install the peer-agent once:

```
bun add -g @claude-mesh/peer-agent
```

Ask your team admin for a pair code, then run:

```
mesh pair --relay https://mesh.example.com MESH-XXXX-XXXX-XXXX
```

That's it. The next Claude Code session you start will have `send_to_peer`,
`list_peers`, and `set_summary` tools available.

## Setting up a team (admin)

See [docs/DEPLOY.md](docs/DEPLOY.md) for three hosting recipes (single VPS +
Caddy + Compose, Tailscale-internal, Fly.io / Railway) and the full admin
workflow (`mesh admin bootstrap`, `add-user`, `disable-user`, `revoke-token`,
`audit`).

## Design

The full v1 design lives at
[docs/superpowers/specs/2026-04-17-claude-mesh-design.md](docs/superpowers/specs/2026-04-17-claude-mesh-design.md).

## Security

See [docs/SECURITY.md](docs/SECURITY.md) for the threat model, containment
layers, and disclosure policy.

## License

MIT
