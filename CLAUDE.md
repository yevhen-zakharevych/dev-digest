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
- …editing API routes, DB schema, or adapters → `server/CLAUDE.md`
- …editing UI pages, hooks, or i18n → `client/CLAUDE.md`
- …changing prompts / grounding / structured output → `reviewer-core/CLAUDE.md`
- …writing browser flows or debugging e2e → `e2e/CLAUDE.md`
- …debugging a past landmine in this repo → `INSIGHTS.md`
- …looking for a course-lesson contract → `specs/`
- …test layout / what runs where → `TESTING.md`

## Quick commands

- Boot all (Postgres + API + web, seeded): `./scripts/dev.sh`
- Hermetic e2e on alternate ports:         `./scripts/e2e.sh`
- Stop API/web: Ctrl-C. Stop Postgres:     `docker compose down` (NO `-v`)

Per-module commands live in each module's `CLAUDE.md`.

## Session protocol

**Start of task.** Identify which module you'll touch (`client/`, `server/`,
`reviewer-core/`, `e2e/`). Read THAT module's `INSIGHTS.md` plus root
`INSIGHTS.md`. Before proposing changes, confirm you've read them and
summarize the top 3 most relevant points for the task at hand.

**During work.** When you notice a non-obvious finding (pattern that worked,
antipattern, dependency quirk, recurring error, open question) — invoke the
`engineering-insights` skill. Do not defer to the end of the session.

**End of task.** Invoke `engineering-insights` once more to record a
Session Notes entry. Append-only; never edit or overwrite existing entries.
