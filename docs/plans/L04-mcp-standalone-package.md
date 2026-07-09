# Plan: extract MCP into a `@devdigest/mcp-server` package

## Context

Right now the MCP server lives inside `server/` (`server/src/mcp/**` + `server/src/mcp.ts`) as a **third entrypoint**: it stands up its own `Container` + Postgres connection and calls internal application services directly (`AgentsService`, `ReviewService`, `ConventionsService`). This is the deepest possible level of coupling to `server/` — it can't be made a "separate" package without breaking this dependency.

The goal is to extract MCP into a self-contained top-level package `mcp-server/` (`@devdigest/mcp-server`, alongside `server/`, `client/`, `reviewer-core/`, `e2e/`), modeled on the reference implementation `github.com/burnjohn/dev-digest@lesson-4-lab/mcp-finish`. The chosen approach (agreed with the user) is a **thin HTTP client**: each of the 5 tools calls the already-running Fastify API at `http://localhost:3001` instead of the DB. The package pulls in only `@modelcontextprotocol/sdk` + `zod`; `@devdigest/shared` is consumed via a tsconfig `paths` alias straight from `../server/src/vendor/shared` (no third copy of the vendored contract, the same way `reviewer-core` already reads shared).

## Architecture

**"Tool → REST endpoint" map:**

| Tool | New REST call | Resolve |
|---|---|---|
| `list_agents` | `GET /agents` → `Agent[]` | — |
| `run_agent_on_pr` | `POST /pulls/:id/review {agentId}` → poll `GET /pulls/:id/runs` → done: `GET /runs/:id/review` (**E3**) | E1+E2 |
| `get_findings` | run_id: `GET /runs/:id/review` (**E3**); repo+pr: `GET /pulls/:id/reviews` | E1+E2 |
| `get_conventions` | `GET /repos/:repoId/conventions?status=accepted` | E1 |
| `get_blast_radius` | `GET /pulls/:id/blast` → `BlastRadius` (already mapped server-side) | E1+E2 |

**Three new cheap server bridge routes** (DB-read, no GitHub sync, no LLM; shared contracts are NOT changed — all return a trivial `{id}` or the existing `ReviewDto`):
- **E1** `GET /repos/resolve?slug=owner/name` (`repos` module) → `RepoRepository.findByFullName` → `{id}` / 404.
- **E2** `GET /repos/:id/pulls/resolve?number=N` (`pulls` module) → direct read of `t.pullRequests` by `workspaceId+repoId+number` → `{id}` / 404.
- **E3** `GET /runs/:id/review` (`reviews` module, alongside `/runs/:id/trace`) → existing `reviewRepo.reviewByRunId` → `reviewToDto` → `ReviewDto` / 404. Serves both the done branch of `run_agent_on_pr` and the run_id branch of `get_findings`.

**`mcp-server/` package layout:**
```
mcp-server/
├── package.json      # deps: sdk+zod; dev: tsx/typescript/@types/node/vitest; scripts start/typecheck/test
├── tsconfig.json     # copy of reviewer-core/tsconfig.json; paths @devdigest/shared → ../server/src/vendor/shared/index.ts
├── .env.example      # DEVDIGEST_API_URL=http://localhost:3001, MAX_WAIT_MS=60000
├── .gitignore
└── src/
    ├── index.ts      # stdio entrypoint (port of server/src/mcp.ts, WITHOUT createDb/Container)
    ├── config.ts     # DEVDIGEST_API_URL, MAX_WAIT_MS, POLL_INTERVAL_MS
    ├── log.ts        # console.error ONLY (stdout belongs to JSON-RPC)
    ├── http/client.ts# fetch wrapper + ApiError{status,url,message}
    ├── schemas.ts    # transport-local input/output schemas (carried over as-is)
    ├── mappers.ts    # toConcise/toDetailed/toFinding + paginateFindings (simplified: input is always a snake_case DTO)
    ├── resolve.ts    # REPO_SLUG_RE locally + E1/E2 via http/client → union {ok:false,reason}
    ├── server.ts     # buildMcpServer(client) — transport-agnostic
    └── tools/{list-agents,run-agent-on-pr,get-findings,get-conventions,get-blast-radius}.ts
```

**Key decisions for the move:**
- Mappers get simpler: the `FindingRow`/`isDbFindingRow`/`findingRowToDto`/`normalize` branch is dropped (HTTP always returns a ready-made `Finding`); the `paginateFindings` algorithm (sort CRITICAL→WARNING→SUGGESTION, 25000 char budget, ≥1 per page) is kept verbatim. `blastResultToContract`/`emptyBlastRadius` stay in `server/src/modules/blast/contract.ts`.
- `resolve.ts` keeps `REPO_SLUG_RE` for local bad-slug validation; the same discriminated union `{ok:false, reason:'bad_slug'|'not_found'}`.
- `run_agent_on_pr` reproduces the bounded poll on the client side (`GET /pulls/:id/runs` every `POLL_INTERVAL_MS` up to `MAX_WAIT_MS`); done→E3 concise, failed/cancelled→errorResult, timeout→`RunResult.parse({status:'running'})`.
- Tool names have NO prefix (`list_agents`, …), the same `inputSchema`/`outputSchema`/annotations and "error leads onward" messages.
- stdout invariant: no `console.log` anywhere in the package's path.

