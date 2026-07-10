# Implementation Plan — Onboarding Generator

Spec: `specs/2026-07-10-onboarding-generator.md` (Spec ID `SPEC-2026-07-10-onboarding-generator`, AC-1..AC-23)
Plan status: staff-engineer reviewed (Fable 5 cross-model — APPROVE-WITH-CHANGES). 4 blocking wave-boundary gaps resolved inline (see §13); R3/R4/R5 adopted, R2 deferred. Ready for implementation.

## 1. Overview

Onboarding Generator turns the facts DevDigest already indexes (`repoIntel` facade —
repo map, PageRank file rank, critical paths, per-file facts) into a persisted, repo-scoped
"Onboarding for `<repo>`" tour of exactly five ordered sections. A deterministic analyzer
gathers facts and computes first-task candidates + complexity badges; **one** `temperature:0`
structured LLM call writes the narrative; a missing/degraded index or a failed call yields a
deterministic skeleton + an honest reason-coded badge (no model call). The wiring pattern
already exists in `server/src/modules/conventions/` (scan → gather facts → structured call →
persist → SSE progress); this plan copies that shape into a **net-new `modules/onboarding/`**
module, extends the pre-existing `onboarding` persistence table with freshness metadata,
adds a **dual-vendored** response wrapper, and builds the repo-scoped tour UI.

The plan is **4 tasks in 2 waves**, package-split: a shared-surface first wave (contract +
DB + migration + fixture fallout as one inline task; prompt reconciliation as one independent
task), then two disjoint package tasks (all-server, all-client) in parallel.

Requirement ids are the spec's own `AC-1..AC-23`, reused verbatim.

## 2. Requirements (as given)

| ID | Requirement (abbreviated — see spec for full EARS text) | Source |
|----|----------------------------------------------------------|--------|
| AC-1 | Full index ⇒ exactly 5 sections `architecture, critical_paths, run_locally, reading_path, first_tasks` in that order, each non-empty title+body | `specs/2026-07-10-onboarding-generator.md:120` |
| AC-2 | Restrict `kind` to the fixed vocabulary; drop unknown kinds; never reorder the five | `…:126` |
| AC-3 | `architecture` carries a valid mermaid `diagram`; every other section's `diagram` is null | `…:130` |
| AC-4 | `critical_paths` links carry `{label,path}` resolving to real repo paths + one-line caption; invented paths dropped | `…:134` |
| AC-5 | `run_locally` body renders an ordered list of individually copyable shell commands | `…:139` |
| AC-6 | `reading_path` files ordered by descending file rank (PageRank via `getTopFilesByRank`), each with a rationale | `…:143` |
| AC-7 | `first_tasks` candidates grounded ONLY in code-computed facts: untested source files + TODO/FIXME markers | `…:149` |
| AC-8 | Complexity badge `Low/Medium/High` derived from a deterministic size + fan-out heuristic, not the model | `…:154` |
| AC-9 | Full generation ⇒ exactly one `completeStructured` call, `temperature:0`, model via `resolveFeatureModel(…,'onboarding')` | `…:162` |
| AC-10 | Record `costUsd`, token counts, model to trace/logs; never surface cost in the UI | `…:166` |
| AC-11 | Model failure OR missing/partial/degraded/failed index ⇒ deterministic skeleton + degraded badge, NO model call, HTTP 200, never empty/blocking | `…:169` |
| AC-12 | Degraded/stale state conveyed via a closed reason-code set (`flag_off, index_failed, index_partial, repo_too_large, no_data`); client maps to i18n | `…:175` |
| AC-13 | Persist artifact keyed by repo + the indexed commit SHA it was generated against | `…:183` |
| AC-14 | Stored SHA == current indexed SHA ⇒ `fresh`; indexed SHA advanced ⇒ `stale` while still rendering stored sections | `…:186` |
| AC-15 | Regenerate ⇒ one fresh structured generation against current indexed SHA, replaces stored artifact | `…:191` |
| AC-16 | Never auto-trigger indexing on open; opening an un-indexed repo starts no index job | `…:194` |
| AC-17 | Page shows title `Onboarding for <repo>`, subtitle (indexed file count + last-refreshed), Regenerate control, 5-section anchor nav | `…:200` |
| AC-18 | During generation: non-dismissible SSE-streamed progress (conventions run-progress pattern, scan id = SSE run id); Regenerate disabled until resolved | `…:205` |
| AC-19 | Served at a repo-scoped route distinct from the existing `/onboarding` add-repo screen; reachable from sidebar as "Onboarding Tour" | `…:209` |
| AC-20 | Any Share-link affordance is non-functional in v1 (disabled/omitted); no unauthenticated/cross-workspace endpoint exposed | `…:213` |
| AC-21 | Repo-derived facts wrapped `<untrusted>` + injection guard kept; repo content cannot act as instructions | `…:219` |
| AC-22 | Routes resolve caller workspace via auth context; scope every repo/artifact query by `workspaceId`; cross-workspace repo ⇒ 404 | `…:225` |
| AC-23 | Generate route carries a per-route rate limit at least as tight as the 120/min global default | `…:229` |

## 3. Requirements Review

Audit against complete / consistent / unambiguous / testable. Overall the spec is unusually
complete and traceable (it ships its own §Traceability + §Workflow matrices). Issues found are
all **non-blocking** and each has a stated planning assumption in §4.

- **AC-1, AC-2, AC-5, AC-9, AC-10, AC-16, AC-17, AC-19, AC-20, AC-21, AC-23** — complete,
  consistent, unambiguous, testable. No issues.
