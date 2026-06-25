# server — map (`@devdigest/api`, :3001)

Fastify API: imports repos & PRs, indexes via `repo-intel`, runs reviews
through `reviewer-core`, persists findings. See `README.md` for the full
request-flow diagram and API map.

## Stack notes (non-default)

- Fastify 5 + `fastify-type-provider-zod` — Zod schema drives both
  request validation AND response serialization (no hand-rolled `parse`)
- `fastify-sse-v2` for streaming run traces
- Drizzle ORM + `postgres` (NOT `pg`) + pgvector
- DI container in `platform/container.ts` — every external dep behind a port
- `tsx` in dev; consumes `@devdigest/reviewer-core` as TS source via path alias

## Module map

- `src/modules/<name>/` — feature plugins. Each has `routes.ts` + `service.ts`.
  Starter set: `repos · pulls · polling · reviews · agents · repo-intel ·
  settings · workspace`. Registered statically in `modules/index.ts`.
- `src/adapters/`       — ports for external deps (llm, github, git, astgrep,
  embedder, tokenizer, secrets, codeindex, depgraph, auth). Mocks in `mocks.ts`.
- `src/platform/`       — DI container, config, errors, SSE, grounding,
  resilience, run-logger, structured output, trace-builder
- `src/db/`             — Drizzle schema (`schema/*.ts`), migrations, seed
- `src/vendor/shared/`  — Zod contracts (the source of `@devdigest/shared`)
- `src/prompts/`        — system-prompt markdown for built-in agents

## Conventions (non-default for this module)

- Route file MUST live at `modules/<name>/routes.ts` with sibling `service.ts`.
- Zod schemas belong in `@devdigest/shared` (vendored at `src/vendor/shared`),
  NOT inline. Routes reference them; `fastify-type-provider-zod` handles parse.
- Any adapter MUST go through DI; never `new OpenAI()` in a service.
- DB-backed test ⇒ filename MUST end `.it.test.ts` (CI split depends on it).
- Plugins (helmet, cors, rate-limit, SSE, error handler) register BEFORE
  module plugins so encapsulated modules inherit them.
- Rate-limit: 120/min global; tighter per-route on expensive endpoints
  (e.g. `POST /pulls/:id/review`). SSE + `/health*` exempt. Disabled in
  `NODE_ENV=test`.

## Gotchas

- Migrations are NOT applied on boot. First-run `relation ... does not
  exist` ⇒ run `pnpm db:migrate`. `pgvector` is enabled by migration `0000`.
- `loadConfig` marks every secret optional → server boots without keys.
  Don't add required-key checks at startup; settings UI fills them at runtime.
- `LocalSecretsProvider` is the only read chokepoint for secrets. Adding a
  new secret? Wire it through there, not `process.env` directly.
- Orphaned `running` runs are reaped on boot — don't be surprised when a
  long-dead run flips to `failed` after a restart.
- `REPO_INTEL_ENABLED=true` by default; turning it off degrades to
  ripgrep-only context. Per-agent `repo_intel` toggle gates enrichment too.

## Read when…

- …adding a route                → `README.md` § "API map" + § "Request & DI flow"
- …new DB table or column        → `db/schema/` + `docs/db-migrations.md`
- …new LLM provider              → `adapters/llm/` + `docs/adapters.md`
- …Repo-Intel logic              → `modules/repo-intel/README.md`
- …test fails only on CI         → `../TESTING.md` + `INSIGHTS.md`
- …past incident in this module  → `INSIGHTS.md`
- …cross-module contract change  → `../specs/` then `specs/`

## Module commands

- dev:        `pnpm dev`              (API on :3001)
- typecheck:  `pnpm typecheck`
- test (all): `pnpm test`
- test unit:  `pnpm exec vitest run --exclude '**/*.it.test.ts'`
- test it:    `pnpm exec vitest run .it.test`
- migrate:    `pnpm db:migrate`       (NOT run on boot)
- seed:       `pnpm db:seed`          (idempotent)
- generate:   `pnpm db:generate`      (after schema edits)

## Sibling links

- Up:        `../CLAUDE.md`
- Consumes:  `../reviewer-core/CLAUDE.md` (TS path alias)
- Consumed by: `../client/CLAUDE.md` (over REST + SSE)
