# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`claude-mesh` is a **networked messaging substrate for Claude Code instances**: a self-hosted HTTP relay + per-Claude MCP channel server that lets Claudes on different machines DM, broadcast, thread, and approve tool-permissions for each other. Built on Anthropic's research-preview `claude/channel` MCP extension.

The project is in active construction — only the foundation + shared package are implemented. The spec and plan are the source of truth:

- **Spec** (what we're building): `docs/superpowers/specs/2026-04-17-claude-mesh-design.md`
- **Plan** (how — 33 TDD tasks across 9 phases): `docs/superpowers/plans/2026-04-17-claude-mesh-implementation.md`

Resuming work: start at **Task 5** (relay scaffold). Tasks 1–4 are done; the plan has been patched for two gotchas found during Task 1–4 execution (see §Gotchas below).

## Commands

The repo is a **pnpm 10 workspace**. Node ≥22. Run from the repo root.

```bash
pnpm install                                   # install all workspace deps
pnpm -r build                                  # build every package
pnpm -r typecheck                              # tsc --noEmit across the workspace
pnpm -r test                                   # vitest watch across packages
pnpm -r test:ci                                # vitest run + coverage thresholds

# Scope to one package:
pnpm -F @claude-mesh/shared exec vitest run
pnpm -F @claude-mesh/shared exec vitest run channel          # single test file
pnpm -F @claude-mesh/shared exec vitest run -t "round-trip"  # single test name
pnpm -F @claude-mesh/shared exec tsc -p tsconfig.json --noEmit
```

Vitest coverage thresholds (enforced in `vitest.config.ts`): **95 % lines on `shared`, 85 % on relay/peer-agent.** These are wired as CI gates in the plan, not just documentation.

## Architecture (big picture)

### Three deployable units (per spec §1)

```
Claude Code ──stdio──▶ peer-agent (MCP channel server) ──HTTPS──▶ relay (Hono + SQLite)
```

1. **`@claude-mesh/shared`** (done) — zod envelope schema, `<channel>` notification serializer, ULID message IDs, shared constants. Pure types and validators; no IO. *Both other packages depend on this.*
2. **`@claude-mesh/relay`** (not started, Tasks 5–16, 22) — stateless-ish HTTP server. Hono + `better-sqlite3` + SSE. Routes: `POST /v1/messages` (with `Idempotency-Key`), `GET /v1/stream` (SSE with `?since=<ulid>` resume), `POST /v1/presence`, `GET /v1/peers`, `POST /v1/auth/{pair,revoke}`, `POST /v1/permission/respond`, `GET/DELETE /v1/admin/*`. In-memory fanout registry; SQLite for durable message buffering.
3. **`@claude-mesh/peer-agent`** (not started, Tasks 17–27, 33) — stdio MCP server declaring the `experimental['claude/channel']` capability. Pushes inbound peer messages into Claude's context as `<channel source="peers" ...>` tags via `notifications/claude/channel`. Exposes MCP tools `send_to_peer`, `list_peers`, `set_summary`, optionally `respond_to_permission`.

### Key invariants to preserve

- **`from` is server-populated from the token** on every message. Peer-agents cannot set it. This is the primary defense against impersonation.
- **ULIDs are monotonic** (see `src/ulid.ts` — uses `monotonicFactory()`). The SSE resume cursor is `WHERE id > ?`, which relies on strict ordering even for IDs generated within the same millisecond.
- **`<channel>` body escaping** in `channel.ts` prevents peer content from forging sibling tags. A property test (500 runs) asserts escaped bodies never contain the literal `</channel>`.
- **Envelope is *the* wire format.** One schema (`EnvelopeSchema`), four `kind`s (`chat`, `presence_update`, `permission_request`, `permission_verdict`). All HTTP bodies and SSE payloads go through it. The same zod schema is used by both relay and peer-agent — a shape change is a compile error in both at once.
- **`permission_verdict` requires `in_reply_to`** pointing at the original `permission_request` envelope; this is enforced by `superRefine` in `EnvelopeSchema`.

### Prompt-injection threat model

Peer messages end up in Claude's context. The `instructions` string on the peer-agent's MCP server explicitly downgrades peer `content` to "untrusted user input" and carries a four-point safety charter (see spec §6 and the exact text in `packages/peer-agent/src/instructions.ts` once Task 17 lands). **Do not weaken this wording** without reading spec §6 — it's load-bearing.

Sender gating (roster-check every inbound against `/v1/peers`), `claude/channel/permission` off by default, and `approval_routing = never_relay` by default are all layered defenses. See spec §6 layers L1–L5.

## TDD discipline (mandated by the plan)

Each of the 33 tasks is a TDD cycle: **write failing test → confirm RED → implement → confirm GREEN → commit**. One atomic commit per task, conventional-commits style (`feat(scope):`, `chore:`, etc.). Do not batch tasks into one commit.

If you discover a plan bug during execution (like the two in §Gotchas), fix the code, fix the plan file inline, and include both in the same commit with a `\n\n` explanation paragraph so the next executor inherits the fix.

## Windows-specific notes

Developed on Windows 11 + Git Bash. A few quirks worth knowing:

- **`warning: LF will be replaced by CRLF`** appears on every `git add` of a new file. Cosmetic — git's normalization layer, not an error.
- Use forward slashes in paths inside commands; many tools break on `\`.
- Node 25 and pnpm 10 are the *installed* versions here even though `package.json` declares `>=22` / `>=9` — run what's installed, don't downgrade.
- `better-sqlite3` (will be installed in Task 5) pulls a native binding and may require MSVC Build Tools on first install. If install fails, that's the likely reason.

## Gotchas (plan-integrity fixes already landed)

Two real bugs caught by the tests during Task 1–4 execution, both patched back into the plan so future executors don't re-hit them:

1. **`ulid()` is not monotonic.** The default `ulid` export from the `ulid` package doesn't guarantee strict ordering within a single millisecond — two IDs generated in the same tick can land out of order. Use `monotonicFactory()` (see `packages/shared/src/ulid.ts`). The SSE resume cursor depends on this invariant.
2. **TS 5.7+ requires explicit flags for `.ts`-suffixed imports.** The plan's convention of `import './foo.ts'` fails typecheck under default settings. `tsconfig.base.json` now sets `allowImportingTsExtensions: true` and `rewriteRelativeImportExtensions: true` so the build can still emit `.js`.

If subsequent tasks break the existing test suite, **fix the root cause** — don't weaken the failing test.

## What *not* to do

- **Don't commit tokens, `admin.token`, `*.paircode`, or `.claude-mesh/` directories.** `.gitignore` covers them; the peer-agent will additionally refuse to start if its token file lives in a git worktree with a remote (see plan Task 18).
- **Don't change the `<channel>` tag shape or the `instructions` string** without re-reading spec §4 and §6. Both are security-critical surfaces.
- **Don't skip the reviewer / typecheck / test gates** between tasks. They caught two real bugs in Phase 1; they will catch more.
- **Don't assume `claude/channel` behavior from training data.** It's a research-preview feature; the authoritative reference is <https://code.claude.com/docs/en/channels-reference>. Requires Claude Code v2.1.80+ (v2.1.81+ for permission relay) and `claude.ai` login.
