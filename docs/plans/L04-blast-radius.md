# L04 — Blast Radius (PR impact map)

> Local-first PR impact map: **changed symbols → callers → reachable HTTP endpoints/crons**,
> read from the pre-built `repo-intel` index. No LLM at compute time.
> This is an **L04-homework**: the read-engine already exists — we wire the last mile.

## 1. Goal

Add a **Blast Radius card** to the PR **Overview** tab (right column, next to the Intent card —
NOT a separate tab) and a `GET /pulls/:id/blast` route that renders, for a PR's changed files:

1. **Changed symbols** declared in the changed files.
2. **Callers** of each changed symbol (who imports/calls it), ranked by file-rank, **capped 20 per symbol**.
3. **Impacted endpoints/crons** — HTTP routes & cron jobs declared in the files where those callers live.

Plus honest **degraded/partial index** surfacing (badge, not empty screen), and flipping the
existing MCP `get_blast_radius` stub to real.

## 2. Locked decisions (from review with owner, 2026-07-07)

| # | Decision | Choice | Consequence |
|---|---|---|---|
| D1 | Step 3 endpoint discovery | **1-hop `file_facts` of direct callers** (as the facade already does) | **No import-graph BFS / `getEdges` work.** Add disclosure "additional endpoints may exist further along the call chain". |
| D2 | Caller cap | **20 per changed symbol** + "+N more / view all" affordance | Facade caps 20 *globally* today (`service.ts:386`) — must move the cap to per-group (see Task S1). |
| D3 | AI summary paragraph | **No LLM.** Use the deterministic `summary` the mapper already builds | Zero LLM tokens, zero cost, zero new provider wiring. Can add later. |
| D4 | MCP tool scope | **Flip `get_blast_radius` stub → real**, sharing the same facade+mapper path as the HTTP route | Small extra diff; keeps HTTP and MCP behavior identical. |