- **AC-3** — testable but the "invalid mermaid is dropped, prose kept" behavior lives in the
  prompt/normalizer, not the AC body; the spec's Edge-cases section (`…:254`) makes it explicit
  ("accepted: drop invalid diagram, keep prose"). Fold that rule into the normalizer acceptance
  (Task S2). No issue beyond that cross-reference.
- **AC-4** — testable, but "path present in the repo tree" presumes the server can enumerate the
  repo's real path set. No facade method returns the full file list today (confirmed:
  `repoIntel` exposes `getTopFilesByRank(n)` / `getFileRank(paths)` but no "all paths"). →
  completeness gap → **Q3** (non-blocking): extend the facade / read the index file set.
- **AC-6** — testable and deterministic; `getTopFilesByRank` (`repo-intel/types.ts:165`) returns
  rank-ordered paths, and `hotness=0 ⇒ rank=pagerank` is confirmed (`repo-intel.ts:95-98`,
  `pipeline/rank.ts:4-7,51`). No issue.
- **AC-7, AC-8** — deterministic and testable, but grounded in scans that do not exist yet
  (untested-file, TODO/FIXME, fan-out). Confirmed absent in repo-intel. Net-new analyzer;
  the scan's file scope/cost is unspecified → **Q3/Q4** (non-blocking).
- **AC-11** — testable, but the mapping from index state → reason code is implied, not spelled
  out. Planning assumption (stated in the review, applied in S2): `flag_off` when
  `REPO_INTEL_ENABLED` is off; `no_data` when no clone/index exists; `index_partial` when
  `IndexStatus='partial'`; `index_failed` when `IndexStatus='failed'` or the model call throws;
  `repo_too_large` when the index recorded that reason. This is derived from the existing
  `DegradedReason` vocabulary (`repo-intel/types.ts:27-32`), not invented.
- **AC-12** — consistent hazard: the reason-code set is defined **server-only** as a TS union
  (`repo-intel/types.ts:27-32`), NOT in `vendor/shared`, so the client cannot import it. The plan
  adds an `OnboardingDegradedReason` Zod enum to the dual-vendored contract (Task S1) so the wire
  field is typed and the client mapping is exhaustive. Not a spec defect — a plan action.
- **AC-13, AC-14, AC-15** — testable, but "keyed by repo + indexed SHA" is ambiguous between a
  composite primary key `(repoId, sha)` (history table) and one-artifact-per-repo with the SHA
  stored as a column for staleness comparison. The existing `onboarding` table
  (`context.ts:120-125`) is PK `repoId` only. → **Q1** (non-blocking): proceed with extend-in-place
  (PK `repoId`, SHA as column, last-write-wins), which satisfies all three ACs and the
  "last-write-wins, all-or-nothing" edge case (`…:250`).
- **AC-18** — testable for an in-session generation; it does not specify reload-mid-generation
  behavior. The known SSE landmine (`client/INSIGHTS.md:92-93`, `activeScanId` lost on reload)
  makes reload-recovery worth doing but it is outside AC-18's observable. → **Q5** (non-blocking) +
  **R4**.
- **AC-22** — testable; the existing `onboarding` table has no `workspaceId` column. Scoping is
  enforceable via the repo lookup (resolve repo within workspace → 404), matching the conventions
  pattern. → **Q2** (non-blocking) + **R2** (add the column for defense-in-depth).

No contradiction with any `INSIGHTS.md` landmine or architectural rule was found. No blocking
ambiguity — the architecture and file ownership are unaffected by any open question.

## 4. Open Questions

All non-blocking; the plan proceeds on the stated assumption for each.

1. **[non-blocking] Persistence shape.** Extend the existing `onboarding` table
   (`server/src/db/schema/context.ts:120-125`, PK `repoId`) in place vs. create a new
   composite-`(repoId, sha)` table like `repoMapCache` (`repo-intel.ts:129-144`)?
   **Assumption:** extend in place — PK stays `repoId` (one artifact per repo, Regenerate replaces
   it, last-write-wins), add `indexed_sha`, `files_indexed`, `status`, `degraded`,
   `degraded_reason`, `model`, `cost_usd` columns; the stored `indexed_sha` is compared against
   `getIndexState(repoId).lastIndexedSha` for fresh/stale (AC-14). Satisfies AC-13/14/15 and reuses
   the scaffold table. History/audit of past artifacts is a non-goal.
2. **[non-blocking] Workspace column.** The `onboarding` table lacks `workspaceId`.
   **Assumption:** enforce AC-22 by resolving the repo within the caller's workspace via the
   workspace-scoped repo repository **before** any artifact query, returning 404 when the repo is
   not in the caller's workspace (mirrors `conventions` + the blast service `NotFoundError` pattern,
   `server/INSIGHTS.md:207`). Adding a `workspace_id` column is recommended for defense-in-depth
   (**R2**) and folded into Task S1 if adopted.
3. **[non-blocking] Analyzer data access.** No facade method exposes the full file list, per-file
   fan-out, or file sizes today (confirmed absent in repo-intel). **Assumption:** extend the
   `repoIntel` facade (`repo-intel/types.ts` + `service.ts` + `repository.ts`) with the minimal read
   methods the analyzer needs — a source-file list (from the existing `file_rank` rows, one per
   indexed file) and per-file fan-in/fan-out counts (from the existing `file_edges` table +
   `file_edges_repo_to_idx` reverse index, via `repository.getEdges`, `repo-intel/repository.ts:432`)
   — and read file bodies + sizes through the injected `GitClient` for the TODO/FIXME + untested
   scan. The pure analyzer stays hermetic (inputs in, candidates+badges out). Exact method names are
   an implementation detail bounded by AC-7/AC-8; these facade files are owned by Task S2.
