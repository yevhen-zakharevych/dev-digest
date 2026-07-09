# Development Plan — L04: `devdigest-mcp` (local stdio MCP server)

## 1. Overview

Add a new **local stdio MCP transport** to `server/` that exposes exactly 5 tools, each a *thin* adapter over existing DI-wired services. The MCP server is a sibling entrypoint to Fastify (`server/src/server.ts`): it builds the same `Container` but never calls `buildApp()`. Per onion-architecture, tool handlers contain **zero business logic** — they resolve inputs, call existing services/repositories via `Container`, and map results to concise structured responses. The design bakes in the four course principles (result-not-operation, flat args, concise structured output, error-leads-onward) at every tool.

## 2. Requirements

- New stdio-only MCP server built on `@modelcontextprotocol/sdk` v1.x (`McpServer` + `registerTool`, `StdioServerTransport`). No HTTP transport.
- Entrypoint `server/src/mcp.ts` mirrors `server.ts` wiring (`loadConfig()` → `createDb()` → `new Container(config, db)`), **not** `buildApp()`.
- Exactly 5 tools, each a thin transport over existing services through `Container`; no DB access or `new OpenAI()` in handlers.
- Every tool `inputSchema` is a **flat** Zod object, `.strict()`, with `.describe()` on every field; **no nested objects**.
- Every tool declares an `outputSchema` and returns `structuredContent` + a short text block (concise, only needed fields).
- Business/validation failures return `isError: true` with an actionable next-step message; JSON-RPC protocol errors reserved for malformed requests.
- Annotations: 4 read tools `readOnlyHint:true, idempotentHint:true, destructiveHint:false, openWorldHint:false`; `run_agent_on_pr` is non-read-only.
- `run_agent_on_pr` is **result-not-operation**: create run → bounded poll (env `DEVDIGEST_MCP_RUN_TIMEOUT_MS`, default 120000) → return `{ verdict, findings[] }`; on timeout return `{ run_id, status: "running" }` + a "poll `get_findings`" message.
- `get_findings` caps output (~25k chars) with `{ total, count, offset, has_more, next_offset }` and a `format: concise|detailed` toggle. `list_agents`/`get_conventions` are bounded lists — no pagination.
- `get_blast_radius` is a **pure stub** returning a valid `BlastRadius` shape (empty arrays + explanatory `summary`), structured so the homework swap = call `container.repoIntel.getBlastRadius` + map.
- One new small repository read (`reviewByRunId`) and one PR resolver read (`getPullByNumber`) — the only new application-layer code.
- Add `server/` dependency + `mcp` script (pnpm); recommend against `bin`.
- **Prefer zero `@devdigest/shared` edits** (see §4); if unavoidable, dual-vendor per root `INSIGHTS.md:37-40`.

## 3. Relevant Insights

- **Parallel implementers share the tree; safety is file ownership, not isolation** — `INSIGHTS.md:27`. Every task below owns a disjoint file set; the shared catalog files (`package.json`, `config.ts`, the reviews repository trio, the `mcp/server.ts` wiring) are single-owner tasks placed in their own waves.
- **Every `@devdigest/shared` contract is a two-file edit** (`server/src/vendor/shared/**` + `client/src/vendor/shared/**`) — root `INSIGHTS.md:37-40`. This plan deliberately keeps MCP-transport schemas **out of** `shared` (precedent: `IdParams` lives in `server/src/modules/_shared/schemas.ts`, not vendored), so the feature ships **zero** vendored edits, matching the best outcome of L03 SmartDiff (`INSIGHTS.md:66`).
- **The grounding gate silently drops a fixture finding whose lines don't intersect the injected diff hunk** — `server/INSIGHTS.md:38`. The run→poll→findings it-test MUST pair its `Review` fixture with a matching `@@` diff hunk covering the finding's line range (mirror `server/test/intent.it.test.ts:36-42`), or `findings` come back `[]` with no error.
- Bonus landmine: **`LocalNoAuthProvider.currentWorkspace()` ignores its arg and always returns the seeded default workspace** (`server/src/adapters/auth/local.ts:28`; port signature `currentWorkspace(req: unknown)` at `adapters.ts:280`). The MCP layer calls it directly with `undefined` for workspace/user resolution — no HTTP request needed.

## 4. Architecture Changes

### New transport layer — `server/src/mcp/` (+ `server/src/mcp.ts`)

Recommended layout (folder, not a single file — keeps each handler small and unit-testable):

