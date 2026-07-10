# Implementation Plan — Why+Risk Brief (PR Brief)

Spec: `specs/2026-07-10-why-risk-brief.md` (Spec ID `SPEC-2026-07-10-why-risk-brief`, AC-1..AC-20). All four spec Open Questions were RESOLVED 2026-07-10 before hand-off.
Plan status: ready for implementation. Two planning defaults confirmed by the product owner 2026-07-10 and locked in (§3 AC-3, §3 AC-5). Requirement ids are the spec's own `AC-1..AC-20`, reused verbatim.

## 1. Overview

The Why+Risk Brief ("PR Brief") fuses facts DevDigest already computes — the persisted PR
intent, the deterministic blast-radius summary, the smart-diff role/statistics, the live
linked issue, and the attached Project Context specs — into ONE persisted per-PR brief with a
plain-language `what` + `why`, an independent color-coded `risk_level`, a grounded `risks[]`
list, and a grounded `review_focus[]` "read these first" list. Facts are gathered by code; the
judgement is written by **exactly one** structured `risk_brief` model call. **The raw diff
hunks are never an input** — the brief is grounded on pre-validated structured summaries only.

Generation is **synchronous on the POST** (mirroring `POST /pulls/:id/intent`, spec Non-goal
"no streaming/SSE") — NOT a background job, NOT SSE. This is the key architectural divergence
from the L05 Onboarding Generator (which went async): there is **no** `scanId`, `runBus`, or
SSE progress here, so the L05 SSE-reload landmine does not apply. On a model-call failure the
route returns HTTP 200 with a degraded reason code (never 5xx), preserving any prior brief.

The scaffold is partial: the `pr_brief` table, the `risk_brief` feature-model key, and an
input-bundle `PrBrief` contract already exist but are **completely unwired** (zero
repository/service/route references). The brief's **output** contract is net-new and
dual-vendored; the input-bundle `PrBrief` is left untouched (spec Q1).

The plan is **3 tasks in 2 waves**, package-split: a shared-surface first wave (dual-vendored
output contract + `pr_brief` column extension + migration + fixture fallout, as one inline
task), then two disjoint package tasks (all-server, all-client) in parallel. **reviewer-core
gets zero file edits** — its structured-call adapter and `<untrusted>` mechanism are consumed
as-is (spec §Cross-module `:416-420`).

## 2. Requirements (as given)

| ID | Requirement (abbreviated — see spec for full EARS text) | Source |
|----|----------------------------------------------------------|--------|
| AC-1 | Assemble model input ONLY from persisted intent + blast summary + smart-diff stats + linked issue + attached specs; NEVER the raw diff hunks | `specs/2026-07-10-why-risk-brief.md:155` |
| AC-2 | Read intent from its persisted store; never trigger reclassification; proceed with intent absent if none | `…:162` |
| AC-3 | Inject exactly the manual-attach Project Context set of the workspace's **default review agent** (its docs ∪ its enabled skills' docs, deduped by path), read fresh, no per-PR relevance filtering | `…:167` |
| AC-4 | If the linked issue can't be resolved/fetched (no ref, offline, no token, GitHub error) omit it and still generate | `…:174` |
| AC-5 | Make exactly ONE structured model call, model via the `risk_brief` feature-model, low temperature; a cached read makes ZERO model calls | `…:184` |
| AC-6 | Record the call's cost, token counts, and model into the run trace/logs | `…:188` |
| AC-7 | Ground every `file`/`file:line`/endpoint reference in `risks[]` and `review_focus[]` against references present in the assembled inputs; drop any the inputs don't contain | `…:192` |
| AC-8 | Output field set (`what`/`why`/`risk_level`/`risks[]`/`review_focus[]`) + `risk_level` ∈ {high,medium,low} are deterministic; out-of-vocabulary `risk_level` rejected/normalized | `…:200` |
| AC-9 | A read returns `what`, `why`, `risk_level`, `risks[]` (title+explanation+severity+grounded refs), `review_focus[]` (grounded `file:line` + reason) | `…:210` |
| AC-10 | `PrBriefCard` renders a `risk_level`-colored banner, `what`/`why`, a Regenerate control, the brief call's cost/token readout, and a `file:line` "Review focus" link list | `…:218` |
| AC-11 | `risk_level` is independent — never derived from/reconciled with review score/verdict/blockers; review-derived figures shown ONLY when a completed review exists, else card still renders the brief without them | `…:224` |
| AC-12 | `risk_level` conveyed by text as well as color (not color alone) | `…:234` |
| AC-13 | On success persist keyed by PR + record the head SHA generated against; a later read returns the stored brief with no model call | `…:239` |
| AC-14 | Stored SHA == current PR head ⇒ fresh; head advanced ⇒ stale while still returning the stored brief | `…:244` |
| AC-15 | Regenerate forces a fresh single-call generation against the current head and replaces the stored brief | `…:249` |
| AC-16 | Model-call failure/timeout ⇒ no 5xx, no partial persist, preserve prior brief, return a degraded marker + closed reason code, retryable via Regenerate | `…:257` |
| AC-17 | A never-generated PR returns an explicit "not generated yet" state at HTTP 200, not an error/empty body | `…:263` |
| AC-18 | Wrap intent/issue-body/spec/blast/smart-diff-derived text as `<untrusted>` + keep the injection guard so none can act as instructions | `…:271` |
| AC-19 | Generate/read routes resolve workspace via auth context and scope every PR/brief query by workspace; cross-workspace PR ⇒ 404 | `…:279` |
| AC-20 | Generate route carries a per-route rate limit ≥ as tight as intent/review (max 10/min); the read route need not | `…:284` |

## 3. Requirements Review

Audited against complete / consistent / unambiguous / testable. The spec is unusually complete
and traceable (it ships §Traceability + two mermaid diagrams and pre-resolved all four open
questions). The two issues that touched *behaviour* were relayed to and **CONFIRMED by the
product owner 2026-07-10** (AC-3, AC-5 below) and are now locked into the plan. Every remaining
issue is non-blocking with a stated assumption in §4.

- **AC-1, AC-2, AC-4, AC-7, AC-8, AC-9, AC-10, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17,
  AC-18, AC-19, AC-20** — complete, consistent, unambiguous, testable. No issues.