4. **[non-blocking] Scan scope/cost.** The spec does not cap how many files the TODO/FIXME +
   untested scan reads. **Assumption:** bound the scan to the indexed source-file set (honoring the
   existing walk ignore rules, `pipeline/walk.ts`) with a sane file cap in `onboarding/constants.ts`;
   AC-7 grounding holds regardless of the cap. Reading bodies goes through `GitClient.readFileSafe`
   (respecting the sandbox), never a caller-supplied path.
5. **[non-blocking] SSE reload-recovery.** AC-18's observable covers in-session progress only.
   **Assumption:** implement in-session SSE (POST generate returns `scanId`; client subscribes to
   `/runs/:scanId/events`). Re-seeding `activeScanId` after a mid-generation reload
   (`client/INSIGHTS.md:92-93`) is deferred to **R4**; if adopted it adds an optional in-flight
   indicator to the GET response (a Task-S1 contract addition) and a `useEffect` re-seed in Task C1.
6. **[non-blocking] `activeKeyFor` collision.** `client/src/components/app-shell/helpers.ts:29`
   already contains `if (pathname.includes("/onboarding")) return "onboarding-tour";`, a dead
   mapping that will match BOTH the new `/repos/:repoId/onboarding` route AND the existing unrelated
   `/onboarding` add-repo screen once a NAV entry exists. **Assumption:** Task C1 tightens this
   predicate to scope it to the repo route (e.g. require a `/repos/` segment) so the add-repo screen
   keeps its own highlight (AC-19). Task C1 owns `helpers.ts`.

## 5. Recommendations

- **R1 — Extend the existing `onboarding` table (adopted as the plan's default).** Reuses the
  scaffold (`context.ts:120-125`), one row per repo, simplest reads. Cost: an ALTER migration on a
  currently-empty table (no backfill). Alternative (composite-`(repoId,sha)` history table) is not
  assumed; it adds "latest for repo" read complexity for a non-goal.
- **R2 — Add `workspace_id` to the onboarding artifact table** for defense-in-depth and parity
  with `conventions` (every query workspace-scoped). Better: a second guard behind the repo lookup.
  Cost: one column + one index in the Task-S1 migration. **Not** assumed by the emitted plan (which
  scopes via the repo lookup per Q2); flagged for the reviewer to green-light.
- **R3 — Promote a shared `CopyButton` primitive** to `client/src/vendor/ui/`. The copy affordance
  is duplicated inline in ≥3 places today (`LiveLogStream.tsx:36-43`, `PromptBlock.tsx:41-49`,
  `ConventionCard.tsx:156-160`) and AC-5 adds a 4th. Cost: touches a shared UI file (widens C1's
  blast radius by one file). The emitted plan keeps the copy affordance **inline** in the C1
  run-locally renderer unless R3 is adopted.
- **R4 — Reload-recovery for in-flight generation** (`client/INSIGHTS.md:92-93`). Harden AC-18
  beyond its observable by exposing an in-flight `activeScanId`/`generating` indicator on the GET
  response and re-seeding client SSE state on reload. Cost: one optional contract field (S1) + a
  `useEffect` (C1). Not assumed; recommended.
- **R5 — Treat the `repoIntel` facade as the clean seam** for analyzer data (Q3) rather than
  reaching into repo-intel's private repository/pipeline from the onboarding module (onion
  boundary). Already assumed in the plan; called out so the reviewer confirms the facade widening.

## 6. Relevant Insights (top-3, with anchors)

1. **A newly-required contract field breaks producers + typed literals even with `.default()`, and
   the fallout exceeds any named task** — `INSIGHTS.md:166`. Paired with the proven fleet shape
   "orchestrator does the dual-vendored contract edit + DB schema + ALL fixture fallout INLINE, then
   fans out disjoint module work" — `INSIGHTS.md:170`. → **Shapes the whole decomposition:** Task S1
   is a single inline shared-surface task; its acceptance is "grep every `z.infer<Onboarding*>` /
   `Onboarding.parse(` construction in **both** packages," not just the one fixture we already know
   about (`server/test/contracts.test.ts:131-134`).
2. **Two un-synced client registries make a new page unreachable from its own `page.tsx`** —
   `client/INSIGHTS.md:159-163`. The sidebar is a data registry (`vendor/ui/nav.ts`) and the
   active-highlight is a **separate** hardcoded map (`components/app-shell/helpers.ts`
   `activeKeyFor`). → **Task C1 must own `nav.ts` AND `helpers.ts`**, not just the page — and must fix
   the pre-existing `/onboarding` substring collision (Q6).
3. **SSE `activeScanId` is ephemeral React state, lost on reload while a job runs** —
   `client/INSIGHTS.md:92-93`. The fix is re-seeding from a server-persisted "running" status. →
   Shapes Task C1's SSE wiring (and **R4**); `ConventionsListView.tsx:50-56` is the working
   re-seed template.

Honorable mentions folded into task acceptance: cross-workspace-404 it-tests need a **separate
seeded workspace row**, not a request header (`server/INSIGHTS.md:52`); the `MISSING_MESSAGE` guard
for a dynamic `t(\`prefix.${code}\`)` uses a `Set.has()` + raw-string fallback
(`client/INSIGHTS.md:129`, precedent `BlastRadiusCard.tsx:26-28`); DB-backed server tests MUST end
`.it.test.ts` or the CI split misses them (`server/AGENTS.md:35`); whole-project `pnpm typecheck`
shows sibling-in-progress noise during parallel work — grep tsc output for your own file
(`server/INSIGHTS.md:44`).

