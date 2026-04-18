# claude-mesh Security

## Threat model

| # | Threat | v1 mitigation |
|---|---|---|
| 1 | Impersonation | Relay sets `from` from the authenticated token. |
| 2 | Outsider injection | Bearer auth + team-scoped tokens on every route. |
| 3 | Relay compromise | **Out of scope v1.** Relay is a trust anchor; v2 adds client-side Ed25519 signatures. |
| 4 | Compromised-peer injection | Containment + default-off permission relay + action-tier gates. |
| 5 | Content injection through a legitimate peer's Claude | `<channel>`-tag structural containment + explicit `instructions` string downgrading peer content to "untrusted user input". |

## Layered defenses

1. **Relay-enforced identity.** `from` is authoritative and peer-agents cannot spoof it.
2. **Peer-agent sender gate.** Unknown handles → message dropped silently + metric bumped.
3. **`<channel>` containment.** `<` / `>` / `&` escaped in bodies; no sibling tag injection possible.
4. **Action-tier gating.** Permission relay off by default; `approval_routing=never_relay` by default; reply-storm rate limit.
5. **Audit + observability.** Every message + permission event persisted with retention; JSON access logs; optional `/metrics`.

## Defaults you should know

- Permission relay is **OFF by default**; enable per-peer in `~/.claude-mesh/config.json`.
- Token files are mode `0600` and the peer-agent refuses to start if the token lives in a git worktree with a remote.
- Tokens are never logged, never passed as env vars to child processes, and never exposed to the LLM.

## Reporting a vulnerability

Email <security@example.com> with PGP. We triage within 72 hours; critical
advisories are published to [GitHub Security Advisories](https://github.com/you/claude-mesh/security).

## Known limitations

- Research-preview dependency on `claude/channel`. Wire format may change across Claude Code versions; L3 tests are the early-warning system.
- Admin token is a single-secret failure mode. Rotate; consider mTLS for admin calls in future.
- No multi-region HA in v1.
