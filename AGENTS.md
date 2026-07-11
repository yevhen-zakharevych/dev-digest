# DevDigest — root map

Local-first AI PR reviewer. Starter for the ai-agentic-engineering course;
each lesson L01–L08 adds one feature back. See `README.md` for full architecture.

## Stack (versions)

- Node ≥ 22, pnpm ≥ 10, Docker (Postgres only)
- Fastify 5, Drizzle ORM, Postgres 16 + pgvector
- Next.js 15 (App Router), React 19, TanStack Query
- TypeScript everywhere, Zod-first contracts (`fastify-type-provider-zod`)

## Top-level map

- `server/`         — Fastify API + DB (`@devdigest/api`, :3001)
- `client/`         — Next.js studio  (`@devdigest/web`, :3000)
- `reviewer-core/`  — pure review engine, no I/O (`LLMProvider` injected)
- `e2e/`            — deterministic browser flows (agent-browser, no LLM)
- `server/src/vendor/shared` — Zod contracts shared by every package
- `scripts/`        — `dev.sh`, `e2e.sh`
- `docker-compose.yml` — Postgres only; API/web run on host
- `docs/`           — repo-wide design docs (`agent-prompts/` lives here)
- `specs/`          — formal cross-module contracts / lesson specs

## Repo-wide conventions (non-default)

- NOT a workspace. Each package owns its `package.json` + lockfile.
  Code shared via tsconfig path aliases, not npm publish.
- `reviewer-core` is consumed as TS source; its `build` is `tsc --noEmit`.
- One Zod schema = request validation + response serialization + FE type.
- Server DB migrations are NOT applied on boot — run `pnpm db:migrate`.
- pnpm only; no npm/yarn (lockfiles enforce this per package).

## Gotchas (will-bite)

- NEVER `docker compose down -v` — wipes `devdigest_pgdata` (all imported
  repos + reviews). Use `down` without `-v` to stop, `-v` only on a fresh box.
- Tests split by filename: `*.it.test.ts` = integration (testcontainers
  Postgres); everything else = hermetic unit. Renaming breaks CI split.
- Grounding gate is mandatory; never bypass `groundFindings()` —
  the model's self-reported score is also discarded by design.
- Prompt-injection defense is the single `INJECTION_GUARD` rule, NOT
  keyword scanning. Don't add denylists.
- DB schema contains tables for every lesson (skills, eval, ci, memory…).
  Empty tables are intentional — a lesson fills them.

## Read when…

- …onboarding a new contributor → `README.md` + `docs/` (when populated)
- …editing API routes, DB schema, or adapters → `server/AGENTS.md`
- …editing UI pages, hooks, or i18n → `client/AGENTS.md`
- …changing prompts / grounding / structured output → `reviewer-core/AGENTS.md`
- …writing browser flows or debugging e2e → `e2e/AGENTS.md`
- …debugging a past landmine in this repo → `INSIGHTS.md`
- …looking for a course-lesson contract → `specs/`
- …test layout / what runs where → `TESTING.md`

## Quick commands

- Boot all (Postgres + API + web, seeded): `./scripts/dev.sh`
- Hermetic e2e on alternate ports:         `./scripts/e2e.sh`
- Stop API/web: Ctrl-C. Stop Postgres:     `docker compose down` (NO `-v`)

Per-module commands live in each module's `AGENTS.md`.

## DevDigest MCP server (run reviews via MCP)

DevDigest ships a standalone MCP server (`mcp-server/`, wired in the repo-root
`.mcp.json`) that exposes the review engine over stdio. When a request is about
**running or reading a review / conventions / blast-radius for a PR**, CALL THE
`devdigest` MCP TOOLS DIRECTLY. Do NOT shell out — never `curl` the API, never
`gh`, never invent an `mcp-client` command, never POST to `localhost:3001` by
hand. The five tools ARE your interface:
`list_agents`, `run_agent_on_pr`, `get_findings`, `get_conventions`, `get_blast_radius`.

Run an agent on a PR (the common flow):
1. `run_agent_on_pr` with `{ repo: "owner/name", pr: <number>, agent: "<name or id>" }`.
   `agent` accepts an agent **name** ("Security Reviewer") OR an id — you do NOT
   need `list_agents` first.
2. If it returns `{ status: "running" }`, call `get_findings` with the returned
   `run_id` — pass `run_id` ALONE (it's `run_id` XOR `repo`+`pr`, never both).

Prereq: the API must be up (`./scripts/dev.sh`). If a tool returns
"cannot reach the DevDigest API", start it — do not fall back to `curl`. If the
`devdigest` tools aren't available at all, the session hasn't loaded `.mcp.json`
(reconnect via `/mcp` or restart) — that is a connection step, not a reason to shell out.

## Session protocol

**Start of task.** Identify which module you'll touch (`client/`, `server/`,
`reviewer-core/`, `e2e/`). Read THAT module's `INSIGHTS.md` plus root
`INSIGHTS.md`. Before proposing changes, confirm you've read them and
summarize the top 3 most relevant points for the task at hand.

This wholesale read is the **main thread's** job, done **once per session** — the
orchestrator holds the landmine context for the whole run. A **scoped** subagent —
one that owns a handful of files (an `implementer`) — must NOT re-read the
`INSIGHTS.md` files in full: the orchestrator extracts the 3-5 landmines relevant to
that subagent's files and quotes them (with `file:line`) in the spawn prompt, and
the subagent uses a targeted `grep -n <term>` (reading only the matching entry) for
anything its card missed. One root `INSIGHTS.md` re-read by every agent in a fan-out
is the largest avoidable token cost of a fleet (measured: ~14 re-reads of one 26k-
token file in the L05 run). A **whole-diff** agent (`plan-verifier`,
`architecture-reviewer`, `implementation-planner`) reasons across everything and may
still read broadly — but there are only one of each, so they are not the cost
driver; hand them the load-bearing landmines too, but don't starve them of breadth.

**During work.** When you notice a non-obvious finding (pattern that worked,
antipattern, dependency quirk, recurring error, open question) — invoke the
`engineering-insights` skill. Do not defer to the end of the session.

**End of task.** Invoke `engineering-insights` once more to record a
Session Notes entry. Append-only; never edit or overwrite existing entries.