## 7. Architecture Changes

Design follows `onion-architecture`: transport (`routes.ts`) maps HTTP↔service with zero business
logic; the service (application layer) orchestrates; a pure analyzer + normalizer (domain-ish, no
I/O) hold the deterministic rules; every external dependency (`repoIntel`, `llm`, `git`, `jobs`,
`runBus`, `db`) is reached through the DI container. The single Zod contract lives in
`@devdigest/shared`.

### `@devdigest/shared` (dual-vendored — Task S1)
- **`server/src/vendor/shared/contracts/knowledge.ts`** and byte-identical
  **`client/src/vendor/shared/contracts/knowledge.ts`** (both `:28-47` region): keep
  `Onboarding`/`OnboardingSection`/`OnboardingLink` unchanged; **add** an
  `OnboardingDegradedReason` Zod enum (`flag_off, index_failed, index_partial, repo_too_large,
  no_data`, AC-12) and an `OnboardingResponse` wrapper:
  `{ sections: OnboardingSection[]; status: 'fresh'|'stale'; degraded: boolean;
  degradedReason?: OnboardingDegradedReason; indexedSha: string; filesIndexed: number;
  generatedAt: string; generating?: boolean }` (per spec §Contracts, `…:402-406`; `generating?`
  is the R4 in-flight flag, §13). **GET returns `OnboardingResponse | null`** — `null` when no
  artifact has ever been generated (the repo's established lazily-computed pattern,
  `usePrIntent → PrIntentRecord | null`, `client/INSIGHTS.md:21`); the wrapper's required fields
  apply only when an artifact exists, so "never generated" is representable without optionalizing
  them (Gap 2, §13). New required fields — expect `tsc`/`.parse()` fallout (only
  `server/test/contracts.test.ts:131-134` today; verify by grep).
- Mirror verification (Gap 1, §13): the two `knowledge.ts` copies are **already non-identical**
  today (pre-existing Agents-section drift — `git hash-object` differs), so do NOT assert
  whole-file byte-identity. Verify only that the ADDED Onboarding region
  (`OnboardingDegradedReason` + `OnboardingResponse`) is byte-identical between the two copies
  (compare added lines only, diff-scoped per `INSIGHTS.md:146`); leave the unrelated Agents drift
  untouched — syncing it is out of this feature's scope.

### server (Task S1: schema/migration; Task S2: module)
- **`server/src/db/schema/context.ts:120-125`** — extend the `onboarding` pgTable with
  `indexed_sha`, `files_indexed`, `status`, `degraded`, `degraded_reason`, `model`, `cost_usd`
  (nullable) columns (Q1). Barrel `server/src/db/schema.ts:1-27,41-92` already wires the table; only
  new columns, no new export needed.
- **`server/src/db/migrations/0014_*.sql` + `meta/_journal.json` + snapshot** — generated via
  `pnpm db:generate`, reviewed, applied via `pnpm db:migrate` (custom runner
  `server/src/db/migrate.ts:19-34`, NOT `drizzle-kit migrate`). Do not hand-edit generated SQL;
  rollback is rm-sql + rm-snapshot + drop-journal-entry + regenerate (`server/INSIGHTS.md:94-101`).
- **`server/src/prompts/onboarding.system.md`** (Task P0) — reconcile DOWN to the 5 kinds: remove
  the `routes_and_apis` formatting bullet (`:23-26`) and strip `routes_and_apis` from the
  diagram-eligibility line (`:7`); keep the `architecture`-only mermaid rule (`:27`) and the
  `<untrusted>` / grounding / injection guard verbatim (AC-3, AC-21).
- **`server/src/modules/onboarding/`** (Task S2, net-new, conventions shape):
  `routes.ts` (POST generate + GET read, both workspace-scoped via
  `getContext(app.container, req)` `_shared/context.ts:14`; generate carries a `rateLimit` override
  AC-23; registers the generation job handler at plugin load like
  `conventions/routes.ts:48`), `service.ts` (orchestration: gather facts, run analyzer, single
  `completeStructured` call, normalize, persist, record cost, serve fresh/stale/degraded; enqueue via
  `container.jobs.enqueue`, publish progress via `container.runBus`), `repository.ts`
  (`new OnboardingRepository(container.db)` inline, sole DB access, workspace/repo-scoped),
  `analyzer.ts` (pure: first-task candidates + complexity badges), `normalize.ts` (pure: 5-kind
  normalization, drop invalid links/diagrams), `constants.ts` (job kind, test-file globs, scan cap,
  badge thresholds, rate-limit numbers).
- **`server/src/modules/index.ts:11,38`** (Task S2) — one import + one registry entry (comment at
  `:24-26` already anticipates an onboarding module).
- **`server/src/modules/repo-intel/{types.ts,service.ts,repository.ts}`** (Task S2, Q3) — add the
  minimal facade read methods the analyzer needs (source-file list; fan-in/out counts). Server-only,
  not a shared-contract change.
- **Reused unchanged:** `resolveFeatureModel(container, workspaceId, 'onboarding')`
  (`modules/settings/feature-models.ts:51`; `'onboarding'` already registered
  `vendor/shared/contracts/platform.ts:14,44-50`); `container.llm(provider).completeStructured`
  (`vendor/shared/adapters.ts:55-88`, temp 0, schema=OnboardingResponse-sections); prompt loader
  `loadPromptTemplate`/`renderTemplate` (`platform/prompts.ts:24-41`); the SSE route
  `GET /runs/:id/events` (`reviews/routes.ts:63`) and `runBus` (`platform/sse.ts:103`).