| File | Purpose |
|------|---------|
| `server/src/mcp.ts` | Entrypoint. `loadConfig()` → `createDb()` (`db/client.ts:17`, take `.db`) → `new Container(config, db)` → `buildMcpServer(container)` → connect `StdioServerTransport`. SIGINT/SIGTERM graceful close. No Fastify. |
| `server/src/mcp/server.ts` | `buildMcpServer(container)`: constructs `McpServer`, calls each tool's `register*(server, container)`. The single wiring/barrel file. |
| `server/src/mcp/schemas.ts` | The 5 **flat** `.strict()` input schemas (`.describe()` per field) + MCP-local output envelope schemas (concise-finding, findings-page, run-result union, running-status). Imports shared data contracts (`Agent`, `Verdict`, `ConventionCandidate`, `BlastRadius`) as building blocks. **Transport-local — NOT vendored.** |
| `server/src/mcp/mappers.ts` | Pure functions: `toConciseFinding(ReviewDtoFinding\|FindingRow)`, `paginateFindings(...)`, `emptyBlastRadius(summary)`, `blastResultToContract(BlastResult)` (homework mapper). No DB, no `this`. |
| `server/src/mcp/resolve.ts` | DB-backed input resolvers: `resolveWorkspaceId(container)`, `resolveRepoBySlug(container, wsId, "owner/name")`, `resolvePrId(container, wsId, repoId, prNumber)`. Compose existing repos + the new `getPullByNumber`. |
| `server/src/mcp/tools/list-agents.ts` | `registerListAgents(server, container)`. |
| `server/src/mcp/tools/run-agent-on-pr.ts` | `registerRunAgentOnPr(server, container)`. |
| `server/src/mcp/tools/get-findings.ts` | `registerGetFindings(server, container)`. |
| `server/src/mcp/tools/get-conventions.ts` | `registerGetConventions(server, container)`. |
| `server/src/mcp/tools/get-blast-radius.ts` | `registerGetBlastRadius(server, container)`. |

**Onion placement rationale.** `mcp/` is infrastructure (transport), peer to `modules/<name>/routes.ts`. Handlers may `new AgentsService(container)` / `new ReviewService(container)` and read `container.reviewRepo`/`container.agentsRepo` — exactly as routes do (`reviews/routes.ts:25`). They must not touch the DB or LLM directly.