**Cleanup on the server side:** delete `server/src/mcp/**`, `server/src/mcp.ts`, `server/test/{mcp-schemas,mcp-mappers,mcp}.{test,it.test}.ts`; remove the `"mcp"` script and the `@modelcontextprotocol/sdk` dep from `server/package.json` (grep confirmed: the sdk isn't used outside `mcp`).

**`.mcp.json`:** switch the launch command from `pnpm --dir server mcp` to the new package (`pnpm --dir mcp-server start`), and add the precondition "bring the API up first via `./scripts/dev.sh`."

## Decomposition (parallel tasks, disjoint file ownership)

| Task | Description | Files owned | Batch |
|---|---|---|---|
| **A** | Scaffold the package (package.json, tsconfig, .env.example, .gitignore) | `mcp-server/{package.json,tsconfig.json,.env.example,.gitignore}` | — |
| **B** | config + log + http/client | `mcp-server/src/{config,log}.ts`, `mcp-server/src/http/client.ts` | mcp-core (after A) |
| **C** | Schemas (carried over as-is) | `mcp-server/src/schemas.ts` | mcp-core |
| **D** | Mappers (carried over + simplified) | `mcp-server/src/mappers.ts` | mcp-core |
| **E** | resolve + 5 tools + server + index | `mcp-server/src/{resolve,server,index}.ts`, `mcp-server/src/tools/*.ts` | after A,B,C,D |
| **F** | Package tests (schemas, mappers, tools with mock http) | `mcp-server/test/*.test.ts` | after A,C,D,E |
| **I** | E1 resolve repo | `server/src/modules/repos/{routes,service}.ts` | server-endpoints |
| **J** | E2 resolve pr# | `server/src/modules/pulls/routes.ts` | server-endpoints |
| **K** | E3 review-by-run | `server/src/modules/reviews/routes.ts` | server-endpoints |
| **L** | Remove MCP from server (+package.json) | `server/src/mcp*`, `server/test/mcp*`, `server/package.json` | separate |
| **O** | IT for E1/E2/E3 | `server/test/mcp-http-endpoints.it.test.ts` | after I,J,K |
| **N** | Update `.mcp.json` | `.mcp.json` | after A |

Skills: server tasks (I/J/K/O) — `onion-architecture` + `fastify-best-practices` + `zod`; client-side tasks — `typescript-expert`, `zod`, `security` (for http/client + resolve). Several implementer agents will work on the shared tree — file ownership stays disjoint (root `INSIGHTS.md:27`). L is deliberately kept separate from I/J/K so additions and removals aren't mixed. This plan will also be saved to `docs/plans/` before execution (repo convention).

## Risks

- **Resolving `paths` upward in the tree to `../server/src/vendor/shared`** — mirrors the already-proven `reviewer-core/tsconfig.json` (the same alias, one level deeper).
- **Route collision `/repos/resolve` vs `/repos/:id/pulls`** — the static segment wins; covered by boot-smoke + IT.
- **Losing the run_id→review linkage** — E3 is a mandatory task, covered by O; the done branch of `run_agent_on_pr` also goes through E3.
- **Stdout pollution from logging breaks JSON-RPC** — `log.ts` is stderr-only, called out in acceptance criteria.
- **Grounding gate** — no risk here: the review runs in `server` (`POST /pulls/:id/review`), `groundFindings()` isn't bypassed.

## Verification

- `cd mcp-server && pnpm typecheck && pnpm test` — green (hermetic vitest: schemas, mappers, tools with mock `http/client`).
- `cd server && pnpm typecheck` — green after removing MCP and dropping the sdk.
- `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — green (no more old mcp-unit tests).
- `cd server && pnpm exec vitest run .it.test` — green, including the new `mcp-http-endpoints.it.test.ts` (E1/E2/E3 + 404).
- `rg modelcontextprotocol server/src` — empty; `server/package.json` has no `mcp` script and no sdk.
- **Manual E2E smoke:** `./scripts/dev.sh` (bring up the API) → `pnpm --dir mcp-server start` → verify via MCP Inspector (`pnpm --dir mcp-server inspect`) or from Claude Code that all 5 tools work and stdout carries only JSON-RPC (diagnostics go to stderr).
- `client` is not changed; the vendored shared contract (server↔client) hasn't drifted.