### client (Task C1)
- **`client/src/app/repos/[repoId]/onboarding/page.tsx`** (new) — thin, `useParams<{repoId}>()`,
  renders the view (sibling to `context/page.tsx:8-11`).
- **`client/src/app/repos/[repoId]/onboarding/_components/**`** (new) — `OnboardingView` +
  header (title/subtitle/Regenerate/anchor nav, AC-17) + 5 section renderers (run-locally copyable
  steps AC-5, complexity badges as text AC-8/a11y, critical-path Open links AC-4) + SSE progress
  (non-dismissible, AC-18) + fresh/stale/degraded badge (AC-12/14) + disabled/omitted Share (AC-20).
- **`client/src/app/repos/[repoId]/onboarding/_lib/**`** (new) — reason-code→i18n mapping with
  `Set.has()` raw-string fallback (`client/INSIGHTS.md:129`).
- **`client/src/lib/hooks/onboarding.ts`** (new) — TanStack query (GET) + generate/regenerate
  mutation (`api.post`, body `{force?}`) + `useRunEvents` wiring
  (`lib/hooks/reviews.ts:168-216`), modeled on `lib/hooks/conventions.ts`.
- **`client/src/vendor/ui/nav.ts:21-38`** (edit) — add one `WORKSPACE` NAV item
  `{ key: 'onboarding-tour', href: '/repos/:repoId/onboarding', … }`. `shell.json:19`
  (`nav.onboarding-tour`) already exists.
- **`client/src/components/app-shell/helpers.ts:26-40`** (edit) — fix the `activeKeyFor` collision
  (Q6).
- **`client/messages/en/onboarding.json`** (edit) — extend the pre-seeded namespace with subtitle,
  section titles, badge labels, degraded-reason messages, share-disabled tooltip.

### reviewer-core
- **No change.** `completeStructured` / `parseWithRepair` / `<untrusted>` are consumed as-is.

## 8. Parallelizable Tasks

Decomposed by disjoint file ownership; server and client file sets never overlap. The one
shared-contract two-file edit is isolated in Task S1 and never split. Each row is a self-contained
card. **Read §13 before executing any card** — the cross-model review amended S1/S2/C1 acceptance
(sync-vs-async locus, empty-state contract, failed-generation persistence, mermaid heuristic).