### Standing disclaimers to ship in the UI (industry-grounded, see §9)
- **Partial/degraded index** → badge with reason (`flag_off`/`index_failed`/`index_partial`/`repo_too_large`/`no_data`).
- **Dynamic edges missing** → standing note that DI-wired / reflection / dynamic-dispatch callers may be absent
  (static call-graph recall is measurably <100% — this repo's DI container hides edges by design).
- **Endpoints beyond direct callers** → per D1, note the 1-hop bound honestly.

## 3. What already exists (reuse verbatim — do NOT rebuild)

- **Facade**: `repoIntel.getBlastRadius(repoId, changedFiles): Promise<BlastResult>` — `server/src/modules/repo-intel/service.ts:220`.
  Persistent path reads `symbols` / `references.decl_file` / `file_rank` / `file_facts` from Postgres (no clone parsing on the hot path).
- **Contract** (dual-vendored, no change needed): `BlastRadius` = `{ changed_symbols[], downstream[] (per-symbol groups of callers + endpoints_affected + crons_affected), summary }`
  — `server/src/vendor/shared/contracts/brief.ts:17-44` (+ mirrored client copy).
- **Mapper**: `blastResultToContract(result): BlastRadius` — `server/src/mcp/mappers.ts:138` (groups callers by `viaSymbol`, attributes endpoints via `factsByFile`, synthesizes degraded `summary`). Also `emptyBlastRadius(summary)` at `:111`.
- **Degraded model**: `getIndexState(repoId)` always returns a state; `'partial'` = working index (NOT flagged degraded); only `'degraded'|'failed'` raise the flag (`repository.ts:216`). Client subset `RepoIntelState` carries `status/degraded/degradedReason`.
- **MCP stub to flip**: `server/src/mcp/tools/get-blast-radius.ts:56-72` (`TODO(L04-homework)` block returns `emptyBlastRadius`).
- **Route template**: `GET /pulls/:id/smart-diff` — `server/src/modules/reviews/routes.ts:161-168` (uses `IdParams`, `getContext`, `response: { 200: <schema> }`).
- **Client tab wiring**: tab list in `PrDetailHeader.tsx:114-119`; `?tab=` state + body switch in `page.tsx:60,154-194`; deep-link `githubBlobUrl(repoFullName, sha, file, startLine, endLine)` in `client/src/lib/github-urls.ts:24`; degraded status hook `useRepoIntelStatus` in `client/src/lib/hooks/repo-intel.ts`. Card templates: `IntentCard`, `SmartDiffViewer`.

## 4. Contract

**No contract change required.** Reuse `BlastRadius` as the `200` response schema (already in `@devdigest/shared`,
so no dual-vendored two-file edit — see root `INSIGHTS.md:37`). Degraded state stays encoded in `summary`;
the client badge derives richer state from `useRepoIntelStatus(repoId)`.

> If, during build, per-symbol "+N more" needs an explicit overflow count in the payload, that WOULD be a
> dual-vendored contract edit — prefer a client-side derivation first (the group already carries its callers).

## 5. Per-symbol cap (D2) — the one real backend logic change

Facade currently does `callers.slice(0, MAX_CALLERS_PER_SYMBOL)` **globally** after a global rank-sort (`service.ts:386`),
so a single high-rank symbol can consume the whole budget. To get **20 per symbol** without losing data:

1. In the **facade**, raise the global truncation to a generous safety ceiling (e.g. 200) so per-symbol data survives —
   OR keep global sort but move the hard cap out. (Confirm no other consumer relies on the 20 global; only the new
   route + MCP tool consume `getBlastRadius`.)
2. Apply **cap-20-per-`viaSymbol`-group in `blastResultToContract`** (the single shared point feeding BOTH the HTTP
   route and the MCP tool → identical behavior, D4). Track dropped count per group for the UI "+N more".

Keep the change in these two shared points only; do not fork the logic per surface.

## 6. Task breakdown (waves, disjoint file ownership)

Follows this repo's wave model (`root INSIGHTS.md:27,62,68`): each task owns a disjoint file set so implementers run in parallel on the shared tree with zero collisions.

### Wave 0 — backend core (parallel)

| Task | Owns | Skills | Summary |
|---|---|---|---|
| **S1 · per-symbol cap** | `repo-intel/service.ts` (cap site), `repo-intel/constants.ts`, `mcp/mappers.ts` (`blastResultToContract`) | `onion-architecture`, `typescript-expert` | Move cap to per-`viaSymbol`-group in the mapper; relax facade global cap to a safety ceiling; expose per-group overflow count. |
| **S2 · blast module + route** | `server/src/modules/blast/routes.ts` (+ optional thin `service.ts`), `server/src/modules/index.ts` (register) | `fastify-best-practices`, `onion-architecture`, `zod` | `GET /pulls/:id/blast`: `getContext` → resolve PR + its `repoId` (`reviewRepo.getPull` + repo lookup) → `getPrFiles(id).map(f=>f.path)` → `repoIntel.getBlastRadius(repoId, paths)` → `blastResultToContract`. `response: { 200: BlastRadius }`. 404 on cross-workspace (pattern `server/INSIGHTS.md:52`). |

> Mapper (`mcp/mappers.ts`) is owned by S1 to avoid a collision with S2 (which imports it). If preferred, relocate
> `blastResultToContract` out of `mcp/` into `modules/blast/` so the HTTP route doesn't import from `mcp/` — decide in S1.

### Wave 1 — MCP flip (depends on S1)

| Task | Owns | Skills | Summary |
|---|---|---|---|
| **S3 · flip MCP stub** | `server/src/mcp/tools/get-blast-radius.ts` | (none — mechanical) | Replace the `TODO(L04-homework)` block (`:56-72`) with the real facade call + `blastResultToContract`, mirroring S2's resolution. Watch `noUncheckedIndexedAccess` (`server/INSIGHTS.md:179`). |

### Wave 1 — client (parallel with S3)

| Task | Owns | Skills | Summary |
|---|---|---|---|
| **C1 · data hook** | `client/src/lib/hooks/brief.ts` (add `useBlastRadius`) | `next-best-practices` | Mirror `useSmartDiff`: `api.get<BlastRadius>('/pulls/${prId}/blast')`. |
| **C2 · Blast Radius card** | `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/*` (`BlastRadiusCard.tsx`, `styles.ts`, `BlastRadiusCard.test.tsx`) | `react-best-practices`, `frontend-architecture`, `react-testing-library` | Compact card (NOT a tab): header + stats row (`N symbols · N callers · N endpoints · N cron`) + Tree/Graph toggle (Graph = placeholder empty-state); collapsible per-symbol tree `changed_symbols → callers (↳ file:line) → endpoint/cron badges`; click-to-code via `githubBlobUrl`; degraded badge from `useRepoIntelStatus`; "showing top 20" per symbol; standing disclaimers (§2). Screenshot's "Prior PRs touching these files" omitted — no backing data in the `BlastRadius` contract. |
| **C3 · i18n** | `client/messages/<locale>/*.json` (all locales) | — | Blast strings in every locale (missing key = build error, `client/CLAUDE.md`). |

### Wave 2 — integration (depends on C1/C2/C3)

| Task | Owns | Skills | Summary |
|---|---|---|---|
| **C4 · place card in Overview** | `OverviewTab.tsx` (2-col grid: Intent left, Blast right), `page.tsx` (pass `repoId`/`repoFullName`/`pr.head_sha` to `OverviewTab`) | `react-best-practices` | Render `BlastRadiusCard` beside `IntentCard` in a responsive two-column row; guard `prId != null` (`client/INSIGHTS.md:53`). NO new tab in `PrDetailHeader`. |

## 7. Tests

- **S1/S2**: `server/test/blast.it.test.ts` (testcontainers) — seed a repo index (symbols/references/file_rank/file_facts),
  a PR with changed files, assert the route returns grouped `downstream[]` with **≤20 callers per symbol**, endpoints attributed,
  and a **degraded fixture** (no index) returns a non-empty `summary` + empty arrays (not a 500). Mutation-test the cap and the degraded branch.
  Reuse the grounding-diff-hunk care from `server/INSIGHTS.md:50` if seeding findings.
- **S3**: extend `server/test/mcp.it.test.ts` — the tool now returns real `structuredContent` (was `emptyBlastRadius`); assert exact shape.
- **C2**: `BlastTab.test.tsx` — `vi.mock` the hook module (`client/INSIGHTS.md:97`); stub `Element.prototype.scrollIntoView` if any scroll (`client/INSIGHTS.md:39`); `fireEvent` not `user-event` (not installed, `client/INSIGHTS.md:99`); assert click-to-code href + degraded badge + "+N more".

## 8. Verify / done criteria

- `server && pnpm typecheck` clean; `client && pnpm typecheck` clean.
- `server` unit + `blast.it.test.ts` + `mcp.it.test.ts` green (mutation-verified).
- `client` unit green.
- Manual: Blast tab renders symbols→callers→endpoints, clicks open GitHub code, degraded repo shows badge (drive with `verify`/`run` skill).
- Zero edits under either `vendor/shared` tree (confirm with `git status`).

## 9. Best-practice grounding (why these choices)

- **Step 1 (parsed symbols, not text-match)**: Nx's edge over Turborepo is parsing real imports — symbol-level index is the precise direction. ✅ aligns.
- **Step 2 (file-rank ≈ centrality, cap 20)**: PageRank/centrality caller-ranking is the established technique; our `file_rank` sort is exactly that. Cap 20 sits at the low-safe end of the ~20–50 "legible single-view" graph-UX band; GitHub "Dependents" also caps-and-links. ✅ aligns; add "+N more".
- **Step 3 (1-hop, D1)**: Bazel `rdeps` treats depth as an explicit cost/noise knob with no standard default. 1-hop is a deliberate precision-over-recall trade for a fast in-review tool — **must disclose** it may miss endpoints further along `service→repo→handler` chains (mirrors Test-Impact-Analysis "disclose/fall back" honesty).
- **Partial index badge**: Sourcegraph's precise↔search-based fallback is the model, but it's *silent* — no surveyed tool surfaces explicit coverage/confidence. Our explicit badge is a **differentiator**, not a copy.
- **UX**: CodeSee Review Maps (click-to-expand, double-click→diff, progressive disclosure) is the closest transferable reference for a symbols→callers→endpoints tree in review.
- **Pitfall caveat**: static call-graph recall is measurably imperfect (~88% Java, ~70% real-world Python) via dynamic dispatch/reflection/DI, and precision gains don't improve recall — hence the standing "dynamic edges may be missing" disclaimer, distinct from the index-coverage badge.