- **AC-3 — completeness gap, RESOLVED.** AC-3 hinges on "the workspace's **default review
  agent**", but **no "default agent" / "primary agent" concept exists anywhere in the codebase**
  (confirmed absent in `agents/repository.ts`, `agents/service.ts`, `agents/constants.ts`).
  Review targeting is explicit only: an `agentId` (`getById`) or `all:true` →
  `agents.listEnabled(workspaceId)` (`reviews/service.ts:52-63`, `agents/repository.ts:75`).
  **RESOLVED (product owner 2026-07-10):** the brief injects the **deduped union of the attached
  Project Context docs across ALL enabled agents** (each enabled agent's own attached docs ∪ its
  enabled skills' attached docs, deduped by repo-relative path), read fresh — NOT "the first
  enabled agent". If zero enabled agents, the brief generates with no `## Project context` input,
  exactly as a review with none. Locked into §7 `assemble.ts` and S2 acceptance. **Note (flagged
  by §13 cross-model review):** the spec's own AC-3 prose
  (`specs/2026-07-10-why-risk-brief.md:167-174`) still reads "default review agent" and was not
  itself amended when the product owner resolved this on 2026-07-10 — only this plan carries the
  "union across all enabled agents" redefinition. A reader who opens the spec without this plan
  will see stale AC-3 wording. **Not fixed here** (this plan does not own spec edits); flagged so
  the spec gets a follow-up annotation/update pass reconciling AC-3 with the resolved decision.
- **AC-5 vs the §Assumptions/§Non-goals text — consistency ambiguity, RESOLVED.** AC-5 (a hard
  EARS criterion) says the model resolves via the **`risk_brief` feature-model**; the score
  Non-goal / Q3 resolution (`…:104,570`) also mentions "that [default] agent's model override".
  **RESOLVED (product owner 2026-07-10):** the brief call uses `resolveFeatureModel(container,
  workspaceId, 'risk_brief')` (`settings/feature-models.ts:51`); the spec's stray "default
  agent's model override" line is ignored for planning. Locked into §7 and S2 acceptance.
- **AC-6 — under-specified persistence locus.** The synchronous brief call creates no
  `agent_run`/`RunTrace` the way an agent review does, yet AC-6 says "record … into the run
  trace/logs". → **Q1** (non-blocking): record cost/tokens/model via the existing `RunLogger`
  (`platform/run-logger.ts:58-91`) **and** persist them on the `pr_brief` row (so the card's
  AC-10 cost readout is served from the stored record on read, with zero extra model calls).
  Bounded by AC-6's observable (a non-null cost + tokens + resolved model id in the log/record).
- **AC-7 / AC-9 — grounding granularity for `review_focus.line`.** AC-9 requires each
  `review_focus` entry to carry a real `line`, while AC-7's observable only checks that a
  surviving entry "resolves to a **file** present in the PR's changed-file set". → **Q2**
  (non-blocking): ground `review_focus` at **file** granularity (drop the entry if its `file` is
  not in the changed-file set) and keep the model-emitted `line`; ground `risks[]` references at
  file/endpoint granularity (drop refs whose file/endpoint is absent from the assembled inputs).
  This satisfies both observables. Spelled into S2 acceptance.
- **AC-17 vs `client/INSIGHTS.md:21`.** That landmine foretells this exact feature and prescribes
  a `T | null` GET. The spec instead defines `not_generated` as an explicit `status` value in the
  response wrapper. → **deliberate deviation** (see §7): the GET returns a non-null
  `BriefResponse` discriminated by `status`; "never generated" is representable via
  `status:'not_generated'`. Documented so the reviewer sees the reasoning, not an oversight.

No contradiction with any `INSIGHTS.md` landmine or architectural rule was found. No blocking
ambiguity: no open question changes the module set, the file ownership, or the sync-POST shape.

## 4. Open Questions

All non-blocking; the plan proceeds on the stated assumption for each. (The two behaviour
questions — default-agent spec set and model source — were CONFIRMED by the product owner and
are now resolved in §3, not listed here.)

1. **[non-blocking] Cost/trace recording locus (AC-6).** The synchronous brief call has no
   `agent_run`/`RunTrace`. **Assumption:** log via `RunLogger` and persist
   `model`/`cost_usd`/`tokens_in`/`tokens_out` on the `pr_brief` row; the card reads the
   persisted cost (no extra model call on read). Bounded by AC-6's observable.
2. **[non-blocking] `review_focus.line` grounding granularity (AC-7/AC-9).** **Assumption:**
   ground `review_focus` by file-in-changed-set and keep the emitted line; ground `risks[]` refs
   by file/endpoint presence. Satisfies both observables.
3. **[non-blocking] Persisted head-SHA storage (spec Assumption `:137`).** **Assumption:** add a
   `head_sha` **column** (plus cost columns) to the existing `pr_brief` table rather than burying
   the SHA inside `json` — a column makes the fresh/stale comparison (AC-14) a clean read against
   `pull.head_sha`. Alternative (field inside `json`) also satisfies AC-13/14; column chosen for
   clarity.

## 5. Recommendations

- **R1 — Rename the misnamed client hook file `client/src/lib/hooks/brief.ts`.** Despite its
  name it holds the L03 **intent/smart-diff/blast** read hooks (`usePrIntent`, `useSmartDiff`,
  `useBlastRadius`, `useRecomputeIntent`), not brief-output hooks. The emitted plan **keeps the
  file and appends** `usePrBrief`/`useGenerateBrief` to it (they are brief-adjacent and the repo
  convention is one domain file per resource) — but a future cleanup could split intent hooks
  into `hooks/intent.ts` and reserve `hooks/brief.ts` for the actual brief. Cost: touches
  `IntentCard`/`BlastRadiusCard` imports + `brief.test.tsx`. **Not adopted** (out of scope; would
  widen C1's blast radius). Flagged only.
- **R2 — Prune the stale `brief.json` input-bundle keys.** `client/messages/en/brief.json`
  currently describes the OLD input bundle (`block.intent/blast/risks/history`, `noRisks`,
  `noHistory`). C1 **extends** the namespace with new card keys and leaves the old ones (they may
  back other surfaces); a later pass could delete unused keys once confirmed dead. Cost: a grep
  across `client/src` for each old key. **Not adopted.**
- **R3 — Add a `workspace_id` column to `pr_brief`** for defense-in-depth parity with other
  tables. Better: a second guard behind the PR/repo lookup. Cost: one column + index in S1's
  migration. **Not adopted** — the emitted plan scopes via the PR lookup
  (`reviewRepo.getPull(workspaceId, prId)` → 404), matching intent/blast/smart-diff and the
  `onboarding` precedent (`server/INSIGHTS.md:264`). Flagged for the reviewer to green-light.
- **R4 — Reuse the existing `RiskSeverity` enum for `risk_level` and `BriefRisk.severity`.** The
  vocab {high,medium,low} is identical to the scaffold's `RiskSeverity`
  (`contracts/brief.ts:65`). Reusing it avoids a duplicate enum. **Adopted in the plan** (S1
  imports `RiskSeverity`); called out so the reviewer confirms reuse rather than a net-new enum.

## 6. Relevant Insights (top-3, with anchors)

1. **This exact feature is foretold: a lazily-computed per-PR artifact's GET must represent
   "never generated yet"** — `client/INSIGHTS.md:21` ("Same shape will recur for any
   lazily-computed per-PR artifact (e.g. the sibling `risk_brief` feature)"). → Shapes the GET
   contract + the card's not-generated branch. **Deviation:** the spec models this as an explicit
   `status:'not_generated'` on a non-null `BriefResponse` wrapper (§7), not `T | null` — a valid
   alternative that still represents the empty state; documented, not accidental.
2. **A dual-vendored contract edit is a two-file edit whose fallout `tsc` finds, not the named
   task** — root `INSIGHTS.md:51-52` ("Vendored `shared` lives in TWO places … at runtime Zod
   rejects the wire payload") + `INSIGHTS.md:166` ("a NEWLY-required contract field … `tsc`
   immediately flagged FIVE DTO producers … plus three CLIENT test fixtures"). → **Shapes the
   whole decomposition:** the output-contract + column + migration live in ONE inline task (S1);
   its acceptance is "grep every `z.infer<…Brief…>` construction / `.parse(` in **both**
   packages", not just a known fixture. Fallout here is small (the feature is unbuilt) — the new
   output shapes have no producers yet — but S1 must verify by grep, not assume.
3. **Cross-workspace 404 it-tests need a separately seeded workspace row, and `pr_brief` (like
   `onboarding`) has no `workspace_id`** — `server/INSIGHTS.md:52` ("can't be driven by a request
   header — `LocalNoAuthProvider.currentWorkspace()` always resolves to the single seeded
   'default' workspace") + `server/INSIGHTS.md:264` (tenancy "rests entirely on
   `RepoRepository.getById(workspaceId, repoId)` before ANY … table query"). → Shapes S2's
   AC-19 test (seed a second `workspaces` row) and its tenancy design (scope via
   `reviewRepo.getPull(workspaceId, prId)` before any `pr_brief` query).

Honorable mentions folded into task acceptance: the untrusted **source-label** technique
(prepend `Source: ${path}` INSIDE the `wrapUntrusted` fence so the model can cite a file, two
parallel arrays for human-vs-model text — `server/INSIGHTS.md:251`, already the shape of
`resolveProjectContext`); the dynamic-`t(\`prefix.${code}\`)` `Set.has()` + raw-string fallback
to avoid `MISSING_MESSAGE` (`client/INSIGHTS.md:129`, precedent `BlastRadiusCard.tsx:56-63`);
DB-backed server tests MUST end `.it.test.ts` or the CI split skips them
(`server/CLAUDE.md`); the per-route rate limit is disabled under `NODE_ENV=test` so its it-test
asserts the `config.rateLimit` override EXISTS, not a live 429 (`server/CLAUDE.md`);
whole-project `pnpm typecheck` shows sibling-in-progress noise during parallel S2/C1 work — grep
`tsc` output for your own files (`server/INSIGHTS.md:44`).

## 7. Architecture Changes

Design follows `onion-architecture`: transport (`routes.ts`) maps HTTP↔service with zero
business logic; the service (application layer) orchestrates the reads + the single call +
persistence; pure helpers (`grounding.ts`, `assemble.ts`) hold the deterministic
ground/normalize/prompt-assembly rules with no I/O; every external dependency (`github`, `git`,
`llm`, `db`, the intent/blast/smart-diff/project-context reads) is reached through the DI
container or via already-existing service classes it constructs. The single Zod contract lives
in `@devdigest/shared`. Follows `frontend-architecture` on the client: the card is a
route-local `_components/<Name>/` composite (domain-aware, so NOT `vendor/ui`), data via
`lib/hooks` → `lib/api`.

### `@devdigest/shared` (dual-vendored — Task S1) `[shared: two-file edit]`
- **`server/src/vendor/shared/contracts/brief.ts`** and **byte-identical
  `client/src/vendor/shared/contracts/brief.ts`** (both currently identical — verified by
  `diff`): **append** the net-new OUTPUT shapes AFTER the existing `PrBrief` (`:124`), leaving
  every existing input shape (`PrBrief`, `Risk`, `Intent`, `BlastRadius`, `SmartDiff`, …)
  **untouched** (spec Q1). Reuse the existing `RiskSeverity` enum (`:65`, R4). New shapes:
  - `ReviewFocusItem = { file: string; line: int; reason: string }`
  - `BriefRiskRef = { file: string; line?: int }`; a risk reference is
    `z.union([BriefRiskRef, z.string()])` (the string = an endpoint) (spec §Contracts `:472-481`)
  - `BriefRisk = { title: string; explanation: string; severity: RiskSeverity; references:
    (BriefRiskRef | string)[] }` — a DISTINCT, line-bearing shape; the input `Risk` is NOT reused
  - `RiskBrief = { what: string; why: string; risk_level: RiskSeverity; risks: BriefRisk[];
    review_focus: ReviewFocusItem[] }` (the output body)
  - `BriefDegradedReason = z.enum([...])` — a CLOSED set (e.g. `model_failed`, `no_inputs`),
    mapped to i18n on the client (spec §Contracts `:488`)
  - `BriefStatus = z.enum(['fresh','stale','not_generated','degraded'])`
  - `BriefCost = { usd: number; tokens_in: int; tokens_out: int; model: string }` (the **brief
    call's own** cost, spec Q4)
  - `BriefResponse = { status: BriefStatus; brief?: RiskBrief; degraded_reason?:
    BriefDegradedReason; head_sha?: string; generated_at?: string; cost?: BriefCost }` — the GET
    return, discriminated by `status`; `brief`/`head_sha`/`generated_at`/`cost` present for
    fresh/stale (and prior brief on degraded), absent for not_generated. **GET returns a non-null
    `BriefResponse`** (deviation from `client/INSIGHTS.md:21`, §3).
  - `GenerateBriefRequest = { force?: boolean }` (`force:true` = Regenerate)
  Barrel (`vendor/shared/index.ts:19`) already `export *`s `contracts/brief.js` — **no barrel
  edit**, appending to the existing file is enough. New shapes have no producers yet, so `tsc`
  fallout is expected to be nil — **verify by grep** (`z.infer<...Brief...>`, `.parse(`) in BOTH
  packages, per `INSIGHTS.md:166`, before declaring done.

### server (Task S1: schema/migration; Task S2: module)
- **`server/src/db/schema/reviews.ts:57-62`** — extend the `prBrief` pgTable with columns:
  `head_sha text`, `model text`, `cost_usd doublePrecision`, `tokens_in integer`, `tokens_out
  integer`, `generated_at timestamptz NOT NULL DEFAULT now()` (Q1/Q3). Keep `json jsonb` for the
  `RiskBrief` body. The table is already barrel-wired (`db/schema.ts:32,62`) — new columns only,
  no new export.
- **`server/src/db/migrations/0015_*.sql` + `meta/_journal.json` + `meta/0015_snapshot.json`** —
  generated via `pnpm db:generate` (NEXT number is `0015`; last is `0014_lying_shadowcat`),
  reviewed, applied via `pnpm db:migrate` (custom runner, NOT `drizzle-kit migrate`). Do not
  hand-edit generated SQL; rollback is rm-sql + rm-snapshot + drop-journal-entry + regenerate
  (`server/INSIGHTS.md:94-101`). Empty table today ⇒ no backfill.
- **`server/src/modules/brief/`** (Task S2, net-new; registry key `brief`, routes
  `/pulls/:id/brief`):
  - `routes.ts` — `GET /pulls/:id/brief` (read, unthrottled) + `POST /pulls/:id/brief` (generate;
    body `GenerateBriefRequest`; `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }`,
    AC-20), both workspace-scoped via `getContext(container, req)` (`_shared/context.ts:14`),
    `{ schema: { params: IdParams } }` (`_shared/schemas.ts:11`). **Synchronous** — no job, no
    SSE (mirrors `POST /pulls/:id/intent`, `reviews/routes.ts:52-59`).
  - `service.ts` — orchestration: (read path) load `pr_brief` row, compare `head_sha` vs
    `pull.head_sha` → `fresh`/`stale`/`not_generated`; (generate path) assemble inputs, wrap
    untrusted, `resolveFeatureModel(container, workspaceId, 'risk_brief')` (AC-5, CONFIRMED — no
    agent model override), ONE `completeStructured` call (low temp), ground + normalize, persist +
    record cost, or fail-soft degraded. Workspace 404 via `reviewRepo.getPull(workspaceId, prId)`
    before any brief query.
  - `repository.ts` — `new BriefRepository(container.db)`, sole `pr_brief` access
    (read/upsert), PR-scoped.
  - `assemble.ts` (pure-ish) — build the model input from the **structured summaries only** (NO
    diff hunks, AC-1): persisted intent (via `IntentService.getIntent`), blast summary (via
    `BlastService.getBlastRadius`), smart-diff stats (via `SmartDiffService.getSmartDiff`), live
    linked issue (own regex-over-body + `github.getIssue`, fail-soft, AC-4, pattern from
    `intent.service.ts:143-164`), and Project Context specs = **the deduped union across ALL
    enabled agents** (each `agents.listEnabled(workspaceId)` agent's `attachedDocs` ∪ its
    enabled skills' `attachedDocs`) resolved via `resolveProjectContext(agentDocs, skillDocs,
    read)` (`reviews/project-context.ts:68`; CONFIRMED product owner 2026-07-10 — union across
    all enabled agents, not first-enabled). Wrap each untrusted input via `wrapUntrusted`
    (`platform/prompt.ts:6-11`) with the `Source: ${path}` label technique
    (`server/INSIGHTS.md:251`), AC-18.
  - `grounding.ts` (pure) — build the allowed-reference set from the assembled inputs (changed
    files from smart-diff/`pr_files`, blast caller `file:line`, blast endpoints/crons, intent
    references); drop any `risks[]` ref / `review_focus[]` entry not present (AC-7, Q2); normalize
    `risk_level` to {high,medium,low} and reject out-of-vocab (AC-8).
  - `constants.ts` — rate-limit numbers, temperature, closed `BriefDegradedReason` set,
    prompt-template path.
  - `server/src/prompts/brief.system.md` (new) — the `risk_brief` system prompt: instruct
    output of the 5 fields grounded ONLY in the provided FACTS, keep the `<untrusted>` guard note
    (echoing `intent.service.ts:64-66,76`), forbid inventing file/line/endpoint references (AC-7,
    AC-18). New file — no drift to reconcile (unlike L05's P0).
  - colocated `grounding.test.ts`, `assemble.test.ts` (unit), `service.it.test.ts` (integration).
  - **Reads only, no edits** to: `reviews/intent.service.ts`, `blast/service.ts`,
    `reviews/smart-diff.service.ts`, `reviews/project-context.ts`, `settings/feature-models.ts`,
    the LLM adapter, `wrapUntrusted`. S2 constructs/imports these; it does not own their files.
- **`server/src/modules/index.ts:2-14,29-43`** (Task S2) — one import + one registry entry
  (`brief`); the comment at `:26` already anticipates a `brief` module.

### client (Task C1)
- **`client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/`** (new folder):
  `PrBriefCard.tsx` (risk-level-colored banner + text label AC-12; `what`/`why`; Regenerate
  control reusing the Onboarding fresh/stale + disabled-while-in-flight pattern
  `OnboardingHeader.tsx:56-90`/`OnboardingBody.tsx:59-134`; brief cost readout via `RunCostBadge`
  `variant="detailed"` with `tokensIn`/`tokensOut` `vendor/ui/primitives/RunCostBadge.tsx:13-27`;
  "Review focus — read these first" list of `MonoLink` + `githubBlobUrl(repoFullName, sha, file,
  line)` links `vendor/ui/primitives/MonoLink.tsx:3` / `lib/github-urls.ts:24`; fresh/stale/
  not-generated/degraded states AC-14/16/17; review-derived score ring/verdict/findings shown
  ONLY when a completed review exists — read `usePrReviews(prId)` `runs[0]` and guard `score !=
  null` mirroring `VerdictBanner.tsx:50`, AC-11), a `PrBriefCard.helpers.ts` (reason-code→i18n
  `Set.has()` + raw-string fallback, `client/INSIGHTS.md:129` / `BlastRadiusCard.tsx:56-63`),
  and colocated `PrBriefCard.test.tsx`.
- **`client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:17-25`**
  (edit) — insert `<PrBriefCard prId repoId repoFullName sha />` ABOVE the existing
  `IntentCard`/`BlastRadiusCard` row (spec `:400`). The card reads its own hooks; no page.tsx
  prop-drilling needed (`usePrReviews`/`usePrBrief` dedupe by query key).
- **`client/src/lib/hooks/brief.ts`** (edit — append after `:51`) — `usePrBrief(prId)`
  (`api.get<BriefResponse>(\`/pulls/${prId}/brief\`)`, non-null wrapper, `enabled: prId != null`)
  and `useGenerateBrief()` (`api.post<BriefResponse>(\`/pulls/${prId}/brief\`, { force })`,
  invalidate `["brief", prId]` on success). Keep the existing intent/smart-diff/blast exports
  intact (IntentCard/BlastRadiusCard/`brief.test.tsx` import them). `api` base at `lib/api.ts:65`.
- **`client/src/lib/hooks/brief.test.tsx`** (edit) — add `usePrBrief`/`useGenerateBrief` cases;
  keep the existing intent cases.
- **`client/messages/en/brief.json`** (edit) — extend the namespace with card keys (risk-level
  labels, `what`/`why` headings, review-focus heading, regenerate/regenerating, stale/
  not-generated prompts, degraded-reason messages keyed by `BriefDegradedReason`, cost label).
  Missing key = build error — all new keys must exist before the card renders.

### reviewer-core
- **No file change.** `completeStructured` (via the `LLMProvider` port), `wrapUntrusted`, and the
  `INJECTION_GUARD` are consumed as-is (spec §Cross-module `:416-420`). The review pipeline's
  `groundFindings()` gate is a findings-over-diff gate and does NOT apply here (the brief excludes
  the diff); the brief performs its OWN input-reference grounding in `brief/grounding.ts` (AC-7).

## 8. Parallelizable Tasks

Decomposed by disjoint file ownership; server and client file sets never overlap. The one
shared-contract two-file edit is isolated in Task S1 and never split. Each row is a
self-contained card — the orchestrator hands the implementer only that row plus the per-task
landmines block below the table.

| Task | Module | Files owned (with anchors) | Skills to apply | Acceptance criteria | Tests to run | Depends-on | Batch |
|------|--------|----------------------------|-----------------|---------------------|--------------|------------|-------|
| **S1 — Output contract + `pr_brief` columns + migration + fixture fallout (shared surface, inline)** `[shared: two-file edit]` | shared + server db | `server/src/vendor/shared/contracts/brief.ts` (append output shapes after `:124`, reuse `RiskSeverity` `:65`); `client/src/vendor/shared/contracts/brief.ts` (byte-identical mirror); `server/src/db/schema/reviews.ts:57-62` (extend `prBrief` table); `server/src/db/migrations/0015_*.sql` + `meta/_journal.json` + `meta/0015_snapshot.json` (via `pnpm db:generate`); any `…Brief…` fixture fallout found by grep in BOTH packages | `zod`, `drizzle-orm-patterns`, `postgresql-table-design`, `typescript-expert` | `RiskBrief` = `{what, why, risk_level, risks: BriefRisk[], review_focus: ReviewFocusItem[]}`; `ReviewFocusItem = {file, line:int, reason}`; `BriefRisk = {title, explanation, severity: RiskSeverity, references:(BriefRiskRef|string)[]}` (line-bearing, distinct from input `Risk`); `BriefResponse` discriminated by `status ∈ {fresh,stale,not_generated,degraded}` with `brief?/head_sha?/generated_at?/cost?` + `degraded_reason?: BriefDegradedReason` (closed set); `BriefCost = {usd, tokens_in, tokens_out, model}`; `GenerateBriefRequest = {force?}` (AC-8/9 shape; spec §Contracts `:472-493`). Existing `PrBrief`/`Risk`/`Intent`/`BlastRadius`/`SmartDiff` shapes **unchanged** (spec Q1). Both vendored copies **byte-identical** (verify by `diff`/blob hash, `INSIGHTS.md:51-52`). `pr_brief` gains `head_sha, model, cost_usd, tokens_in, tokens_out, generated_at` (AC-13/14/6). Migration is `0015`, generated (not hand-edited), applies cleanly on the empty `pr_brief` table. **Every** `z.infer<…Brief…>` construction / `.parse(` in BOTH packages compiles/parses after the edit — grep to find them all (`INSIGHTS.md:166`); expected fallout is nil (feature unbuilt) but verify, don't assume. | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `cd server && pnpm typecheck`; `cd client && pnpm typecheck`. Do NOT run migrations beyond reviewing `pnpm db:generate` output. (`TESTING.md:63-74`) | — | none (shared-contract; runs alone) |
| **S2 — Server brief module** | server (`modules/brief`, `modules/index`, `prompts`) | `server/src/modules/brief/routes.ts` (new); `.../service.ts` (new); `.../repository.ts` (new); `.../assemble.ts` (new); `.../grounding.ts` (new); `.../constants.ts` (new); colocated `.../grounding.test.ts`, `.../assemble.test.ts`, `.../service.it.test.ts` (new); `server/src/prompts/brief.system.md` (new); `server/src/modules/index.ts:2-14,29-43` (register `brief`) | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security`, `typescript-expert` | Input assembled ONLY from persisted intent + blast summary + smart-diff stats + linked issue + attached specs, **NO raw diff hunks** — input size bounded by summaries not diff (AC-1); intent read via `IntentService.getIntent` (persisted, no reclassify); absent-intent path still generates (AC-2); Project Context = the **deduped union across ALL enabled agents** (each `listEnabled` agent's docs ∪ its enabled-skill docs) via `resolveProjectContext`, read fresh (AC-3, CONFIRMED — union, not first-enabled; zero enabled agents ⇒ no `## Project context`); linked issue fetched live (regex over body + `github.getIssue`) and OMITTED fail-soft on any error, HTTP 200 (AC-4); exactly ONE `completeStructured` call, model via `resolveFeatureModel(…,'risk_brief')` (AC-5, CONFIRMED — no agent model override), low temperature; zero model calls on a cached read (AC-5); cost/tokens/model recorded to `RunLogger` AND persisted on the `pr_brief` row (AC-6, Q1); every `risks[]` ref + `review_focus[]` entry grounded against input-present files/endpoints, unresolved dropped — `review_focus` by file-in-changed-set keeping emitted line, refs by file/endpoint presence (AC-7, Q2); output field set fixed + `risk_level` normalized to {high,medium,low}, out-of-vocab rejected (AC-8); read returns all 5 fields with grounded refs (AC-9); persist keyed by PR + `head_sha`, subsequent read returns stored brief w/o a model call (AC-13); status `fresh` when stored `head_sha == pull.head_sha` else `stale`, stored brief still returned (AC-14); `POST {force:true}` runs one fresh call against current head and replaces the row, all-or-nothing/last-write-wins (AC-15); model failure/timeout ⇒ NO 5xx, NO partial persist, prior brief preserved, degraded marker + closed `BriefDegradedReason` returned, retryable (AC-16); never-generated PR ⇒ `status:'not_generated'` at HTTP 200 (AC-17); intent/issue-body/spec/blast/smart-diff-derived text wrapped `<untrusted>` + injection guard kept in `brief.system.md` (AC-18); routes resolve workspace via `getContext`, cross-workspace PR ⇒ 404 (AC-19); generate route carries `config.rateLimit` override ≤10/min, read route unthrottled (AC-20). No SSE/job — synchronous POST. | Unit: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (grounding/assemble — AC-1/3/7/8, deterministic; NO LLM prose assertions). Integration: `cd server && pnpm exec vitest run .it.test` (service — AC-2/3/4/5/6/13/14/15/16/17/19/20, MockLLMProvider incl. forced-error degraded; cross-workspace via a SEPARATE seeded workspace row `server/INSIGHTS.md:52`). `cd server && pnpm typecheck` (grep own files, `server/INSIGHTS.md:44`). (`TESTING.md:63-74`) | S1 | none (sole server task; parallel to C1) |
| **C1 — Client PrBriefCard + hooks + i18n** | client (`pulls/[number]/_components/PrBriefCard`, `OverviewTab`, `lib/hooks/brief`, `messages`) | `client/src/app/repos/[repoId]/pulls/[number]/_components/PrBriefCard/PrBriefCard.tsx` (new); `.../PrBriefCard/PrBriefCard.helpers.ts` (new); `.../PrBriefCard/PrBriefCard.test.tsx` (new); `.../OverviewTab/OverviewTab.tsx:17-25` (insert card above the card row); `client/src/lib/hooks/brief.ts` (append `usePrBrief`/`useGenerateBrief` after `:51`, keep existing exports); `client/src/lib/hooks/brief.test.tsx` (add new-hook cases); `client/messages/en/brief.json` (extend) | `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `security`, `typescript-expert` | Card renders a `risk_level`-colored banner **plus a text label** (AC-10/AC-12/a11y — readable with color removed), the `what`/`why` summary, a keyboard-operable Regenerate control disabled while a generation is in flight (reuse Onboarding pattern), the **brief call's own** cost/token readout via `RunCostBadge variant="detailed"` (AC-10), and a "Review focus — read these first" list of keyboard-operable `file:line` links (`MonoLink` + `githubBlobUrl(repoFullName, sha, file, line)`) one per `review_focus` entry (AC-10); `risk_level` rendered independently of any review score — the score ring/verdict/findings counts render ONLY when `usePrReviews(prId)` `runs[0]` exists and its `score != null` (mirror `VerdictBanner.tsx:50`), and the card still renders `what`/`why`/`risk_level`/`review_focus` with no ring when no review exists (AC-11); fresh/stale/not-generated/degraded driven by `BriefResponse.status` — stale still renders the stored brief with a stale marker (AC-14), not-generated shows a Generate prompt (AC-17), degraded shows a reason message (mapped via `Set.has()` + raw-string fallback, no `MISSING_MESSAGE`, `client/INSIGHTS.md:129`) preserving any prior brief (AC-16); `usePrBrief` types the GET as non-null `BriefResponse`; `useGenerateBrief` posts `{force:true}` for Regenerate and invalidates `["brief", prId]` (AC-15); all new strings via i18n (AC-18 non-functional/i18n); no `fetch()` in components — all data via `lib/hooks`→`lib/api`. Existing intent/smart-diff/blast hook exports + their tests remain green. | `cd client && pnpm test && pnpm typecheck` (RTL component + hook tests — AC-10/11/12/14/15/16/17; assert structure/labels/links/status branches/call-shape, NOT LLM prose). (`TESTING.md:63-74`) | S1 | none (sole client task; parallel to S2) |

**Per-task landmines to quote in the spawn prompt** (repo cost policy — do NOT tell the
implementer to re-read the full `INSIGHTS.md` files; quote only these):

- **S1:** (1) `INSIGHTS.md:51-52` — "Vendored `shared` lives in TWO places — every contract edit
  is a two-file edit … at runtime Zod rejects the wire payload." (2) `INSIGHTS.md:166` — a newly
  required contract field's fallout is "every `z.infer<T>` producer + every typed test fixture",
  found by `tsc`, not just the named fixture. (3) `server/INSIGHTS.md:94-101` — Drizzle rollback
  is three files (sql + snapshot + journal entry), regenerate; do not hand-edit generated SQL.
- **S2:** (1) `server/INSIGHTS.md:52` — cross-workspace 404 it-test seeds a SEPARATE `workspaces`
  row; a request header won't work (`LocalNoAuthProvider` always resolves the default workspace).
  (2) `server/INSIGHTS.md:264` — tenancy rests on the PR/repo lookup before ANY brief-table query
  (`pr_brief` has no `workspace_id`). (3) `server/INSIGHTS.md:251` — untrusted source-label:
  prepend `Source: ${path}` INSIDE the `wrapUntrusted` fence so the model can cite a file; keep
  two parallel arrays (human-facing bare paths vs model-facing labeled text). (4) `server/
  CLAUDE.md` — DB-backed tests MUST end `.it.test.ts` (CI split); the rate-limit is disabled
  under `NODE_ENV=test`, so assert the `config.rateLimit` override EXISTS, not a live 429. (5)
  `server/INSIGHTS.md:44` — `pnpm typecheck` is whole-project; grep `tsc` output for your files.
- **C1:** (1) `client/INSIGHTS.md:21` — a lazily-computed per-PR artifact GET must represent
  "never generated yet" (here: `status:'not_generated'`); type the hook accordingly and branch
  in the card. (2) `client/INSIGHTS.md:129` — a dynamic `t(\`prefix.${code}\`)` must guard with
  `KNOWN.has(code) ? t(...) : code` or next-intl throws `MISSING_MESSAGE` (precedent
  `BlastRadiusCard.tsx:56-63`). (3) `client/CLAUDE.md` — a missing i18n key is a BUILD-time error;
  every new `brief.json` key must exist before the card renders; keep the existing intent hook
  exports in `brief.ts` intact.

Wave grouping (each task is its own spawn — no fusible batch, since S1 is a shared-contract edit
and S2/C1 are different modules with distinct onboarding sets):
- **Wave 0:** S1 alone.
- **Wave 1 (parallel, after S1):** S2 ‖ C1.

## 9. AC-N → Task coverage

| AC | Tasks | AC | Tasks |
|----|-------|----|-------|
| AC-1 | S2 (assemble) | AC-11 | C1 |
| AC-2 | S2 | AC-12 | C1 |
| AC-3 | S2 | AC-13 | S1 (columns) + S2 (write) |
| AC-4 | S2 | AC-14 | S2 (status) + C1 (badge) |
| AC-5 | S2 | AC-15 | S2 + C1 (Regenerate) |
| AC-6 | S1 (columns) + S2 (record) | AC-16 | S2 + C1 (degraded UI) |
| AC-7 | S2 (grounding) | AC-17 | S2 (status) + C1 (Generate prompt) |
| AC-8 | S1 (enum) + S2 (normalize) | AC-18 | S2 (wrap + prompt) |
| AC-9 | S1 (shape) + S2 (return) | AC-19 | S2 |
| AC-10 | C1 | AC-20 | S2 |

Every AC-1..AC-20 maps to ≥1 task; every task (S1, S2, C1) maps to ≥1 AC. No orphans.

**Clarifications from cross-model review (§13):**
- **AC-6 mapping** — "S1 (columns) + S2 (record)" means S1 provides **schema prerequisites
  only** (the `head_sha`/`model`/`cost_usd`/`tokens_in`/`tokens_out` columns); S1 has no
  behavioural obligation toward AC-6. S2 alone is responsible for the observable — and AC-6 is
  satisfied only when **both** the `RunLogger` call **and** the `pr_brief` row write happen for
  the same generation (not either alone).
- **AC-20 mapping** — S2 satisfies AC-20's rate-limit *configuration* (the `config.rateLimit`
  override on the generate route); per §10, the *live-429* half of AC-20's observable is not
  exercised by this repo's test suite because rate limiting is disabled under `NODE_ENV=test` —
  the test asserts the override's presence/values, not a live 429 response. This is a deliberate
  test-environment gap, not an unmet AC.

## 10. Testing Strategy

Canonical per-module commands: `TESTING.md:63-74` (each task's **Tests to run** cell names its
exact command). The planner runs none of them (Hard rule 1).

- **Deterministic-only assertions.** Per the spec's §LLM-usage mandate (`…:363-368`), tests
  assert the fixed field set + `risk_level` vocabulary (AC-8), that every emitted reference
  resolves to an input-present file/endpoint (AC-7), and that exactly one model call runs per
  generation / zero on read (AC-5) — **never** exact `what`/`why`/explanation/reason prose.
- **Server unit lane** (hermetic, `--exclude '**/*.it.test.ts'`): the pure `grounding.ts` (drop
  refs absent from the input set; normalize/reject out-of-vocab `risk_level`, AC-7/8) and
  `assemble.ts` (input carries the structured summaries and NO raw diff-hunk text; large hunks ⇒
  bounded input, AC-1; untrusted inputs wrapped, AC-18; Project Context is the deduped union
  across all enabled agents, AC-3).
- **Server integration lane** (`.it.test`, testcontainers Postgres — a schema change ⇒ this lane,
  not unit): persistence + freshness (AC-13/14/15), single-call + cost recording via
  MockLLMProvider (AC-5/6), fail-soft degraded with the provider forced to error and prior brief
  preserved (AC-16), never-generated status (AC-17), absent-intent + issue-omitted paths
  (AC-2/4), rate-limit config presence (AC-20, config-assert not live-429), and cross-workspace
  404 using a **separate seeded workspace row** (AC-19, `server/INSIGHTS.md:52`). DB-backed files
  MUST end `.it.test.ts` (`server/CLAUDE.md`).
- **Client lane** (`pnpm test && pnpm typecheck`, RTL + jsdom, fetch mocked): the card renderer +
  the two new hooks — banner color + text label (AC-10/12), cost readout (AC-10), review-focus
  links (AC-10), independent risk_level + score-ring-only-when-review-exists (AC-11),
  fresh/stale/not-generated/degraded branches with the reason→i18n fallback (AC-14/16/17),
  Regenerate posting `{force:true}` (AC-15), and the existing intent hook cases still green.
- **Whole-project typecheck** is the wave-closing responsibility; during parallel S2/C1 work each
  implementer greps `tsc` output for its own files (`server/INSIGHTS.md:44`).

## 11. Risks & Mitigations

| Risk | Sev | Mitigation |
|------|-----|-----------|
| Dual-vendored contract drift (server vs client `brief.ts`) ⇒ runtime Zod rejection | High | Both copies owned by ONE task (S1); verify byte-identical by `diff`/blob hash (`INSIGHTS.md:51-52`); wave gate before S2/C1 start |
| "Default review agent" has no code concept ⇒ wrong spec set injected (AC-3) | Low | RESOLVED (product owner 2026-07-10): inject the deduped union of attached docs across ALL enabled agents via `resolveProjectContext`; S2 acceptance + §7 `assemble.ts` locked to this; unit-tested that the injected set = union over `listEnabled` |
| Model invents a file/line/endpoint not in the inputs | Med | `grounding.ts` drops any unresolved ref (AC-7); unit-tested with a fixture citing an absent file; `brief.system.md` also forbids invention |
| Injection via linked-issue body / spec text | Med | `wrapUntrusted` + kept injection guard (AC-18, S2 + `brief.system.md`); it-test asserts an "ignore previous instructions" issue body does not alter the field set/structure; `/security-review` on S2 |
| Failed generation clobbers a stored brief | Med | S2 acceptance: failure persists NOTHING, prior brief still returned (AC-16, all-or-nothing) — it-test forces a provider error after a prior successful generate |
| GET-returns-wrapper deviates from the `T \| null` INSIGHTS precedent | Low | Deliberate (`status:'not_generated'` per spec §Contracts); documented in §3/§7 so the reviewer sees intent; client hook + card branch on `status` |
| Migration hand-edit desyncs the snapshot | Low | Use `pnpm db:generate`; rollback = rm-sql + rm-snapshot + drop-journal + regenerate (`server/INSIGHTS.md:94-101`) |
| DB-backed test mis-named ⇒ CI split skips it | Low | Service tests end `.it.test.ts` (`server/CLAUDE.md`) |
| Missing i18n key ⇒ client build fails | Low | C1 adds every `brief.json` key (incl. each `BriefDegradedReason`) before the card renders (`client/CLAUDE.md`) |

## 12. Success Criteria

- [ ] All 20 ACs demonstrably covered by the tasks; §9 matrix has no orphan AC or task.
- [ ] Both vendored `brief.ts` copies byte-identical; the net-new output shapes
      (`RiskBrief`/`BriefRisk`/`ReviewFocusItem`/`BriefResponse`/`BriefDegradedReason`/`BriefCost`/
      `GenerateBriefRequest`) present in both; input-bundle `PrBrief` untouched; migration `0015`
      applies on the empty `pr_brief` table (now carrying `head_sha` + cost columns).
- [ ] `modules/brief/` is a **synchronous** capability (no job, no SSE): workspace-scoped routes,
      rate-limited generate, single low-temp `completeStructured` (model via the `risk_brief`
      feature-model), Project Context = deduped union across all enabled agents, own
      input-reference grounding + `risk_level` normalization, persist-by-head-SHA with
      fresh/stale/not-generated/degraded, cost recorded to the log + the `pr_brief` row;
      reviewer-core has ZERO file edits.
- [ ] `PrBriefCard` renders above the Overview `IntentCard`/`BlastRadiusCard` row: risk banner +
      text label, `what`/`why`, Regenerate, brief-own cost readout, `file:line` review-focus links;
      score ring/verdict shown only when a completed review exists; degraded/stale/not-generated
      branches map to i18n with a `Set.has()` fallback.
- [ ] Server unit + integration lanes green; client `pnpm test && pnpm typecheck` green;
      whole-project typecheck clean at wave close.
- [ ] No test asserts LLM `what`/`why`/explanation/reason prose; deterministic facts only.
- [ ] `/security-review` clears S2 (untrusted wrapping, workspace scoping, no SSRF from
      PR-content-derived URLs, no wholesale logging of input/issue/spec bodies).

## 13. Cross-Model Review (openai/gpt-5.1, 2026-07-10)

Run via `/cross-model-plan-review docs/plans/L06-why-risk-brief.md` — a non-Anthropic model
(GPT-5.1, over OpenRouter) read this plan plus its source spec cast as a skeptical staff
engineer, to catch what a same-family (Claude) re-read would be more likely to rubber-stamp.

**Verdict: ready_with_notes.** No structural blockers; all findings are documentation/
traceability tightening, not rework. Summary from the reviewer: "unusually thorough in
decomposition, sequencing, and parallel safety … S1 cleanly owns the dual-vendored contract and
migration, S2 and C1 are disjoint server/client modules gated on S1, and all ACs are explicitly
mapped with no orphans."

| # | Severity | Finding | Disposition |
|---|----------|---------|--------------|
| 1 | WARNING | AC-3's spec prose still says "default review agent" while the plan (§3) redefines it to "union across all enabled agents" (product-owner-confirmed 2026-07-10) — the spec text itself was never amended, so a reader of the spec alone sees stale wording. | **Flagged, not fixed here** — annotated in §3 with a pointer to the exact stale spec lines; a spec-edit follow-up is out of this plan's scope. |
| 2 | WARNING | AC-6 is satisfied by S2 recording to **both** `RunLogger` and the `pr_brief` row, but nothing in the plan states a test must fail if only one happens. | **Fixed** — explicit "both, not either" language added to the §9 mapping notes. |
| 3 | SUGGESTION | §9's "AC-6: S1 (columns) + S2 (record)" reads as if S1 carries partial behavioural responsibility for AC-6, when it only supplies schema. | **Fixed** — §9 mapping notes now state S1's role is schema-only. |
| 4 | SUGGESTION | AC-20's stated observable is "exceeding it returns 429," but S2's actual test asserts `config.rateLimit` presence (rate limiting is disabled under `NODE_ENV=test`) — a test-writer reading only the AC text could expect a live 429 test. | **Fixed** — §9 mapping notes now call out this is a deliberate test-environment gap, not an unmet AC. |

Findings 2–4 were folded directly into §9 (`AC-N → Task coverage`) as clarification notes.
Finding 1 is spec-hygiene (the spec, not this plan, needs the edit) and is called out in §3
instead of silently fixed.