| Task | Module | Files owned (with anchors) | Skills to apply | Acceptance criteria | Tests to run | Depends-on | Batch |
|------|--------|----------------------------|-----------------|---------------------|--------------|------------|-------|
| **P0 — Prompt reconciliation** | server (prompt) | `server/src/prompts/onboarding.system.md` (edit `:7` diagram-eligibility line; delete `routes_and_apis` bullet `:23-26`; keep `architecture` mermaid `:27`; keep `<untrusted>`/grounding/injection guard verbatim) | `security` | Prompt names exactly the 5 kinds `architecture, critical_paths, run_locally, reading_path, first_tasks`; mermaid allowed ONLY for `architecture` (AC-3); no `routes_and_apis` reference remains; `{{sections}}`+`{{language}}` placeholders intact; grounding-only-from-FACTS + `<untrusted>` guard preserved unchanged (AC-21). Prep task per spec §Open-questions `:473-478`. | Prompt loads without unresolved placeholders (exercised by S2's generation it-test); no automated prompt unit test. | — | none (standalone) |
| **S1 — Contract + DB + migration + fixture fallout (shared surface, inline)** | shared + server db | `server/src/vendor/shared/contracts/knowledge.ts` (add `OnboardingDegradedReason` enum + `OnboardingResponse` wrapper after `:47`); `client/src/vendor/shared/contracts/knowledge.ts` (byte-identical mirror); `server/src/db/schema/context.ts:120-125` (extend `onboarding` table, Q1); `server/src/db/migrations/0014_*.sql` + `meta/_journal.json` + `meta/0014_snapshot.json` (via `pnpm db:generate`); `server/test/contracts.test.ts:131-134` (fixture fallout) | `zod`, `drizzle-orm-patterns`, `postgresql-table-design`, `typescript-expert` | `OnboardingResponse` wrapper matches spec §Contracts `:402-406` (status/degraded/degradedReason/indexedSha/filesIndexed/generatedAt); `OnboardingDegradedReason` enum = exactly the 5 codes (AC-12). Both vendored copies **byte-identical** (verify by blob hash, `INSIGHTS.md:66`). `onboarding` table gains `indexed_sha, files_indexed, status, degraded, degraded_reason, model, cost_usd` (AC-13/14). Migration is `0014`, generated (not hand-edited), applies cleanly on an empty table. **Every** `z.infer<Onboarding*>` construction / `Onboarding.parse(` in BOTH packages compiles/parses after the edit — grep to find them all, not only the known `contracts.test.ts` fixture (`INSIGHTS.md:166`). | Server unit lane `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (contracts.test.ts); `cd server && pnpm typecheck`; `cd client && pnpm typecheck`. Do NOT run migrations here beyond `pnpm db:generate` output review. | — | none (shared-contract; runs alone) |
| **S2 — Server onboarding module** | server (`modules/onboarding`, `modules/index`, `modules/repo-intel` facade) | `server/src/modules/onboarding/routes.ts` (new); `.../service.ts` (new); `.../repository.ts` (new); `.../analyzer.ts` (new); `.../normalize.ts` (new); `.../constants.ts` (new); colocated `.../analyzer.test.ts`, `.../normalize.test.ts`, `.../service.it.test.ts` (new); `server/src/modules/index.ts:11,38` (register); `server/src/modules/repo-intel/types.ts` + `service.ts` + `repository.ts` (add analyzer facade methods, Q3) | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security`, `typescript-expert` | Full index ⇒ exactly 5 sections in fixed order, non-empty title+body (AC-1); `normalize.ts` drops unknown/duplicate kinds and never reorders (AC-2); `architecture` keeps a non-null diagram, others forced null, invalid mermaid dropped keeping prose (AC-3); `critical_paths` links validated against the real repo path set, invented paths dropped (AC-4); `reading_path` ordered by `getTopFilesByRank` descending rank (AC-6); `first_tasks` candidates grounded ONLY in untested-source + TODO/FIXME scans, empty when none (AC-7); complexity badge from deterministic size+fan-out heuristic (AC-8); exactly one `completeStructured` call, `temperature:0`, model via `resolveFeatureModel(…,'onboarding')`, zero calls on read of a persisted artifact (AC-9); record `costUsd`+tokens+model to trace/logs (AC-10); on model failure OR missing/partial/degraded/failed index return a deterministic skeleton + reason code at HTTP 200 with zero successful structured calls, no index job started (AC-11, AC-16); reason code is one of the 5 (index-state→code mapping per §3 review) (AC-12); persist keyed by repo + indexed SHA, subsequent read returns stored artifact w/o a model call (AC-13); status `fresh` when stored SHA == `getIndexState().lastIndexedSha` else `stale`, stored sections still returned (AC-14); generate `{force:true}` runs one fresh call and replaces the artifact all-or-nothing (AC-15); repo-derived facts wrapped `<untrusted>` before the call (AC-21); routes resolve workspace via `getContext`, cross-workspace repo ⇒ 404 (AC-22); generate route carries a `config.rateLimit` override ≤120/min, 429 on exceed (AC-23); no share route exists (AC-20 server side). Progress published to `container.runBus` under the job/scan id (AC-18 server side). | Unit: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (analyzer/normalize — AC-1/2/3/4/6/7/8, deterministic only, no LLM prose assertions). Integration: `cd server && pnpm exec vitest run .it.test` (service — AC-9/10/11/12/13/14/15/16/22/23, MockLLMProvider; cross-workspace via a separate seeded workspace row `server/INSIGHTS.md:52`). `cd server && pnpm typecheck` (grep for own files, `server/INSIGHTS.md:44`). | S1, P0 | none (sole server task; runs parallel to C1) |
| **C1 — Client onboarding tour page + registries** | client (`app/repos/[repoId]/onboarding`, `lib/hooks`, `vendor/ui/nav`, `app-shell/helpers`, `messages`) | `client/src/app/repos/[repoId]/onboarding/page.tsx` (new); `.../onboarding/_components/**` (new: OnboardingView, header, 5 section renderers, progress, badge, share); `.../onboarding/_lib/**` (new: reason→i18n map); colocated `*.test.tsx` (new); `client/src/lib/hooks/onboarding.ts` (new); `client/src/vendor/ui/nav.ts:21-38` (add NAV item); `client/src/components/app-shell/helpers.ts:26-40` (fix `activeKeyFor`, Q6); `client/messages/en/onboarding.json` (extend) | `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `security`, `typescript-expert` | `run_locally` renders an ordered list with an individually-copyable, keyboard-operable command per step (AC-5); complexity badge conveyed by **text** not colour alone (AC-8/a11y); no monetary figure rendered anywhere (AC-10); degraded/stale reason mapped to an i18n string via `Set.has()` + raw-string fallback, no `MISSING_MESSAGE` (AC-12, `client/INSIGHTS.md:129`); fresh/stale badge from response `status`, stale still renders sections (AC-14); Regenerate control triggers the generate mutation with `{force:true}` (AC-15); header shows `Onboarding for <repo>`, subtitle "index of N files · refreshed X ago" (from `filesIndexed`+`generatedAt`), Regenerate, and a 5-section anchor nav reachable by keyboard (AC-17, WCAG 2.1 AA); during generation a non-dismissible SSE progress indicator renders from `useRunEvents(scanId)` and Regenerate is disabled until it resolves (AC-18); page served at `/repos/:repoId/onboarding`, sidebar NAV item `key:'onboarding-tour'` links to it, existing `/onboarding` add-repo screen unchanged, `activeKeyFor` no longer mis-highlights it (AC-19); Share control disabled or omitted, calls no endpoint (AC-20). All new strings via i18n (AC-12/i18n non-functional). | `cd client && pnpm test && pnpm typecheck` (react-testing-library component + hook tests — AC-5/8/10/12/14/17/18/19/20; assert structure/order/badges/links, NOT LLM prose). | S1 | none (sole client task; runs parallel to S2) |

Wave grouping (each task is its own spawn — no fusible batch exists, since P0 is standalone, S1 is a
shared-contract edit, and S2/C1 are different modules with distinct onboarding sets):
- **Wave 0 (parallel):** P0 ‖ S1.
- **Wave 1 (parallel, after S1; S2 also after P0):** S2 ‖ C1.

## 9. AC-N → Task coverage

| AC | Tasks | AC | Tasks |
|----|-------|----|-------|
| AC-1 | S2 (+P0 prompt) | AC-13 | S1 (schema) + S2 (write) |
| AC-2 | S2 | AC-14 | S2 + C1 (badge) |
| AC-3 | S2 (normalize) + P0 (prompt) | AC-15 | S2 + C1 (Regenerate) |
| AC-4 | S2 (path validation) | AC-16 | S2 |
| AC-5 | C1 | AC-17 | C1 |
| AC-6 | S2 | AC-18 | C1 + S2 (runBus emit) |
| AC-7 | S2 (analyzer) | AC-19 | C1 (route+nav+highlight) |
| AC-8 | S2 (analyzer) + C1 (text badge) | AC-20 | C1 (control) + S2 (no route) |
| AC-9 | S2 | AC-21 | S2 (wrap) + P0 (guard) |
| AC-10 | S2 (record) + C1 (no cost UI) | AC-22 | S2 |
| AC-11 | S2 | AC-23 | S2 |
| AC-12 | S1 (enum) + S2 (emit) + C1 (i18n map) | | |

Every AC-1..AC-23 maps to ≥1 task; every task (P0, S1, S2, C1) maps to ≥1 AC. No orphans.

## 10. Testing Strategy

Canonical per-module commands: `TESTING.md:63-74` (do not restate; each task's **Tests to run**
cell names its exact command). The planner runs none of them (Hard rule 1).

- **Deterministic-only assertions.** Per the spec's §LLM-usage mandate (`…:294-299`), tests assert
  the fixed section set + order (AC-1/2), reading-path order (AC-6), first-task target files (AC-7),
  complexity badges (AC-8), and grounded link paths (AC-4) — **never** exact `title`/`body` prose.
- **Server unit lane** (hermetic, no Docker, `--exclude '**/*.it.test.ts'`): the pure `analyzer.ts`
  and `normalize.ts` — first-task grounding, badge thresholds (increase size/fan-out ⇒ badge
  changes, AC-8), 5-kind normalization/drop/order (AC-2), diagram-null enforcement (AC-3), invalid
  link drop (AC-4).
- **Server integration lane** (`.it.test`, testcontainers Postgres — a schema change ⇒ this lane,
  not unit): persistence + freshness (AC-13/14/15), single-call + cost recording via
  MockLLMProvider (AC-9/10), degraded skeleton with the provider forced to error and with an
  un-indexed repo (AC-11/12/16), rate limit (AC-23), and cross-workspace 404 using a **separate
  seeded workspace row** (AC-22, `server/INSIGHTS.md:52`). DB-backed files MUST end `.it.test.ts`
  (`server/AGENTS.md:35`).
- **Client lane** (`pnpm test && pnpm typecheck`, react-testing-library): renderers + hook —
  copyable steps (AC-5), text badge (AC-8), no cost figure (AC-10), reason→i18n fallback (AC-12),
  fresh/stale (AC-14), header/anchor nav (AC-17), SSE progress + disabled Regenerate (AC-18),
  route/nav/highlight (AC-19), disabled Share (AC-20).
- **Whole-project typecheck** is the wave-closing responsibility; during parallel S2/C1 work each
  implementer greps `tsc` output for its own files to filter sibling-in-progress noise
  (`server/INSIGHTS.md:44`).

## 11. Risks & Mitigations

| Risk | Sev | Mitigation |
|------|-----|-----------|
| Dual-vendored contract drift (server vs client `knowledge.ts`) ⇒ runtime Zod rejection | High | Both copies owned by ONE task (S1); verify byte-identical by blob hash (`INSIGHTS.md:66`); wave gate before S2/C1 start |
| New required wrapper fields break an unowned producer at compile time | Med | S1 acceptance = grep every `Onboarding*` construction in both packages, not the one known fixture (`INSIGHTS.md:166`); real current fallout is small (feature unbuilt) but verify |
| `activeKeyFor` substring collision mis-highlights on the `/onboarding` add-repo screen | Med | C1 owns `helpers.ts` and tightens the predicate to the repo route (Q6) |
| SSE progress lost on mid-generation reload | Med | In-session SSE satisfies AC-18; R4 (re-seed from server status) recommended, deferred |
| Analyzer needs data no facade exposes (file list, fan-out, sizes) | Med | Q3: widen `repoIntel` facade minimally (built on existing `file_rank`/`file_edges`) + `GitClient` for bodies; keep analyzer pure/hermetic |
| TODO/FIXME scan reads bodies by path ⇒ sandbox-escape class (`server/INSIGHTS.md:245-249`) | Med | Read only the indexed source-file set via `GitClient.readFileSafe`; never a caller-supplied path; scope a `/security-review` on S2 |
| Injection via repo content / TODO text | Med | `<untrusted>` wrap + kept guard (AC-21, P0+S2); it-test asserts an "ignore previous instructions" fixture does not alter section set/order |
| Migration hand-edit desyncs the snapshot | Low | Use `pnpm db:generate`; rollback = rm-sql+rm-snapshot+drop-journal+regenerate (`server/INSIGHTS.md:94-101`) |
| DB-backed test mis-named ⇒ CI split skips it | Low | Service tests end `.it.test.ts` (`server/AGENTS.md:35`) |

## 12. Success Criteria

- [ ] All 23 ACs demonstrably covered by the tasks above; §9 matrix has no orphan AC or task.
- [ ] Both vendored `knowledge.ts` copies byte-identical; `OnboardingResponse` +
      `OnboardingDegradedReason` present in both; migration `0014` applies on an empty `onboarding`
      table.
- [ ] `server/src/prompts/onboarding.system.md` names exactly the 5 kinds; mermaid `architecture`
      only; `<untrusted>`/guard intact.
- [ ] `modules/onboarding/` follows the conventions shape: workspace-scoped routes, rate-limited
      generate, single `temperature:0` `completeStructured`, deterministic skeleton on the degraded
      path (zero model calls), persist-by-SHA with fresh/stale, cost recorded to trace.
- [ ] New repo-scoped `/repos/:repoId/onboarding` route reachable from the sidebar; existing
      `/onboarding` add-repo screen unchanged and correctly highlighted.
- [ ] Server unit + integration lanes green; client `pnpm test && pnpm typecheck` green;
      whole-project typecheck clean at wave close.
- [ ] No test asserts LLM `title`/`body` prose; deterministic facts only.
- [ ] `/security-review` clears S2 (untrusted wrapping, workspace scoping, file-read path safety).

## 13. Cross-model review amendments (Fable 5 staff review — APPROVE-WITH-CHANGES)

An independent cross-model review (Fable 5, staff-engineer lens) verified the plan's load-bearing
claims against the code (5/6 CONFIRMED; 1 PARTIAL — the `knowledge.ts` drift, Gap 1) and found four
wave-boundary gaps plus five nice-to-haves. All are card-level amendments (no restructuring),
applied here and folded into §5/§7. This section is authoritative where it refines a §8 card.

### Blocking fixes (applied)

- **Gap 1 — `knowledge.ts` not byte-identical today (Task S1).** The two vendored copies already
  differ (pre-existing Agents-section drift the client copy lacks). S1's "byte-identical" gate is
  amended: add the Onboarding region identically to both copies and verify ONLY that added region
  byte-for-byte (diff-scoped, `INSIGHTS.md:146`); do NOT sync the unrelated Agents drift — that is
  another change's work, out of scope here. (See §7 mirror-verification.)
- **Gap 2 — GET empty state (Task S1 contract).** `GET` returns `OnboardingResponse | null`; `null`
  = no artifact ever generated (the repo's lazily-computed `T | null` pattern, `client/INSIGHTS.md:21`).
  The wrapper's required fields apply only when an artifact exists. (See §7 contract.)
- **Gap 3 — sync-vs-async generation locus (Tasks S2 + C1).** RESOLUTION: the **degraded / missing /
  partial / degraded-index path and any model-call failure are handled SYNCHRONOUSLY on the POST**
  and return the deterministic skeleton + reason code in the HTTP 200 **response body** — no job, no
  `scanId`, no SSE on this path (this is the literal response-locus AC-11 asserts). The **full
  generation path (index present & full) ENQUEUES a job**, returns `{ scanId }` (202, conventions
  pattern), streams progress via SSE, and materializes the artifact on completion for a subsequent
  GET (AC-18). S2 owns this branch in `routes.ts`/`service.ts`; **C1 shows the SSE progress UI ONLY
  on the async full-generation path, never on the synchronous degraded response.** S2's it-tests and
  C1's component states must both follow this split.
- **Gap 4 — failed generation must not clobber a stored artifact (Task S2).** ADD to S2 acceptance:
  a failed generation (model error / repair-exhausted) persists NOTHING; a subsequent GET still
  returns the prior stored artifact (fresh or stale). Only a SUCCESSFUL generation writes — AC-13,
  all-or-nothing.

### Recommendation verdicts

- **R2 (`workspace_id` column) — DEFERRED** (reviewer-confirmed). Keep single repo-lookup scoping
  (conventions pattern, AC-22, cross-workspace-404 recipe `server/INSIGHTS.md:52`); trivial later
  ALTER if multi-tenancy ever gets real. Q2's assumption stands unchanged.
- **R4 (SSE reload-recovery) — ADOPTED** (reverses Q5's deferral). Add an OPTIONAL `generating?:
  boolean` in-flight flag to the GET wrapper (S1) + a `useEffect` re-seed of `activeScanId` on
  reload in C1 (template `ConventionsListView.tsx:52`, `client/INSIGHTS.md:92-93`). The same field
  answers the "is a generation in flight?" question behind Gaps 2/3.
- **R3 (`CopyButton` primitive) — ADOPTED (light).** C1 creates `client/src/vendor/ui/…/CopyButton`
  and uses it in the NEW run-locally renderer only; the 3 existing inline call-sites
  (`LiveLogStream.tsx`, `PromptBlock.tsx`, `ConventionCard.tsx`) are NOT retrofitted this run. C1
  owns the new primitive file (no collision — C1 owns all client files this run).
- **R5 (repoIntel facade as analyzer seam) — ADOPTED (confirmed).** The Q3 facade widening is the
  correct onion seam. New methods MUST honor the degraded contract (`repo-intel/types.ts:15-22`):
  array methods return `[]` when degraded and never throw, so the analyzer's skeleton path composes
  for free.

### Nice-to-haves (applied to the named card)

- **N1 (S2 `normalize.ts`):** mermaid-validity heuristic — keep a `diagram` only if it is non-empty,
  contains no ``` fences, and starts with a known mermaid header (`flowchart`/`graph`/
  `sequenceDiagram`), matching the prompt rules at `onboarding.system.md:29-36`; else null the
  diagram and keep prose (AC-3). NO new mermaid-parser dependency is added.
- **N2 (S2 AC-4):** validate link paths against a real git tree listing (via `GitClient`), not only
  `file_rank` — `README.md`/`docker-compose.yml` are legitimate onboarding links that may be absent
  from the indexed set. A path present in the git tree is kept even if un-indexed.
- **N3 (S2 AC-23 test):** rate-limit is disabled under `NODE_ENV=test` (`server/AGENTS.md`), so the
  it-test asserts the route's `config.rateLimit` override EXISTS (like `conventions/routes.ts:56`),
  not a live 429.
- **N4 (P0 acceptance reword):** the prompt receives section kinds via `{{sections}}` at render time,
  so P0's check is "no `routes_and_apis` reference remains anywhere in the file; mermaid eligibility
  names `architecture` only" — NOT "the prompt names the 5 kinds".
- **N5 (S2):** guard the double-POST-while-running case — a conventions-style already-running guard
  or an idempotent enqueue keyed by (repo, current indexed SHA); the spec's last-write-wins covers
  persistence, not job stampedes.
