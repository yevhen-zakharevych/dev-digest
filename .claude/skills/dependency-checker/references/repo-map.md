# Repo map — the six packages and their landmines

Read this before running a single command. Every entry here is a fact about *this* tree, verified
on disk; several of them will produce a confidently wrong report if assumed instead of checked.

## The six packages

| Package | npm name | Package manager | Lockfile | Role |
|---------|----------|-----------------|----------|------|
| `server/` | `@devdigest/api` | **pnpm** | `pnpm-lock.yaml` | Fastify API + Drizzle/Postgres, port 3001 |
| `client/` | `@devdigest/web` | **pnpm** | `pnpm-lock.yaml` | Next.js 15 studio, port 3000 |
| `reviewer-core/` | `@devdigest/reviewer-core` | **npm** | `package-lock.json` | Pure review engine, no I/O |
| `e2e/` | `@devdigest/e2e` | **npm** | `package-lock.json` | Browser flows (agent-browser) |
| `mcp-server/` | `@devdigest/mcp-server` | **pnpm** | `pnpm-lock.yaml` | Standalone MCP stdio server, thin HTTP client to the API |
| `evals/` | `@devdigest/evals` | **pnpm** | `pnpm-lock.yaml` | Skill/agent/workflow evals (Claude Agent SDK) |

The root `CLAUDE.md` says "pnpm only; no npm/yarn." That is true of the *app* packages but **not
repo-wide** — `reviewer-core` and `e2e` genuinely carry a `package-lock.json`, which is why their
test command is `npm test` while everyone else's is `pnpm test`. Any tooling that shells out to a
package manager must branch on the lockfile actually present, never on the repo-wide claim.

## The internal graph (path aliases, not npm)

These edges are the *real* architecture of the repo, and no npm tool will ever show them to you.
They live in `compilerOptions.paths` in each package's `tsconfig.json`:

| Consumer | Alias | Resolves to | Consumed as |
|----------|-------|-------------|-------------|
| `server` | `@devdigest/shared` | `server/src/vendor/shared/index.ts` | TS source (own copy) |
| `server` | `@devdigest/reviewer-core` | `../reviewer-core/src/index.ts` | **TS source**, not a built package |
| `client` | `@devdigest/shared` | `client/src/vendor/shared/index.ts` | TS source (**its own second copy**) |
| `client` | `@devdigest/ui` | `client/src/vendor/ui/index.ts` | TS source |
| `client` | `@/*` | `client/src/*` | TS source |
| `reviewer-core` | `@devdigest/shared` | `../server/src/vendor/shared/*` | TS source (reaches into `server/`) |
| `reviewer-core` | `zod` | `./node_modules/zod` | **see the landmine below** |
| `mcp-server` | `@devdigest/shared` | `../server/src/vendor/shared/*` | TS source (reaches into `server/`) |

Two consequences a dependency report must state, because they are invisible to `package.json`:

- **`reviewer-core` is consumed as TS source, not as a build artifact.** Its `build` script is
  `tsc --noEmit`. So `server` depends on `reviewer-core`'s *source tree*, and a change there is a
  compile-time change to `server`, with no version, no lockfile entry, and no npm edge.
- **`@devdigest/shared` is dual-vendored** — `server/src/vendor/shared/` and
  `client/src/vendor/shared/` are two physically separate copies of the same logical contracts.
  Every contract edit is a **two-file edit**. A one-sided edit typechecks on each side
  independently and fails only at runtime, when Zod rejects the wire payload. That makes a
  one-sided vendored edit a **P0**.

## Landmines

**`npm audit` cannot run in `server/`, `client/`, `mcp-server/`, or `evals/`.** They are pnpm
packages with no `package-lock.json`; `npm audit` exits with `npm error code ENOLOCK / This command
requires an existing lockfile`. Use `pnpm audit --audit-level high` there, and `npm audit` only in
`reviewer-core/` and `e2e/`.

**`client/` is already red on a clean tree.** `pnpm audit --audit-level high` reports
`11 vulnerabilities — 1 low | 7 moderate | 2 high | 1 critical`, all transitive via
`@vitejs/plugin-react > vite`, with zero local changes. These are **Info**, not P0. A tiering that
blocks a PR on them blocks every PR in the repo. Trigger a dependency-advisory finding on a changed
**lockfile**, not on a changed `package.json` — renaming a script introduces no vulnerability.

**A `zod` entry in a new package's tsconfig `paths` makes `tsc` OOM.** `reviewer-core/tsconfig.json`
has one and is fine *only* because it imports `@devdigest/shared` with `import type` — no Zod
*values* cross a generic library boundary. A new package that both consumes `@devdigest/shared` and
passes those Zod values into a generic library (as `mcp-server` does with the MCP SDK's
`registerTool`) must **not** add the alias: it splits Zod into two type identities and `tsc` either
runs out of heap or reports `TS2589: Type instantiation is excessively deep`. `mcp-server` and
`server` therefore carry no `zod` alias. Flag any new one as **P0**.

**Vitest does not honor tsconfig `paths`.** A package using an alias needs the same mapping repeated
in `vitest.config.ts` under `resolve.alias`, or its tests fail with "Failed to load url
@devdigest/shared" while `tsc` stays green. When you find a `paths` entry, check for its
`vitest.config.ts` twin.

**`node_modules` may simply not be installed** for a package (`e2e/` often isn't). Size analysis is
then unavailable for it — report that in `## Scope`; do not drop the package silently and do not
estimate.

## Shared dependencies to watch for drift

These are declared in more than one package, so they are where version drift actually costs
something. Current state on this tree (2026-07-11):

| Dependency | Declared in | Note |
|------------|-------------|------|
| `typescript` | all six | `^5.7.2` everywhere except `evals` (`^5.6.0`) |
| `vitest` | server, client, reviewer-core, mcp-server, evals | `^2.1.8` except `evals` (`^2.1.0`) |
| `@types/node` | all six | `^22.10.0` except `evals` (`^22.0.0`) |
| `tsx` | server, reviewer-core, e2e, mcp-server, evals | `^4.19.2` except `evals` (`^4.19.0`) |
| `zod` | server, client, reviewer-core | the one that matters — it crosses the `@devdigest/shared` boundary |

`zod` drift is the load-bearing one: it is the only drifting dependency whose *types* travel across
a package boundary, so a mismatch there is a real type-identity hazard rather than a tooling
annoyance. The `evals` package's older ranges are a lower-stakes P2 — it is a dev-only harness that
nothing imports.