**Why MCP schemas stay out of `shared` (design decision, overriding the brief's `contracts/mcp.ts` fallback).** MCP tool input/output shapes are consumed by the LLM client over stdio, **never by `@devdigest/web`**. They are transport-local — the exact category the repo already keeps in-module (`modules/_shared/schemas.ts` `IdParams`, referenced from `reviews/routes.ts:6`), not in `vendor/shared`. Putting them in `contracts/mcp.ts` would force a dual-vendored two-file edit (`INSIGHTS.md:37-40`) for schemas the client can't use — pure risk with no benefit. We therefore **reuse** existing vendored *data* contracts as building blocks (`Agent` `knowledge.ts:286`, `Verdict` `findings.ts:26`, `ConventionCandidate` `knowledge.ts:184`, `BlastRadius` `brief.ts:39`) and wrap them in **local** envelopes. Net: **zero `shared` edits**.

### New application-layer reads (reviews module)

Two additive reads — the only genuinely new non-transport code:

- `reviewByRunId(workspaceId, runId)` → `{ review, findings[] } | undefined`. New. `reviews.runId` (`db/schema/reviews.ts:19`, nullable uuid, **no FK**) links a review to its run; no existing read uses it (`reviewsForPull` is PR-keyed, `review.repo.ts:58`). Add `reviewByRunId` in `review.repo.ts` + expose on `ReviewRepository` (`repository.ts`).
- `getPullByNumber(workspaceId, repoId, number)` → `PullRow | undefined`. New. The `pulls` module has **no** `repository.ts` (queries are inline in `pulls/routes.ts`); no by-number lookup exists. The unique index `pr_repo_number_uq` on `(repoId, number)` exists (`db/schema/pulls.ts`). Add `getPullByNumber` in `reviews/repository/pull.repo.ts` + expose on `ReviewRepository`. (Placed in the reviews repository because `ReviewRepository` already owns `getPull`/`getRepo` and the MCP layer already depends on `container.reviewRepo`.)

### Platform config

- `server/src/platform/config.ts`: add `DEVDIGEST_MCP_RUN_TIMEOUT_MS` to `EnvSchema` (coerce number, default 120000) and `mcpRunTimeoutMs` to `AppConfig`. Keeps the poll ceiling out of `process.env` in handler code (onion: config via `AppConfig`, `config.ts:15-81`).

### Dependency + scripts

- `server/package.json`: add `@modelcontextprotocol/sdk` (`^1.29.0`) to `dependencies`; add script `"mcp": "tsx src/mcp.ts"`. **Recommendation on `bin`: do NOT add one now.** The server is consumed as TS source via `tsx` (no `dist` build wired for a second entry); Claude Desktop/Code launches it via `command: "tsx"` + absolute path (see §9). Adding a `bin` → `dist/mcp.js` implies a build/publish pipeline this repo intentionally lacks ("NOT a workspace", root `CLAUDE.md`). Revisit if packaging is needed later.

## 5. The 5 tool contracts (input Zod fields → reused output contract)

All input schemas: flat, `.strict()`, `.describe()` on every field.

1. **`list_agents`** — read-only.
   - Input: *none* (empty strict object).
   - Handler: `new AgentsService(container).list(workspaceId)` → `Agent[]`. **Correction to the brief:** use `AgentsService.list` (`agents/service.ts:58`), **not** `container.agentsRepo.list` — the repo returns raw `AgentRow[]` (`agents/repository.ts:55`); the service applies `toAgentDto` to produce the `Agent` contract (with `version`/`skills_count`).
   - Output: `{ agents: z.array(Agent) }` (reuse `Agent`, `knowledge.ts:286`). Text block: one line per agent `id — name (enabled?)`.

2. **`run_agent_on_pr`** — the only mutating tool (non-read-only).
   - Input: `repo` (`"owner/name"`), `pr` (int, PR number), `agent` (agent id from `list_agents`). Flat.
   - Handler: resolve `workspaceId` → `resolveRepoBySlug` → `resolvePrId` → `ReviewService.resolveTargets(ws,{agentId})` (`reviews/service.ts:52`) → `runReview(ws, prId, targets)` (`:109`, fire-and-forget `void executor.executeRuns`, `:140`) → capture the single `run_id`. Then **DB-poll** `ReviewService.listRuns(ws, prId)` (→ `RunSummary[]` incl. `status`, `run.repo.ts:40`) filtering by `run_id`, interval ~1000ms up to `config.mcpRunTimeoutMs`. Terminal = `status !== 'running'` (values `running|done|failed|cancelled`, `runs.ts:28`). On `done` → `reviewByRunId(run_id)` → concise. On `failed`/`cancelled` → `isError:true` with the run's `error`. On timeout → `{ run_id, status:"running" }`.
   - Output (union): `{ run_id, verdict, findings[] }` **or** `{ run_id, status:"running", message }`. `verdict` = `Verdict.nullable()`; `findings` = concise-finding array (local). (`run_id` is returned on BOTH branches — added post-implementation so a caller can always re-fetch this exact run via `get_findings {run_id}` instead of falling back to PR-scoped aggregation across all agents' reviews.)
   - **Poll vs subscribe:** DB poll recommended. `executeRuns` runs in-process (same `Container`), so `runBus.onDone` would also fire; but poll is simpler for a request/response tool and robust to executor crashes (the row still flips to a terminal state / gets reaped). No new status read needed — `listRuns` already returns it.

3. **`get_findings`** — read-only.
   - Input: `run_id` (uuid) *or* `repo`+`pr`; `format` (`concise|detailed`, default `concise`); `offset` (int, default 0). Flat; refine: exactly one of `run_id` or (`repo`+`pr`).
   - Handler: `run_id` path → new `reviewByRunId(ws, run_id)`; `repo`+`pr` path → resolve prId → `ReviewService.reviewsForPull(ws, prId)` (`service.ts:167`) then aggregate findings across reviews. Map rows → concise (or detailed) findings; paginate with the 25k-char budget.
   - Output: `{ verdict, findings[], total, count, offset, has_more, next_offset }`. `concise` = `id, severity, category, title, file, start_line, end_line`; `detailed` adds `rationale, suggestion, confidence`. Data fields derive from `Finding` (`findings.ts:47`) but the envelope is local.

4. **`get_conventions`** — read-only.
   - Input: `repo` (`"owner/name"`). Flat. **Keyed by repoId, not PR.**
   - Handler: resolve `workspaceId` → `resolveRepoBySlug` → `new ConventionsService(container).listForRepo(ws, repoId, ['accepted'])` (`conventions/service.ts:113`, repo `listByRepo` `conventions/repository.ts:29`).
   - Output: `{ conventions: z.array(ConventionCandidate) }` (reuse `ConventionCandidate`, `knowledge.ts:184`).

5. **`get_blast_radius`** — read-only, **deliberate stub**.
   - Input: `repo`, `pr` (int). Flat.
   - Handler (stub): resolve inputs (so errors lead onward for bad repo/pr), then return `emptyBlastRadius("blast radius not yet implemented (L04 homework)")` — a valid `BlastRadius` (`brief.ts:39`) with `changed_symbols: []`, `downstream: []`.
   - Output: `BlastRadius` (reused). **Homework hook:** a `// TODO(L04-homework)` comment + the ready `blastResultToContract` mapper in `mappers.ts`; finishing = resolve changed files (`ReviewRepository.getPrFiles(prId)` `repository.ts:38`) → `container.repoIntel.getBlastRadius(repoId, changedFiles)` (`repo-intel/service.ts:220`, returns `BlastResult` `repo-intel/types.ts:74`) → `blastResultToContract`. Mapping is non-trivial: `BlastResult.changedSymbols{file,name,kind}` → `changed_symbols` (`ChangedSymbol{name,file,kind}`); group `callers[]` (`BlastCallerRow{file,symbol,viaSymbol,line}`) + `impactedEndpoints[]` by `viaSymbol` into `downstream[]` (`DownstreamImpact{symbol, callers:[{name,file,line}], endpoints_affected, crons_affected}`).

**Error-leads-onward messages (spec):** agent not found → "agent '\<id\>' not found — call list_agents for valid ids"; repo not found → "repo '\<owner/name\>' not imported — add it in DevDigest first"; pr not found → "PR #\<n\> not found in \<owner/name\>"; run failed → the run's `error` + "inspect the run in DevDigest"; timeout → "review still running after \<ms\>ms — call get_findings with run_id '\<id\>'".

### 5.1 Canonical tool descriptions & field docs (copy verbatim into `registerTool`)

Descriptions are English (LLM-facing convention), terse (1–3 sentences, no prose duplication of the JSON schema — that lives in `outputSchema`). Each states what the tool does **and does not** do, and points to the next tool where relevant. Implementers of W1-LIST / W2-* MUST use these strings and per-field `.describe()` text verbatim; W0-SCHEMAS owns the `.describe()` texts on the input schemas.

**Naming/cross-cutting:** all tools `snake_case`, verb-first; no `devdigest_` prefix (single server, no aggregation). "Error leads onward" is expressed in BOTH the `description` (so the model expects the next step) and at runtime via `isError:true` with the matching §5 message.

1. **`list_agents`**
   - `description`: `List the review agents configured in DevDigest — their id, name and enabled state. Read-only. Call this first to get a valid \`agent\` id for run_agent_on_pr. Does NOT run a review or change anything.`
   - input: empty `.strict()` object.
   - annotations: `readOnlyHint:true, idempotentHint:true, destructiveHint:false, openWorldHint:false`.

2. **`run_agent_on_pr`** (only non-read-only tool)
   - `description`: `Run one review agent on a pull request end-to-end: creates the run, waits for it to finish, and returns the verdict plus findings. This is the only tool that writes. If the review is still running after the server timeout, returns { run_id, status:"running" } — then call get_findings with that run_id. If the agent id is unknown, returns an error telling you to call list_agents.`
   - field `.describe()`: `repo` = `Repository in "owner/name" form, e.g. "acme/web".`; `pr` = `Pull request number as shown on GitHub (not an internal id).`; `agent` = `Agent id from list_agents.`
   - annotations: `readOnlyHint:false, destructiveHint:false, idempotentHint:false, openWorldHint:true` (triggers an external LLM call).

3. **`get_findings`**
   - `description`: `Fetch the findings of an already-completed review run as a concise verdict + list. Read-only. Identify the run by \`run_id\` (from run_agent_on_pr) OR by \`repo\`+\`pr\`. Returns only key fields by default; pass format="detailed" for rationale/suggestion. Large results are paginated — pass \`offset\` from the returned next_offset. Does NOT start a review; if none exists, returns an error telling you to call run_agent_on_pr.`
   - field `.describe()`: `run_id` = `Run id from run_agent_on_pr. Provide this OR repo+pr, not both.`; `repo` = `Repository "owner/name". Use with pr instead of run_id.`; `pr` = `Pull request number. Use with repo instead of run_id.`; `format` = `"concise" (default: id, severity, title, file, lines) or "detailed" (adds rationale, suggestion, confidence).`; `offset` = `Pagination start index; use next_offset from the previous page. Default 0.`
   - annotations: `readOnlyHint:true, idempotentHint:true, destructiveHint:false, openWorldHint:false`.

4. **`get_conventions`**
   - `description`: `Return the repository's accepted house conventions (the repo-conventions extracted in Lesson 2). Read-only, keyed by repository — not by a PR. Does NOT extract or modify conventions. If the repo isn't imported, returns an error telling you to add it in DevDigest.`
   - field `.describe()`: `repo` = `Repository "owner/name".`
   - annotations: `readOnlyHint:true, idempotentHint:true, destructiveHint:false, openWorldHint:false`.

5. **`get_blast_radius`** (deliberate stub)
   - `description`: `Return the blast radius (impact map) of a pull request: which symbols changed and what downstream code they affect. Read-only. NOTE: this is currently a stub and returns an EMPTY blast radius — the full implementation is L04 homework. Does NOT modify anything.`
   - field `.describe()`: `repo` = `Repository "owner/name".`; `pr` = `Pull request number.`
   - annotations: `readOnlyHint:true, idempotentHint:true, destructiveHint:false, openWorldHint:false`.
   - Rationale: the description is deliberately honest about the empty result so the model does not trust an empty blast radius as "nothing impacted" (best-practice C2).

## 6. Parallelizable Tasks

Module is `server` throughout.

| Task | Files owned (`file:line` anchors) | Skills to apply | Acceptance criteria | Tests to run | Depends-on | Batch |
|------|-----------------------------------|-----------------|---------------------|--------------|------------|-------|
| **W0-PKG** | `server/package.json:17-42` (deps) + `:6-16` (scripts) + `pnpm-lock.yaml` | typescript-expert, security | `@modelcontextprotocol/sdk` `^1.29.0` added to `dependencies`; `"mcp": "tsx src/mcp.ts"` script added; **no `bin`** added; `pnpm install` run so lockfile resolves; `pnpm typecheck` still clean. No other file touched. | `cd server && pnpm install && pnpm typecheck` | — | — (lockfile; alone) |
| **W0-CFG** | `server/src/platform/config.ts:15-39` (EnvSchema), `:41-62` (AppConfig type), `:64-81` (loadConfig return) | zod, typescript-expert | `DEVDIGEST_MCP_RUN_TIMEOUT_MS` added to `EnvSchema` as `z.coerce.number().int().default(120000)`; `mcpRunTimeoutMs: number` added to `AppConfig`; mapped in `loadConfig` return. Secrets rule respected (not added to schema). `pnpm typecheck` clean. | `cd server && pnpm typecheck` | — | — |
| **W0-SCHEMAS** | `server/src/mcp/schemas.ts` (new), `server/test/mcp-schemas.test.ts` (new) | zod, typescript-expert, onion-architecture, security | Exports 5 flat `.strict()` input schemas with `.describe()` on **every** field: `ListAgentsInput` (empty), `RunAgentOnPrInput{repo,pr,agent}`, `GetFindingsInput{run_id?,repo?,pr?,format,offset}` (refine: exactly one of `run_id` xor `repo`+`pr`; `format` default `'concise'`; `offset` default 0), `GetConventionsInput{repo}`, `GetBlastRadiusInput{repo,pr}`. Exports local output envelopes: `ConciseFinding`, `FindingsPage`, `RunResult` (union verdict/findings ∪ running), reusing `Agent`/`Verdict`/`ConventionCandidate`/`BlastRadius` from `@devdigest/shared`. **No file under `vendor/shared/**` touched.** Unit test asserts each input rejects unknown keys (`.strict`) and nested objects, and accepts valid flat input. | `cd server && pnpm exec vitest run test/mcp-schemas.test.ts && pnpm typecheck` | W0-PKG (SDK types optional here; schemas are pure Zod) | MCP-PURE |
| **W0-MAP** | `server/src/mcp/mappers.ts` (new), `server/test/mcp-mappers.test.ts` (new) | typescript-expert, onion-architecture | Pure (no DB/`this`/env). `toConciseFinding(row)` maps a `FindingRow`/`ReviewDtoFinding` (`reviews/helpers.ts:12`, `findings.ts:47`) → `ConciseFinding` (concise) or full (detailed). `paginateFindings(all, offset, {maxChars:25000})` returns `{items,total,count,offset,has_more,next_offset}` sorted by severity (CRITICAL→WARNING→SUGGESTION), slicing at offset and stopping at the char budget. `emptyBlastRadius(summary)` returns a valid `BlastRadius` (`brief.ts:39`) with empty arrays. `blastResultToContract(BlastResult)` (`repo-intel/types.ts:74` → `brief.ts:39`) groups callers by `viaSymbol` into `downstream[]` — carries a `// TODO(L04-homework)` note but is fully implemented so the stub swap is a one-liner. Unit tests cover: severity ordering, char-budget cutoff sets `has_more`+`next_offset`, empty-blast shape validates against `BlastRadius.parse`, `blastResultToContract` groups two callers of one symbol correctly. | `cd server && pnpm exec vitest run test/mcp-mappers.test.ts && pnpm typecheck` | — | MCP-PURE |
| **W0-REPO** | `server/src/modules/reviews/repository/review.repo.ts:76-79` (add `reviewByRunId`), `server/src/modules/reviews/repository/pull.repo.ts:9-19` (add `getPullByNumber`), `server/src/modules/reviews/repository.ts:62-69` + `:28-40` (expose both on `ReviewRepository`) | drizzle-orm-patterns, onion-architecture, postgresql-table-design | `reviewByRunId(db, workspaceId, runId)` selects the review by `eq(reviews.runId, runId)` + `eq(reviews.workspaceId, workspaceId)` (newest first, take 1) and its findings via `inArray(findings.reviewId, …)` — returns `{review, findings[]} | undefined`; exposed as `ReviewRepository.reviewByRunId(workspaceId, runId)`. `getPullByNumber(db, workspaceId, repoId, number)` selects `pullRequests` by `and(workspaceId, repoId, number)` (unique `pr_repo_number_uq`) → `PullRow | undefined`; exposed as `ReviewRepository.getPullByNumber(...)`. Both workspace-scoped. No existing method signature changed. `pnpm typecheck` clean. | `cd server && pnpm typecheck && pnpm exec vitest run --exclude '**/*.it.test.ts'` | — | — |
| **W1-RESOLVE** | `server/src/mcp/resolve.ts` (new) | onion-architecture, typescript-expert, security | `resolveWorkspaceId(container)` = `(await container.auth.currentWorkspace(undefined)).id` (arg ignored, `auth/local.ts:28`). `resolveRepoBySlug(container, wsId, slug)` validates `slug` is `owner/name`, uses `new RepoRepository(container.db).findByFullName(wsId, slug)` (`repos/repository.ts:24`) → `RepoRow`; returns a typed not-found signal (not a throw) so handlers emit `isError`. `resolvePrId(container, wsId, repoId, number)` uses `container.reviewRepo.getPullByNumber` → prId or not-found. No LLM/DB writes. `pnpm typecheck` clean. | `cd server && pnpm typecheck` | W0-REPO | — |
| **W1-LIST** | `server/src/mcp/tools/list-agents.ts` (new) | onion-architecture, zod | `registerListAgents(server, container)` registers tool `list_agents` with empty strict input, annotations `readOnly/idempotent:true, destructive/openWorld:false`, `outputSchema {agents: Agent[]}`. Handler: `wsId = resolveWorkspaceId`; `agents = await new AgentsService(container).list(wsId)` (`agents/service.ts:58` — **not** the raw repo). Returns `structuredContent:{agents}` + a short text list. No DB/LLM in the handler beyond the service call. | `cd server && pnpm typecheck` | W0-SCHEMAS | — |
| **W2-RUN** | `server/src/mcp/tools/run-agent-on-pr.ts` (new) | onion-architecture, fastify-best-practices, typescript-expert, security | Registers `run_agent_on_pr`, annotations non-read-only (`readOnlyHint:false`). Input `{repo,pr,agent}`. Handler: resolve ws/repo/prId; on any resolve miss → `isError:true` with the §5 message. `resolveTargets(ws,{agentId:agent})` then `runReview` (`reviews/service.ts:109`); capture single `run_id`. Poll `container.reviewRepo.listRunsForPull(ws, prId)` filtered to `run_id` every ~1000ms up to `container.config.mcpRunTimeoutMs`. On `status==='done'` → `reviewByRunId` → `{verdict, findings: concise}` via mappers. On `failed`/`cancelled` → `isError:true` + run `error`. On timeout → `{run_id, status:'running', message:"…get_findings with run_id"}`. Agent-not-found from `resolveTargets` (`NotFoundError`) is caught → `isError` "call list_agents". No direct DB/LLM. | `cd server && pnpm typecheck` | W0-SCHEMAS, W0-MAP, W0-CFG, W1-RESOLVE, W0-REPO | MCP-TOOLS |
| **W2-FIND** | `server/src/mcp/tools/get-findings.ts` (new) | onion-architecture, typescript-expert | Registers `get_findings`, read-only annotations. Input refine enforced by schema. Handler: `run_id` branch → `container.reviewRepo.reviewByRunId(ws, run_id)`; `repo`+`pr` branch → resolve prId → `new ReviewService(container).reviewsForPull(ws, prId)` (`service.ts:167`) and flatten findings. Map via `toConciseFinding`/detailed; `paginateFindings(…, offset, {maxChars:25000})`. Output `{verdict, findings, total, count, offset, has_more, next_offset}`. Not-found run/pr → `isError` "no review for that run_id/PR — run_agent_on_pr first". | `cd server && pnpm typecheck` | W0-SCHEMAS, W0-MAP, W0-REPO, W1-RESOLVE | MCP-TOOLS |
| **W2-CONV** | `server/src/mcp/tools/get-conventions.ts` (new) | onion-architecture, zod | Registers `get_conventions`, read-only annotations. Input `{repo}`. Handler: resolve ws + repoId (via `resolveRepoBySlug`); `new ConventionsService(container).listForRepo(ws, repoId, ['accepted'])` (`conventions/service.ts:113`). Output `{conventions: ConventionCandidate[]}`. Repo-not-found → `isError` with §5 message. Keyed by repoId, not PR. | `cd server && pnpm typecheck` | W0-SCHEMAS, W1-RESOLVE | MCP-TOOLS |
| **W2-BLAST** | `server/src/mcp/tools/get-blast-radius.ts` (new) | onion-architecture, typescript-expert | Registers `get_blast_radius`, read-only annotations. Input `{repo,pr}`. Handler: resolve ws/repo/pr (so bad inputs lead onward), then return `emptyBlastRadius("blast radius not yet implemented (L04 homework)")` as `structuredContent`. Include `// TODO(L04-homework)`: the real path (`getPrFiles` → `container.repoIntel.getBlastRadius` `repo-intel/service.ts:220` → `blastResultToContract`) written as a commented/guarded block referencing `mappers.blastResultToContract`. Output validates against `BlastRadius`. | `cd server && pnpm typecheck` | W0-SCHEMAS, W0-MAP, W1-RESOLVE | MCP-TOOLS |
| **W3-WIRE** | `server/src/mcp/server.ts` (new), `server/src/mcp.ts` (new) | onion-architecture, fastify-best-practices, typescript-expert | `buildMcpServer(container)` constructs `McpServer` (name `devdigest-mcp`, version) and calls all 5 `register*` fns. `mcp.ts`: `loadConfig()` → `createDb(config.databaseUrl)` (`db/client.ts:17`, use `.db`) → `new Container(config, db)` → `buildMcpServer` → `server.connect(new StdioServerTransport())`; SIGINT/SIGTERM graceful close mirroring `server.ts:12-26`. **No `buildApp` import.** `pnpm typecheck` clean; `tsx` can start `src/mcp.ts` without throwing when Postgres is up. | `cd server && pnpm typecheck` | W1-LIST, W2-RUN, W2-FIND, W2-CONV, W2-BLAST, W0-PKG, W0-CFG | — |
| **W4-IT** | `server/test/mcp.it.test.ts` (new) | drizzle-orm-patterns, typescript-expert, security | Testcontainers Postgres. Build a `Container` with `overrides.llm.<provider>` = a `MockLLMProvider` returning a fixture `Review` (mirror `server/test/intent.it.test.ts` container setup, `MockLLMProvider` `mocks.ts:58`). Seed repo/pr/agent; **the injected diff MUST contain an `@@` hunk covering the fixture finding's line range** (grounding landmine, `server/INSIGHTS.md:38`; pattern `intent.it.test.ts:36-42`) else findings vanish. Drive handlers directly (call `register*` against a stub server capturing the handler, or export handler fns) with LLM mocked — never a real key. Assert: (a) `run_agent_on_pr` polls to `done` and returns `{verdict, findings[]}` with the seeded finding; (b) `get_findings` by that `run_id` returns the same concise finding + correct pagination fields; (c) `list_agents` returns the seeded agent id; (d) `get_conventions` returns accepted rows for a seeded repo; (e) unknown agent id → `isError` mentioning `list_agents`; (f) `get_blast_radius` returns a `BlastRadius`-valid empty stub. File ends `.it.test.ts` (CI split, `AGENTS.md:35`). Mutation-worthy: flip poll-terminal condition, drop the grounding-matched hunk, swap concise/detailed. | `cd server && pnpm exec vitest run test/mcp.it.test.ts` (Docker) | W3-WIRE | — |

**Batch notes.** `MCP-PURE` = {W0-SCHEMAS, W0-MAP}: same module/layer, disjoint files, no interdep, no shared-contract edit → one implementer spawn. `MCP-TOOLS` = {W2-RUN, W2-FIND, W2-CONV, W2-BLAST}: same module, one file each, no deps between them, no shared-contract edit → one spawn. W0-PKG (lockfile), W0-CFG (platform), W0-REPO (reviews module), W1-RESOLVE, W1-LIST, W3-WIRE, W4-IT run alone (distinct onboarding sets or dependency edges).

**Wave ordering:** Wave 0 = {W0-PKG, W0-CFG, W0-REPO, MCP-PURE(=W0-SCHEMAS+W0-MAP)} → Wave 1 = {W1-RESOLVE, W1-LIST} → Wave 2 = {MCP-TOOLS(=W2-RUN+W2-FIND+W2-CONV+W2-BLAST)} → Wave 3 = {W3-WIRE} → Wave 4 = {W4-IT}.

## 7. Testing Strategy (per-module commands)

- **Hermetic unit** (pure handlers/mappers/schemas, LLM never real): `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — covers W0-SCHEMAS (`mcp-schemas.test.ts`), W0-MAP (`mcp-mappers.test.ts`).
- **Integration** (testcontainers Postgres; the run→poll→findings flow — warranted because it exercises `runReview` fire-and-forget + DB poll + `reviewByRunId` across a real DB): `cd server && pnpm exec vitest run .it.test` (Docker required) — covers W4-IT (`mcp.it.test.ts`).
- **Typecheck** each task: `cd server && pnpm typecheck`.
- **Install/lock** (W0-PKG only): `cd server && pnpm install`.
- Client / reviewer-core / e2e suites: **not touched** (no `shared` edit, no client/reviewer-core/e2e files).

## 8. Risks & Mitigations

- **Long review exceeds the bounded MCP call** — *Medium*. Mitigation: bounded poll to `mcpRunTimeoutMs` then return `{run_id, status:"running"}` + "call `get_findings`" (result-not-operation degrades gracefully; the run keeps executing in-process and its row reaches a terminal state).
- **Reviews need a real LLM key to produce findings** — *Medium*. Mitigation: `list_agents`, `get_conventions`, `get_blast_radius` (stub) work with no keys; `run_agent_on_pr` without a configured provider key surfaces the run's `failed` error as `isError` (not a crash). Demo doc (§9) notes keys are configured via the DevDigest settings UI / `~/.devdigest/secrets.json` (`LocalSecretsProvider`), not env.
- **Grounding silently drops the it-test fixture finding** — *High if missed*. Mitigation: W4-IT acceptance criteria mandate a diff hunk matching the finding's lines (`server/INSIGHTS.md:38`); called out as mutation-worthy.
- **`reviews.runId` is nullable with no FK** — *Low*. Mitigation: `reviewByRunId` returns `undefined` when absent; handler maps to `isError`. Reviews created by `runReview` always carry `run_id` (`review.repo.ts:19` via executor), so the happy path is covered.
- **SDK API drift (v1.x `registerTool`)** — *Low*. Mitigation: pin `^1.29.0`; W3-WIRE typecheck catches signature mismatch; annotations/`outputSchema`/`structuredContent` are stable v1 surface.
- **Claude Desktop/Code launch config** — *Low*. Documented in §9; stdio server started via `tsx src/mcp.ts` with `cwd=server` and `DATABASE_URL` in env.

## 9. Success Criteria

- [ ] `cd server && pnpm typecheck` clean with all new `mcp/` files.
- [ ] `pnpm exec vitest run --exclude '**/*.it.test.ts'` green incl. `mcp-schemas.test.ts` + `mcp-mappers.test.ts`.
- [ ] `pnpm exec vitest run test/mcp.it.test.ts` green (Docker) — run→poll→findings, get_findings, list_agents, get_conventions, error-leads-onward, blast stub.
- [ ] `git status` shows **no** change under `server/src/vendor/shared/**` or `client/src/vendor/shared/**` (zero-vendored-edit goal).
- [ ] All 5 tools registered via `registerTool` with flat `.strict()` inputs, `.describe()` per field, `outputSchema` + `structuredContent`, correct annotations; `run_agent_on_pr` is the only non-read-only tool.
- [ ] `run_agent_on_pr` returns findings within the ceiling or a `running` handoff; failures return `isError` with a next-step message.
- [ ] `get_blast_radius` returns a `BlastRadius`-valid empty stub with a `TODO(L04-homework)` swap point and a ready `blastResultToContract` mapper.
- [ ] No handler touches the DB or LLM directly — all access via `Container`/services/`reviewRepo` (onion boundary held).
- [ ] `server/package.json` has the SDK dep + `mcp` script; no `bin`; lockfile resolves.

### How to run / verify (smoke path)

1. Start Postgres + migrate + seed: `docker compose up -d` (NO `-v`), `cd server && pnpm db:migrate && pnpm db:seed`. Import a repo/PR and configure a provider key via the DevDigest settings UI (writes `~/.devdigest/secrets.json`) if you want a real review.
2. Run the server standalone: `cd server && pnpm mcp` (starts `tsx src/mcp.ts`, stdio).
3. Point Claude Code/Desktop at it — `.mcp.json` (or `claude_desktop_config.json`):
   - `command: "tsx"`, `args: ["<abs>/dev-digest/server/src/mcp.ts"]`, `cwd: "<abs>/dev-digest/server"`, `env: { "DATABASE_URL": "postgres://devdigest:devdigest@localhost:5432/devdigest" }`.
4. Smoke: `list_agents` (get a valid `agent` id) → `run_agent_on_pr {repo:"owner/name", pr:N, agent:"<id>"}` → if it returns `running`, `get_findings {run_id:"<id>"}`. `get_conventions {repo}` and `get_blast_radius {repo, pr}` work without keys (the latter returns the homework stub).

---

## Anchor corrections vs. the brief (verified against code)

- **`list_agents`**: use `AgentsService.list` (`agents/service.ts:58`, returns `Agent[]` via `toAgentDto`), **not** `container.agentsRepo.list` (`agents/repository.ts:55`, returns raw `AgentRow[]` without `version`/`skills_count`).
- **PR resolution**: the `pulls` module has **no** `repository.ts` (queries are inline in `pulls/routes.ts`); there is no by-number lookup. New `getPullByNumber` goes in `reviews/repository/pull.repo.ts` (+ `ReviewRepository`), backed by unique index `pr_repo_number_uq` (`db/schema/pulls.ts`). Repo-slug→repoId uses the existing `RepoRepository.findByFullName` (`repos/repository.ts:24`).
- **`reviewByRunId`**: confirmed absent; `reviews.runId` (`db/schema/reviews.ts:19`) is a **nullable uuid with no FK**. New read added.
- **Run status source**: `listRunsForPull` (`run.repo.ts:40`) already returns `status` in `RunSummary` — poll it; no new status read required. Status values `running|done|failed|cancelled` (`runs.ts:28`).
- **Shared contracts**: recommend **zero** `vendor/shared` edits — keep MCP envelopes transport-local (precedent `modules/_shared/schemas.ts`), overriding the brief's `contracts/mcp.ts` fallback and its dual-vendored hazard.
- **`bin`**: recommend **not** adding one (no `dist` build pipeline for a second entry; launch via `tsx`).
- **Auth**: `container.auth.currentWorkspace(undefined)` — port signature is `currentWorkspace(req: unknown)` (`adapters.ts:280`); local impl ignores it (`auth/local.ts:28`).
