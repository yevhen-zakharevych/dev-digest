# Implementation Plan — Multi-Agent Review

Spec: `specs/2026-07-21-multi-agent-review.md` (SPEC-2026-07-21-multi-agent-review, draft,
revised 2026-07-21 v1-simplification pass).

## 1. Overview

Multi-Agent Review turns the existing parallel review fan-out into a first-class flow: an agent
picker (PR page + a dedicated Configure-run page) with deterministic pre-run time/cost estimates, a
persisted `multi_agent_runs` grouping that links the launched `agent_runs`, and a results page that
renders one live column per agent plus a deterministic "Where agents disagree" block keyed on the
exact `(file, start_line)` pair. The review engine, grounding gate, run-executor, SSE, trace, and
finding-action paths are all reused unchanged.

The plan is **4 tasks in 2 waves** (2 server tasks in wave 0, 2 client tasks in wave 1), inside the
≤5-task / ≤2-wave / ≤3-per-wave ceiling. AC ids are the spec's own (`AC-1 … AC-26`, including
`AC-24a`) and are never renumbered.

**Headline research finding — this feature is heavily pre-scaffolded.** Beyond the
`multi_agent_runs` table and the `observability.ts` contract block the spec already names, the
research found: the whole client i18n namespace exists unused
(`client/messages/en/runs.json:10-15` = `conflicts.title/onlyConflicts/empty/didNotFlag`,
`:110-134` = `page.title/selectPr/prItem/meta/noRun/crumb`), the nav label exists
(`client/messages/en/shell.json:26`), and `activeKeyFor` already routes `/multi-agent`
(`client/src/components/app-shell/helpers.ts:28`). Only `client/src/vendor/ui/nav.ts` lacks its
entry. Plan for extension, not creation.

---

## 2. Requirements (as given)

| ID | Requirement (abbreviated — the spec text is normative) | Source |
|----|--------------------------------------------------------|--------|
| AC-1 | PR page presents an agent picker replacing the run-review dropdown: checkbox per agent, per-agent time hint, Clear action, Configure-agents link, primary "Run multi-agent review (N)" button | `specs/2026-07-21-multi-agent-review.md:176-180` |
| AC-2 | While no agent is checked, the run button is disabled and the count reads 0 | `specs/…:181-184` |
| AC-3 | Clicking run with N ≥ 1 creates a multi-run for that PR with exactly the checked set and navigates to the results page; never executes inline | `specs/…:185-189` |
| AC-4 | Configure-run page shows "Pick a pull request first" empty state and renders neither agent list nor estimate until a PR is picked | `specs/…:193-196` |
| AC-5 | After a PR is picked: checkbox per agent with one-line description + "Ns · $X" hint, Select-all action, run button with adjacent summary estimate | `specs/…:197-201` |
| AC-6 | Running from the Configure-run page reaches the same results route and produces the same multi-run as AC-3 | `specs/…:202-206` |
| AC-7 | Per-agent hint = mean `durationMs`/`costUsd` over that agent's `done` runs scoped to the current repo; no history ⇒ "—" | `specs/…:210-215` |
| AC-8 | Summary estimate = MAX of selected time hints, SUM of selected cost hints; history-less agents excluded from the sum and the summary marked approximate | `specs/…:216-221` |
| AC-9 | If every selected agent lacks history, the summary renders with no numeric time/cost and never a fabricated or zero estimate | `specs/…:222-225` |
| AC-10 | If estimates cannot be computed, both pickers still allow selecting and running; hints render "—" rather than blocking | `specs/…:226-229` |
| AC-11 | Creating a multi-run persists a `multi_agent_runs` record and links every launched `agent_run` to it | `specs/…:233-236` |
| AC-12 | Per-finding agent/run attribution preserved; the grouping is a read-time overlay that merges, reassigns and drops nothing | `specs/…:237-241` |
| AC-13 | A newer multi-run becomes the one the results page shows; the prior multi-run's rows are not deleted | `specs/…:242-245` |
| AC-14 | Results page keyed by PR, renders the latest multi-run, header with "N selected agents · parallel", PR title, summary line and a Configure-run button; no display-mode toggle | `specs/…:249-254` |
| AC-15 | One column per agent; header shows live status, score, duration, cost, findings count, and a View-trace link | `specs/…:255-258` |
| AC-16 | While a run is in progress the column reflects live status and transitions to the terminal status without a manual refresh | `specs/…:259-263` |
| AC-17 | Opening a finding shows confidence, suggested fix and action buttons by rendering the **existing** `FindingCard` | `specs/…:264-268` |
| AC-18 | Accept/Dismiss persists that finding's verdict via the existing path; a co-located finding from another agent is unchanged | `specs/…:269-273` |
| AC-19 | Learn / "Turn into eval case" stay unwired on this page — no request, no state change | `specs/…:274-279` |
| AC-20 | Grouping is the exact key `(file, start_line)` — plain map bucket, no model call, no overlap/threshold/title matching, byte-identical across repeated computations in any input order | `specs/…:283-288` |
| AC-21 | Within a group, every `done` agent's verdict is shown — its severity if it flagged, "did not flag" otherwise (= done agents minus agents with a finding in the bucket) | `specs/…:289-294` |
| AC-22 | "Show only conflicts" shows only groups where ≥1 flagged and ≥1 did not flag, or the flagging agents assigned divergent severities | `specs/…:295-299` |
| AC-23 | With the toggle on and no conflict groups, an explicit empty state renders, not a blank area | `specs/…:300-302` |
| AC-24 | The disagreement block is computed over `done` agents only; a still-running agent is never reported as "did not flag"; the block recomputes as agents complete | `specs/…:303-307` |
| AC-24a | `Conflict.line` is the group's `start_line`; `Conflict.title` is taken from a member finding by a deterministic rule (first by severity, then by finding id) | `specs/…:308-312` |
| AC-25 | Every new multi-run create/read route resolves the workspace via auth context and scopes queries by `workspaceId`; out-of-workspace resources resolve as 404 | `specs/…:316-320` |
| AC-26 | The create-multi-run route carries a per-route rate limit at least as tight as the existing review trigger (max 10/min); the read route need not | `specs/…:321-325` |

---

## 3. Requirements Review

Audited against complete / consistent / unambiguous / testable. **No blocking defect found** — the
spec is unusually well grounded. Fourteen frictions are recorded below; each is either resolved by
an assumption in §4 or by a task-level acceptance criterion in §8. Frictions marked **[harder than
the spec assumes]** are the answer to "tell me before the fleet runs".

| AC | Complete | Consistent | Unambiguous | Testable | Issue |
|----|----------|------------|-------------|----------|-------|
| AC-1, AC-2 | yes | yes | yes | yes | a11y "disabled state announced" (`specs/…:373`) needs `aria-disabled` + accessible name, not only the `disabled` attribute. Folded into T3's criteria. |
| AC-3, AC-6 | yes | yes | yes | yes | The results route the client must navigate to is not named by the spec; the plan fixes it (§4 Q3). |
| AC-4, AC-5 | yes | yes | yes | yes | "one-line description" — the `Agent` contract (`server/src/vendor/shared/contracts/knowledge.ts:333-359`) must actually carry a description field; if it does not, T3 falls back to provider/model. Non-blocking. |
| AC-7 | **gap** | yes | yes | yes | **[harder]** F9 below: `agent_runs` has no `repoId` column (`server/src/db/schema/runs.ts:8-38`), so "scoped to the current repo" needs a join through `pull_requests.repoId` (`server/src/db/schema/pulls.ts:12`). Also undefined: whether a `done` run with a **null** `costUsd` is excluded from the cost mean only, or from the sample entirely. Assumption in §4 Q9. |
| AC-8, AC-9 | yes | yes | yes | yes | none |
| AC-10 | yes | yes | yes | yes | Satisfiable **only** because estimates are a separate endpoint from `GET /agents`; folding them into the agent list would make an estimate failure block agent selection. Made an explicit design constraint in T2. |
| AC-11, AC-13 | yes | yes | yes | yes | none |
| AC-12 | yes | yes | yes | yes | none |
| AC-14 | yes | **conflict** | yes | yes | **[harder]** F7: AC-14 mandates the copy "fan-out via worktrees", but the pre-scaffolded string reads "fan-out via **p-queue**" (`client/messages/en/runs.json:120`), and the spec's own Design-gaps section (`specs/…:627-629`) calls the worktrees wording misleading. Assumption in §4 Q4 + Recommendation R2. Also `MultiAgentRun.total_duration_ms` is a **non-nullable** int (`server/src/vendor/shared/contracts/observability.ts:81`) while a fresh multi-run has no duration — F4. |
| AC-15 | **gap** | yes | partly | yes | **[harder]** F5: `provider`/`model` come from `agent_runs` (`runs.ts:21-22`) but `verdict`/`summary`/`score`/`findings` come from the **`reviews`** row, so the "plain join" of the spec is really `agent_runs ⟕ reviews ⟕ findings`. F6: `reviews.runId` has **no FK and no unique index** (`server/INSIGHTS.md:30`) — a run may resolve to more than one review row; the spec never says which one wins (§4 Q2). F10: `agent_runs.status` is free-form `text()` (`runs.ts:28`) while `AgentColumn.status` is a 4-literal enum — an unmapped value makes `fastify-type-provider-zod` fail **response** serialisation with a 500 (§4 Q8). |
| AC-16 | yes | **partly** | no | yes | **[harder]** F2: "driven by the reused SSE stream" is not achievable per-column with the existing hook. `useRunEvents` (`client/src/lib/hooks/reviews.ts:168-215`) returns `{events, running}` only — no status, score, cost or terminal signal; the events do carry `runId` (`server/src/vendor/shared/contracts/trace.ts:22`) so they can be partitioned, but the terminal transition is DB state. The repo's own precedent for live run status is **polling** (`usePrActiveRuns` `reviews.ts:28-35`, `usePrRuns` `reviews.ts:40-48`). AC-16's *observable* ("transitions on its own without a manual refresh") is fully satisfiable by the polling precedent. Assumption §4 Q5. |
| AC-17 | yes | yes | yes | yes | The client-side join key is `AgentColumnFinding.id` → `ReviewRecord.findings[].id`. Both read the same persisted row, so ids match (note `insertFindings` mints its own uuid — `server/INSIGHTS.md:201` — which is exactly why the *join*, not a fixture id, is the right key). |
| AC-18 | yes | yes | yes | yes | none — `useFindingAction` (`client/src/lib/hooks/reviews.ts:139-161`) already invalidates `["reviews", prId]`, which is the same cache the AC-17 join reads. |
| AC-19 | yes | **conflict** | yes | yes | **[harder]** F1: `FindingCard` has **one** optional unified handler `onAction?: (action: FindingCardAction, reply?: string) => void` (`client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:37-60`), not per-action props. AC-18 needs accept/dismiss wired, so the page **must** pass `onAction`; "passes no handler for them" is literally impossible. AC-19's observable is still satisfiable by a handler that no-ops for anything other than `accept`/`dismiss`. Bonus: the eval-case button is already `disabled={pending || !muted}` (`FindingCard.tsx:157-171`), i.e. inert until the finding is accepted/dismissed. Assumption §4 Q6. |
| AC-20, AC-24a | yes | yes | yes | yes | F13: whose findings form the buckets is implicit — resolved to "findings of `done` columns only", consistent with AC-21/AC-24 (§4 Q10). |
| AC-21 | **gap** | yes | yes | yes | **[harder]** F3: `ConflictTake` requires **non-optional** `persona: string` and `note: string` (`observability.ts:52-57`); the spec never says what to put in either. Assumption §4 Q1. |
| AC-22, AC-23 | yes | yes | yes | yes | The `Conflict` contract carries no `is_conflict` flag and the spec forbids widening it, so conflict-ness is derived client-side from `takes[]`. Assigned to T4; T1 must therefore emit **complete** takes including every `ignored` one. |
| AC-24 | yes | yes | yes | yes | none |
| AC-25 | yes | yes | yes | yes | **[harder]** F-route: new routes must reuse the **exact** param name of the existing family. `reviews/routes.ts` declares `/pulls/:id/*` with `IdParams`; registering `/pulls/:prId/multi-agent-runs` makes find-my-way throw **at boot** ("already declared … with a different param name"). Same trap for any `/repos/:id/*` route vs the existing `/repos/:repoId/pulls`. Folded into T1/T2 criteria. |
| AC-26 | yes | yes | yes | yes | Precedent to copy verbatim: `{ rateLimit: { max: 10, timeWindow: '1 minute' } }` at `server/src/modules/reviews/routes.ts:33`. |

**Cross-cutting friction not tied to one AC:**

- **F8** — the scaffolded i18n block assumes a "Run all agents" affordance (`runs.json` `page.runAll`,
  `page.noRun.cta`) and a Columns↔Tabs toggle (`page.view.columns` / `page.view.tabs`). v1 has a
  checkbox picker and one mode, so those keys go unused. Leave them; do not delete (other lessons
  may claim them).
- **F11** — AC-3/AC-6 require T3 to navigate to a route T4 creates in the same wave. Compile-time
  safe (Next routes are filesystem-resolved, not imported); a runtime 404 until T4 lands. Accepted.
- **F12** — putting time hints on the PR page (AC-1) means the PR detail page issues one extra query
  it does not issue today. `repoId` is already in `useParams` (`.../pulls/[number]/page.tsx:30`), so
  the wiring is trivial.
- **F14** — dual-vendoring is **already drifted**: `diff -rq` shows `adapters.ts`, `contracts/eval-ci.ts`,
  `contracts/knowledge.ts`, `contracts/productionize.ts`, `contracts/trace.ts` differ between the two
  trees today. `observability.ts`, `findings.ts`, `review-api.ts` and `index.ts` are byte-identical.
  Verify a dual edit by diffing only the **added** lines (root `INSIGHTS.md:216`), never by expecting
  whole-file equality.

---

## 4. Open Questions

> **Owner decisions, 2026-07-21 — these four are CLOSED, not open. The spec was amended to match
> before any implementer ran; read the spec's `## Revision log` for the exact new AC text.**
>
> - **Q4 (worktrees vs p-queue) → RESOLVED: keep the scaffolded "fan-out via p-queue" string.**
>   AC-14 was rewritten to mandate the scaffolded wording and to forbid "worktrees" appearing on the
>   page. Recommendation R2 is therefore **adopted**, not declined. Net effect: T4 does **not** edit
>   that i18n value — one less edit than the plan assumed.
> - **Q5 (per-column live status) → RESOLVED: polling is normative.** AC-16 no longer names SSE as
>   the transport; it asserts only the unaided transition. The plan's assumption stands and is now
>   backed by the spec, so a verifier cannot read it as a miss.
> - **Q6 (AC-19 inertness) → RESOLVED: the no-op handler is normative.** AC-19 was rewritten to
>   require an `onAction` that handles only `accept`/`dismiss`. The plan's assumption stands.
> - **Q7 (`RunReviewDropdown`) → RESOLVED: delete the whole folder.** `useRunReview` and
>   `POST /pulls/:id/review` stay (the MCP `run_agent_on_pr` tool depends on them).
>
> Also decided: **R1 (index on `agent_runs.multi_agent_run_id`) is ADOPTED** — see T1 criterion 1b.

The remainder are **[non-blocking]** — each carries the assumption the plan proceeds on. None re-opens
a v1 simplification decision.

1. **[non-blocking] What goes in `ConflictTake.persona` and `ConflictTake.note`?** Both are required
   non-empty-typed strings (`observability.ts:52-57`) and the spec is silent.
   **Assumption:** `persona` = the column's `agent_name`; `note` = the member finding's `title` for a
   flagging take, and the empty string `""` for an `ignored` take. Deterministic, no model call.
2. **[non-blocking] Which review row supplies a column's verdict/summary/score/findings when a run
   has more than one?** `reviews.runId` is unindexed and FK-less (`server/INSIGHTS.md:30`).
   **Assumption:** take the run's most recent review with `kind === 'review'` (`ReviewRecord.kind`,
   `server/src/vendor/shared/contracts/review-api.ts:23-38`), falling back to the most recent review
   of any kind; if none, the column renders with null verdict/summary/score and an empty findings list.
3. **[non-blocking] URL shape for the two new pages.** The spec names neither.
   **Assumption:** Configure-run = `/repos/[repoId]/multi-agent`; results = `/repos/[repoId]/multi-agent/[number]`.
   Both satisfy `activeKeyFor`'s existing `pathname.includes("/multi-agent")` test
   (`client/src/components/app-shell/helpers.ts:28`) and avoid the `/pulls` branch at `helpers.ts:35`
   that would otherwise steal the highlight.
4. **[non-blocking] "fan-out via worktrees" (AC-14) vs the scaffolded "fan-out via p-queue"
   (`client/messages/en/runs.json:120`).**
   **Assumption:** AC-14 is normative — T4 updates the `meta` string value to the spec's wording.
   See Recommendation R2 for the opposite case.
5. **[non-blocking] Per-column live status source (AC-16).**
   **Assumption:** the polled multi-run read model is the **authoritative** status/score/cost source
   (self-clearing `refetchInterval`, mirroring `usePrRuns` `client/src/lib/hooks/reviews.ts:40-48`);
   `useRunEvents(runIds)` filtered on `ev.runId` may be overlaid as a live activity line. The AC's
   stated observable is met either way.
6. **[non-blocking] How does AC-19 keep Learn / eval-case inert when `FindingCard` has a single
   unified `onAction`?**
   **Assumption:** the results page passes an `onAction` that switches on the action and handles only
   `"accept"` and `"dismiss"`, returning without any request or state change for everything else.
7. **[non-blocking] Is `RunReviewDropdown` deleted or merely unwired?** Its only consumer is
   `PrDetailHeader.tsx:5,92-99`; its only test is a 1-assertion smoke test
   (`RunReviewDropdown.test.tsx:29-32`); e2e does not drive it.
   **Assumption:** delete the whole folder (`RunReviewDropdown.tsx`, `.test.tsx`, `constants.ts`,
   `styles.ts`). The `useRunReview` hook (`lib/hooks/reviews.ts:124-136`) and the
   `POST /pulls/:id/review` route **stay** — the MCP `run_agent_on_pr` tool depends on them.
8. **[non-blocking] Mapping free-text `agent_runs.status` (`runs.ts:28`) onto the 4-literal
   `AgentColumn.status` enum.**
   **Assumption:** pass `done`/`failed`/`cancelled`/`running` through; map anything else (including
   null) to `running`. Never let an unmapped value reach the response serializer.
9. **[non-blocking] Do `done` runs with a null `costUsd` count toward the sample?**
   **Assumption:** `avg_duration_ms` averages over all `done` runs in scope; `avg_cost_usd` averages
   over the subset with a non-null `costUsd` and is `null` when that subset is empty;
   `sample_size` = the count of `done` runs used for the duration mean.
10. **[non-blocking] Do findings from non-`done` columns create conflict buckets?**
    **Assumption:** no. Buckets are formed from the findings of `done` columns only, consistent with
    AC-21/AC-24 — otherwise a failed agent's finding would create a group in which every done agent
    reads "did not flag".

---

## 5. Recommendations

Advice only — **the plan in §8 implements the spec as written and adopts none of these.**

- **R1 — Index `agent_runs.multi_agent_run_id` (and consider `agent_runs.agent_id`). — ✅ ADOPTED
  (owner decision, 2026-07-21).** Folded into T1 criterion 1b; the "Adopted: no" below is superseded.
  *Why better:* `server/src/db/schema/runs.ts:8-38` defines **zero** indexes; the results read model
  and the estimate aggregate both scan `agent_runs`. The non-functional p95 of 500 ms
  (`specs/…:358-362`) holds at starter volumes but has no headroom.
  *Cost:* one `index()` call + one line of generated SQL. Use a **plain** index, never a partial one —
  `drizzle-kit` emits an unbound `$1` placeholder for partial indexes built with `eq()`
  (`server/INSIGHTS.md:34`).
  *Adopted:* no — no AC requires it.
- **R2 — Keep the scaffolded "fan-out via p-queue" copy instead of AC-14's "fan-out via worktrees".**
  *Why better:* the spec itself flags the worktrees wording as cosmetic and potentially misleading
  (`specs/…:627-629`), and the scaffold is already honest about the real mechanism.
  *Cost:* AC-14's literal wording no longer matches; a verifier reading AC-14 will flag it.
  *Adopted:* no — the plan follows AC-14.
- **R3 — Have both client tasks share the scaffolded `runs.page.*` namespace instead of T3 opening a
  second `multiAgent` namespace.** *Why better:* one namespace per feature; no duplicated
  "Multi-Agent Review" literal. *Cost:* `client/messages/en/runs.json` becomes a file two parallel
  implementers write — precisely the overwrite hazard root `INSIGHTS.md:49` warns about.
  *Adopted:* no. File-ownership safety wins; the duplication is two labels.
- **R4 — Fold the estimates read model into the new `modules/multi-agent/` module instead of
  `modules/agents/`.** *Why better:* one server module to reason about. *Cost:* it collapses wave 0
  into a single serial task and forces the estimate contract into `observability.ts`, which T1 is
  already editing. *Adopted:* no.
- **R5 — Add a `container.reviewService` getter at the composition root** (`server/src/platform/container.ts`,
  matching the `??=` pattern at `:95-101`) rather than letting `modules/multi-agent/routes.ts`
  construct `new ReviewService(container)` the way `modules/reviews/routes.ts` does.
  *Why better:* the onion `composition-root` rule prefers a single wiring site. *Cost:* it adds a
  shared file (`container.ts`) to T1's blast radius for zero behavioural gain, and diverges from the
  module's own precedent. *Adopted:* no — follow the existing precedent.
- **R6 — Follow-up (not this feature): widen `AgentColumnFinding` with `confidence`/`suggestion`** and
  drop the AC-17 client-side join, when the deferred Tabs mode is revisited. *Adopted:* no — the spec
  explicitly forbids the widening (`specs/…:509-514`).

---

## 6. Relevant Insights (top 3)

1. **Parallel implementers share one working tree — file ownership is the only collision safety.**
   root `INSIGHTS.md:49`: *"Parallel implementer agents share the working tree — collision safety is
   by file ownership, not isolation."* `implementer.md` deliberately omits `isolation: worktree`.
   → This is why §8's "Files owned" column is load-bearing and why the estimate contract goes in a
   **new** file (`contracts/estimates.ts`) rather than into `observability.ts` that T1 is editing.
2. **Two client nav registries do not auto-sync.** `client/INSIGHTS.md:167`: a new route/tab is *"NOT
   discoverable from its `page.tsx` alone"* — `NAV` in `client/src/vendor/ui/nav.ts:21-39` and the
   hardcoded `activeKeyFor` map in `client/src/components/app-shell/helpers.ts:26-43` are separate.
   → Here only **half** is missing: `helpers.ts:28` already returns `"multi-agent"`, and
   `client/messages/en/shell.json:26` already holds the label. `nav.ts` has no entry — T3 adds it with
   `key: "multi-agent"` so all three line up.
3. **The grounding gate silently drops seeded it-test findings.** `server/INSIGHTS.md:62`: *"Any
   it-test seeding a `Review` fixture with non-empty `findings` MUST pair it with a matching diff, or
   the findings vanish silently."*
   → T1's integration test must seed `reviews` + `findings` **directly through the repository/db**,
   never by driving a review run, or its column/conflict assertions will run against an empty set
   with no error.

**Also quoted into the task cards** (not counted in the top 3): `server/INSIGHTS.md:36` (drizzle-kit's
un-pipeable "created or renamed?" prompt), `:106-113` (three-file migration rollback), `:30`
(`reviews.runId` has no FK/unique index), `:201` (`insertFindings` mints its own uuid), `:64`
(cross-workspace 404 needs a real second workspace row, not a fake header), root `INSIGHTS.md:75`
(`.it.test.ts` flake — n ≥ 3 before blaming a diff), `:132` (whole-project `tsc` cross-talk between
parallel siblings), `:216` (verify dual-vendored edits by diffing added lines only),
`client/INSIGHTS.md:97` (`vi.mock` the hook module, no `QueryClientProvider`), `:99`
(`@testing-library/user-event` is **not** installed — use `fireEvent`), `:35,39` (jsdom has no
`scrollIntoView`), `client/INSIGHTS.md:123` (one locale ⇒ "sync every locale" is one file).

---

## 7. Architecture Changes

### server (onion layers)

**Infrastructure — db**
- `server/src/db/schema/runs.ts:8-38` — add one nullable column to `agentRuns`:
  `multiAgentRunId` uuid, `.references(() => multiAgentRuns.id, { onDelete: 'set null' })`, placed
  next to the existing `prId` FK (`:14`). Copy the FK style verbatim from `:10-12`. `multiAgentRuns`
  (`:48-57`) is **unchanged** — it already has everything the read model needs.
- `server/src/db/migrations/0017_*.sql` + `meta/0017_snapshot.json` + `meta/_journal.json` (append
  `idx: 17` after the existing `idx: 16` entry at `_journal.json:117-123`) — generated by
  `pnpm db:generate`, then applied by `pnpm db:migrate` (migrations are **not** applied on boot).

**Infrastructure — transport**
- `server/src/modules/multi-agent/routes.ts` (**new**) — a Fastify plugin registering exactly two
  routes, both obtaining the workspace via `getContext(container, req)`
  (`server/src/modules/_shared/context.ts:14-23`):
  - `POST /pulls/:id/multi-agent-runs` — body `{ agentIds: string[] }` (min 1); per-route
    `{ rateLimit: { max: 10, timeWindow: '1 minute' } }` copied from `reviews/routes.ts:33` (AC-26).
  - `GET /pulls/:id/multi-agent-runs/latest` — response `MultiAgentRun.nullable()`, no rate-limit
    override (precedent for a nullable 200: `reviews/routes.ts:161`).
  The param **must** be named `:id` to match the existing `/pulls/:id/*` family (`reviews/routes.ts`),
  or find-my-way throws at boot.
- `server/src/modules/index.ts` — register the new plugin (one line, alongside the existing modules).
- `server/src/modules/agents/routes.ts` (**edit**, near the `GET /agents` handler at `:85-88`) —
  add `GET /agents/estimates` with a required `repoId` uuid query param, response
  `z.array(AgentEstimate)`. A **static** segment, so find-my-way prefers it over `/agents/:id`; do
  **not** put it under `/repos/:id/…` (the repos module already owns `/repos/:repoId/…`, and a
  differing param name at the same position is a boot-time error).

**Application — services / repositories**
- `server/src/modules/multi-agent/repository.ts` (**new**) — `createMultiRun`, `latestMultiRunForPr`
  (order by `ranAt` desc, limit 1, scoped by `workspaceId` + `prId`), and the read-model gather:
  linked `agent_runs` → their `reviews` → their `findings`. All queries take `workspaceId` (AC-25).
- `server/src/modules/multi-agent/grouping.ts` (**new**) — pure, I/O-free, no framework import:
  `buildConflicts(columns) → Conflict[]`. Bucket key is the literal string pair `(file, start_line)`
  over `done` columns only; group title chosen by severity rank (CRITICAL > WARNING > SUGGESTION, per
  `contracts/findings.ts:11-12`) then by finding id; takes = one per `done` column, `ignored` when
  that column has no finding in the bucket; output sorted by `(file, line)` so it is byte-identical
  across input orders (AC-20, AC-21, AC-24, AC-24a).
- `server/src/modules/multi-agent/service.ts` (**new**) — `createMultiRun(workspaceId, prId, agentIds)`:
  insert the `multi_agent_runs` row, resolve the agent rows through the existing
  `ReviewService.resolveTargets` (new `agentIds` branch — workspace-scoped `getById` gives AC-25 for
  free), then call the **unchanged** `runReview` fan-out passing the new multi-run id;
  `latestForPr(workspaceId, prId)` composes the `MultiAgentRun` read model and delegates to
  `buildConflicts`.
- `server/src/modules/reviews/service.ts:52-63` (**edit**) — `resolveTargets` gains an
  `agentIds?: string[]` branch beside the existing `agentId`/`all` branches; unknown id ⇒ the existing
  `NotFoundError`.
- `server/src/modules/reviews/service.ts:109-145` (**edit**) — `runReview` gains an optional
  `multiAgentRunId` and threads it into the up-front `createAgentRun` loop at `:126-133`. The
  signature stays backward-compatible so `POST /pulls/:id/review` and the MCP tool are untouched.
- `server/src/modules/reviews/repository.ts:166-176` and
  `server/src/modules/reviews/repository/run.repo.ts:117-143` (**edit**) — `createAgentRun` accepts and
  inserts the optional `multiAgentRunId`. Linking at insert time (not a follow-up UPDATE) keeps the
  row atomic and cannot leave an orphan column.
- `server/src/modules/agents/repository.ts` (**edit**, near `list` at `:84-86`) — add
  `runEstimates(workspaceId, repoId)`: `agent_runs` INNER JOIN `pull_requests` ON
  `pull_requests.id = agent_runs.pr_id`, filtered by `agent_runs.workspaceId`,
  `pull_requests.repoId` (`server/src/db/schema/pulls.ts:12`) and `agent_runs.status = 'done'`,
  grouped by `agentId`, selecting `avg(durationMs)`, `avg(costUsd)`, `count(*)`. The inner join
  excludes runs whose PR was deleted (`prId` is `set null`, `runs.ts:14`) — correct, since such a run
  has no repo.
- `server/src/modules/agents/service.ts` (**edit**, near `list` at `:58-62`) — `estimates(workspaceId, repoId)`
  maps repo rows to `AgentEstimate` (null means "no history").

**Domain — contracts (dual-vendored, two-file edits)**
- `server/src/vendor/shared/contracts/observability.ts` **and**
  `client/src/vendor/shared/contracts/observability.ts` (**identical edits**, owned by T1):
  - `:41` `status: z.enum(['done', 'failed', 'running'])` → add the `'cancelled'` literal. **This is
    the only change to an existing field in the whole feature.**
  - append `CreateMultiRunBody` (`{ agentIds: z.array(z.string().uuid()).min(1) }` — camelCase
    request, matching the existing `POST /pulls/:id/review` body convention) and
    `CreateMultiRunResponse` (`{ multi_run_id, pr_id, runs: z.array(ReviewRunTarget) }` — snake_case
    response, matching `observability.ts`; import `ReviewRunTarget` from `./review-api.js:45-49`
    rather than redeclaring it).
  - `AgentColumnFinding` (`:23-31`) is **NOT widened** — spec decision.
- `server/src/vendor/shared/contracts/estimates.ts` **and**
  `client/src/vendor/shared/contracts/estimates.ts` (**new**, identical, owned by T2) —
  `AgentEstimate = { agent_id, avg_duration_ms: number|null, avg_cost_usd: number|null, sample_size: int }`.
  A new file is the house convention: `index.ts:14-15` states *"The barrel is stable — feature agents
  EXTEND with new files, they do not edit existing ones."*
- `server/src/vendor/shared/index.ts` **and** `client/src/vendor/shared/index.ts` (**edit**, owned by
  T2) — one `export * from './contracts/estimates.js';` line each. These two files are byte-identical
  today; keep them so.

**Not changed:** `reviewer-core/` (nothing imported from it — the exact-key grouping needs no overlap
primitive), `server/src/platform/container.ts`, `run-executor.ts`, the SSE/`RunBus` machinery,
`POST /findings/:id/(accept|dismiss)`, `e2e/`.

### client (layered: `vendor`/`lib` → `features` → `app`)

- **`lib/hooks/multi-agent.ts`** (**new**, T3) — `useAgentEstimates(repoId)` (query key
  `["agent-estimates", repoId]`, `retry: false` so AC-10 degrades fast) and `useCreateMultiRun()`
  (mutation → `POST /pulls/:id/multi-agent-runs`). Follows the `lib/hooks/agents.ts:8-13` /
  `reviews.ts:124-136` shape; all fetches go through `api` (`client/src/lib/api.ts:65-74`), never
  `fetch` in a component.
- **`lib/hooks/multi-agent-runs.ts`** (**new**, T4) — `useLatestMultiRun(prId)`, query key
  `["multi-agent-run", prId]`, self-clearing `refetchInterval` (poll ~4 s **only** while some column
  is non-terminal, then `false`) — the exact pattern of `usePrActiveRuns` (`reviews.ts:28-35`) and
  `usePrRuns` (`reviews.ts:40-48`).
- **`features/multi-agent/`** (**new**, T3) — the pieces both entry points share (client
  `CLAUDE.md`: two consumers ⇒ `features/`, not route-local `_components/`): the agent checkbox list
  with per-agent hints, and a pure `helpers.ts` implementing the AC-8/AC-9 summary (MAX time, SUM
  cost, `approximate` flag, no numbers when every selection is history-less).
- **`app/repos/[repoId]/pulls/[number]/`** (T3) — `_components/MultiAgentPicker/` replaces
  `_components/RunReviewDropdown/` (deleted); the swap point is `PrDetailHeader.tsx:5` (import) and
  `:92-99` (render). `page.tsx:153-162` is adjusted only if the callback props change shape —
  `onRunStart`/`onRunsStarted` lose their meaning now that the click navigates away.
- **`app/repos/[repoId]/multi-agent/page.tsx` + `_components/`** (**new**, T3) — Configure-run page.
  PR selection mirrors the existing `usePulls(repoId)` → find-by-number pattern
  (`pulls/[number]/page.tsx:35-36`; the list precedent is `pulls/page.tsx:130`).
- **`app/repos/[repoId]/multi-agent/[number]/page.tsx` + `_components/`** (**new**, T4) — results page:
  a thin `page.tsx` resolving `number → prId` via `usePulls` exactly as `pulls/[number]/page.tsx:35-36`
  does, composing `AgentColumns`, a `FindingDetailPanel` (a thin wrapper that joins
  `AgentColumnFinding.id` against `usePrReviews(prId)` → `ReviewRecord.findings[]` and renders the
  **existing** `FindingCard`), and `DisagreementBlock`.
  **View-trace (AC-15) is a link to `/repos/{repoId}/pulls/{number}?trace={run_id}`** — the PR page
  already reads `?trace=` and opens `RunTraceDrawer` (`pulls/[number]/page.tsx:61,219-227`). This
  reuses the drawer with **zero** cross-route `_components/` import, which the client layering rules
  forbid.
- **`vendor/ui/nav.ts:21-39`** (T3) — add `{ key: "multi-agent", label: "Multi-Agent Review",
  icon: <existing IconName>, href: "/repos/:repoId/multi-agent" }` to the WORKSPACE group (it is
  repo-scoped, and `resolveHref` at `:74-77` fills `:repoId`). `key` **must** be `"multi-agent"` to
  match `helpers.ts:28` and `shell.json:26`.
- **i18n** — one locale only (`client/messages/en/`, `client/INSIGHTS.md:123`), and the loader globs
  the directory (`client/src/i18n/request.ts:17-25`: *"Feature agents add their own
  `messages/en/<feature>.json` without touching shared code — no contention"*). T4 extends the
  scaffolded `runs.json`; T3 adds a new `multiAgent.json`. No config change either way.

---

## 8. Parallelizable Tasks

Four tasks, two waves. **Wave 0 → Wave 1 is a hard barrier**: every wave-1 task consumes contracts
and routes produced in wave 0. Within a wave the file sets are disjoint; that is the only thing
preventing overwrite (root `INSIGHTS.md:49`).

| Task | Module | Files owned (with `file:line` anchors) | Skills to apply | Acceptance criteria | Tests to run | Depends-on | Batch |
|------|--------|----------------------------------------|-----------------|---------------------|--------------|------------|-------|
| **T1 — Multi-run persistence, create path, read model & conflict grouping** **[shared: two-file edit]** | server (+ client vendor mirror) | **Edit:** `server/src/db/schema/runs.ts:8-38` (add `multiAgentRunId` beside `prId:14`, FK style copied from `:10-12`); `server/src/modules/index.ts` (register plugin, 1 line); `server/src/modules/reviews/service.ts:52-63` + `:109-145`; `server/src/modules/reviews/repository.ts:166-176`; `server/src/modules/reviews/repository/run.repo.ts:117-143`; `server/src/vendor/shared/contracts/observability.ts:23-86` **AND** `client/src/vendor/shared/contracts/observability.ts:23-86` (identical). **New:** `server/src/db/migrations/0017_*.sql`, `server/src/db/migrations/meta/0017_snapshot.json`, `server/src/db/migrations/meta/_journal.json` (append after `:117-123`); `server/src/modules/multi-agent/{repository.ts,grouping.ts,grouping.test.ts,service.ts,routes.ts,multi-agent.it.test.ts}`. **NOT owned:** `server/src/platform/container.ts`, `server/src/vendor/shared/index.ts`, `client/src/vendor/shared/index.ts`, anything under `server/src/modules/agents/`, anything under `client/src/app|lib|features`. | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `postgresql-table-design`, `zod`, `typescript-expert`, `security` | See **T1 criteria** below | `cd server && pnpm db:generate` → **verify the emitted SQL says `ADD COLUMN`** and that no interactive prompt appears (`server/INSIGHTS.md:36`); `cd server && pnpm db:migrate`; `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `cd server && pnpm exec vitest run .it.test`; `cd server && pnpm typecheck` (**server closer**: authoritative whole-server green) | — | — (never batch a shared-contract two-file edit) |
| **T2 — Pre-run estimates read model** **[shared: two-file edit]** | server (+ client vendor mirror) | **New:** `server/src/vendor/shared/contracts/estimates.ts` **AND** `client/src/vendor/shared/contracts/estimates.ts` (identical); `server/src/modules/agents/estimates.it.test.ts`. **Edit:** `server/src/vendor/shared/index.ts:18-28` **AND** `client/src/vendor/shared/index.ts` (one `export *` line each, keep byte-identical); `server/src/modules/agents/repository.ts` (add near `list` `:84-86`); `server/src/modules/agents/service.ts` (add near `list` `:58-62`); `server/src/modules/agents/routes.ts` (add near `GET /agents` `:85-88`). **NOT owned:** `contracts/observability.ts` (either copy), `server/src/modules/multi-agent/**`, `server/src/db/schema/**`, `server/src/db/migrations/**`, `server/src/modules/reviews/**`. | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `typescript-expert`, `security` | See **T2 criteria** below | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `cd server && pnpm exec vitest run .it.test`; `cd server && pnpm typecheck` (**grep the `tsc` output for your own filenames only** — T1 is editing the same project concurrently; root `INSIGHTS.md:132`) | — | — (shared-contract two-file edit) |
| **T3 — Agent picker on the PR page + Configure-run page + nav** | client | **New:** `client/src/lib/hooks/multi-agent.ts`; `client/src/features/multi-agent/components/AgentPickList.tsx` + `AgentPickList.test.tsx`; `client/src/features/multi-agent/helpers.ts` + `helpers.test.ts`; `client/src/app/repos/[repoId]/pulls/[number]/_components/MultiAgentPicker/MultiAgentPicker.tsx` + `MultiAgentPicker.test.tsx`; `client/src/app/repos/[repoId]/multi-agent/page.tsx` + `client/src/app/repos/[repoId]/multi-agent/_components/**`; `client/messages/en/multiAgent.json`. **Edit:** `client/src/vendor/ui/nav.ts:21-39`; `client/src/app/repos/[repoId]/pulls/[number]/_components/PrDetailHeader/PrDetailHeader.tsx:5,92-99`; `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:153-162` (only if callback props change). **Delete:** `client/src/app/repos/[repoId]/pulls/[number]/_components/RunReviewDropdown/` (all 4 files incl. `RunReviewDropdown.test.tsx`). **NOT owned:** `client/messages/en/runs.json`, `client/messages/en/shell.json`, `client/src/components/app-shell/helpers.ts`, `client/src/lib/hooks/reviews.ts`, `client/src/lib/api.ts`, `client/src/app/repos/[repoId]/multi-agent/[number]/**`, `FindingCard/**`, either `vendor/shared/**` tree. | `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `typescript-expert` | See **T3 criteria** below | `cd client && pnpm test`; `cd client && pnpm typecheck` (grep for your own filenames — T4 runs concurrently) | T1, T2 | — (large scope; keep solo) |
| **T4 — Multi-Agent Review results page: columns, finding detail, disagreement block** | client | **New:** `client/src/lib/hooks/multi-agent-runs.ts`; `client/src/app/repos/[repoId]/multi-agent/[number]/page.tsx`; `client/src/app/repos/[repoId]/multi-agent/[number]/_components/AgentColumns/**`; `.../\_components/AgentColumnCard/**`; `.../\_components/FindingDetailPanel/**`; `.../\_components/DisagreementBlock/**` (each with a colocated `*.test.tsx`). **Edit:** `client/messages/en/runs.json:10-15` (`conflicts` block) and `:110-134` (`page` block) — **append/extend only, never remove a key** (`RunTraceDrawer` and its subtree consume this namespace: `RunTraceDrawer.tsx:44`, `PromptBlock.tsx:24`, `TraceBody.tsx:20`, `ToolCallRow.tsx:11`, `PromptModalBody.tsx:35`, `FindingsSection.tsx:19`). **NOT owned:** `client/messages/en/multiAgent.json`, `client/src/app/repos/[repoId]/multi-agent/page.tsx`, `client/src/app/repos/[repoId]/multi-agent/_components/**`, `client/src/features/multi-agent/**`, `client/src/lib/hooks/{reviews,multi-agent}.ts`, `client/src/lib/api.ts`, `FindingCard/**`, `RunTraceDrawer/**`, `client/src/vendor/ui/nav.ts`, either `vendor/shared/**` tree. | `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `typescript-expert`, `security` | See **T4 criteria** below | `cd client && pnpm test`; `cd client && pnpm typecheck` (**client closer**: after T3 also reports done, re-run both for the authoritative whole-client green) | T1, T2 | — (large scope; keep solo) |

### T1 criteria (discharges AC-3 server half, AC-6 server half, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16 server half, AC-20, AC-21 server half, AC-24, AC-24a, AC-25, AC-26)

1. `agentRuns` gains a **nullable** `multiAgentRunId` uuid FK → `multiAgentRuns.id`,
   `onDelete: 'set null'`. Every pre-existing row keeps `NULL` and is never shown on the new page.
   Verify the generated SQL contains `ADD COLUMN` and **no** `DROP`/rename (`server/INSIGHTS.md:36`).
   If `pnpm db:generate` opens the interactive "created or renamed?" prompt, abort and roll back per
   the three-file recipe at `server/INSIGHTS.md:106-113` (delete the `.sql`, delete
   `meta/000X_snapshot.json`, hand-edit `meta/_journal.json`) — do **not** leave a half-generated
   migration behind. **(AC-11)**
1b. **The same migration adds a PLAIN index on `agent_runs.multi_agent_run_id`** — Recommendation R1,
   **adopted by owner decision (2026-07-21)**, overriding §5's "Adopted: no". `agent_runs` has zero
   indexes today (`server/src/db/schema/runs.ts:8-38`) and both the multi-run read model and the T2
   estimate aggregate scan it; the non-functional p95 of 500 ms has no headroom without this. Use a
   plain `index()` — **never a partial index**: `drizzle-kit` emits an unbound `$1` placeholder for a
   partial predicate built with `eq()`, which blows up at `db:migrate` time (`server/INSIGHTS.md:34`).
   One `index()` call in the schema, one extra line of generated SQL, same `0017_*` migration.
2. `POST /pulls/:id/multi-agent-runs` inserts one `multi_agent_runs` row, launches exactly the
   requested agent set through the **unchanged** `runReview` fan-out, and every launched `agent_run`
   row carries the new multi-run id **at insert time** (threaded through `createAgentRun`, not a
   follow-up UPDATE). Response: `{ multi_run_id, pr_id, runs: [{run_id, agent_id, agent_name}] }`.
   An empty or missing `agentIds` is rejected with a 400 by the Zod body schema. **(AC-3, AC-6, AC-11)**
3. The route param is literally `:id`, matching the existing `/pulls/:id/*` family in
   `server/src/modules/reviews/routes.ts`. A differing param name at the same position makes
   find-my-way throw **at boot** — an it-test that merely boots the app catches this. **(AC-3)**
4. The create route declares `{ rateLimit: { max: 10, timeWindow: '1 minute' } }`, copied verbatim
   from `reviews/routes.ts:33`; the read route declares **no** rate-limit override. **(AC-26)**
5. Both routes call `getContext(container, req)`
   (`server/src/modules/_shared/context.ts:14-23`) and pass `workspaceId` into **every** query.
   A PR or multi-run belonging to another workspace resolves as 404, never as another workspace's
   data. The it-test proving this seeds a **real second `workspaces` row** — a fake auth header does
   nothing, `LocalNoAuthProvider` ignores it (`server/INSIGHTS.md:64`). **(AC-25)**
6. `GET /pulls/:id/multi-agent-runs/latest` returns the most recent `multi_agent_runs` row for the PR
   by `ranAt` (limit 1) as a `MultiAgentRun`, or **`null` with a 200** when the PR has none — the null
   case AC-14 accepts (nullable-200 precedent: `reviews/routes.ts:161`). Creating a second multi-run
   flips the response to the newer one and **deletes nothing**; the earlier multi-run's `agent_runs`
   remain readable by `listRunsForPull` (`run.repo.ts:40-69`). **(AC-13, AC-14)**
7. Each `AgentColumn` carries `run_id, agent_id, agent_name, provider, model, status, verdict, score,
   summary, duration_ms, cost_usd, findings[]`. `provider`/`model`/`duration_ms`/`cost_usd`/`status`
   come from `agent_runs` (`runs.ts:21-28`); `verdict`/`summary`/`score`/`findings` come from the run's
   review. Because `reviews.runId` has **no FK and no unique index** (`server/INSIGHTS.md:30`), pick the
   run's most recent review with `kind === 'review'`, falling back to the most recent of any kind, and
   render null/empty when there is none (§4 Q2). `findings` are mapped to `AgentColumnFinding`
   (`observability.ts:23-31`) and the shape is **not widened**. **(AC-15)**
8. `agent_runs.status` is free-form `text()` (`runs.ts:28`). Map `done`/`failed`/`cancelled`/`running`
   through and **everything else, including null, to `running`** — an unmapped literal makes
   `fastify-type-provider-zod` fail response serialisation with a 500. `cancelled` is a terminal
   non-`done` status: it appears in the column but contributes **no** conflict take. **(AC-16, AC-15)**
9. `MultiAgentRun.total_duration_ms` is the **MAX** of the columns' `duration_ms` (not the sum) and is
   `0` — never null — when no column has a duration; `total_cost_usd` is the SUM across columns and is
   `null` when no cost was captured; `agent_count` = number of columns. **(AC-14)**
10. `buildConflicts` in `grouping.ts` is a **pure** function (no db, no fetch, no `process.env`, no
    framework import) that buckets findings by the exact string key `(file, start_line)` using a plain
    `Map`. **No** range/overlap logic, **no** threshold, **no** title/kind matching, **no** model call,
    and **no** import from `reviewer-core` or `modules/eval`. Only findings from `done` columns form
    buckets (§4 Q10). **(AC-20, AC-12)**
11. Determinism: `Conflict.line` = the bucket's `start_line`; `Conflict.title` = the member finding
    chosen first by severity rank (CRITICAL > WARNING > SUGGESTION, `contracts/findings.ts:11-12`) then
    by finding id ascending; the `Conflict[]` array and each `takes[]` array are sorted by a stable key.
    A unit test **shall** shuffle the input findings and assert the output is deeply equal — this is
    AC-20's and AC-24a's actual observable. **(AC-20, AC-24a)**
12. A group carries exactly one `ConflictTake` per **`done`** column: `verdict` = that agent's finding
    severity in the bucket, or the literal `'ignored'` when it has none. Columns in
    `running`/`failed`/`cancelled` contribute **no take at all**. `persona` = the column's `agent_name`;
    `note` = the member finding's title for a flagging take and `""` for `ignored` (§4 Q1). A `done`
    agent with zero findings contributes `ignored` in every group. **(AC-21, AC-24)**
13. The read model is a pure overlay: it performs **no** write, merges no findings, reassigns no
    finding to a different agent, and drops none. Per-agent findings counts before and after grouping
    are identical. **(AC-12)**
14. Contract edit is applied **identically to both vendored copies**
    (`server/src/vendor/shared/contracts/observability.ts` and
    `client/src/vendor/shared/contracts/observability.ts`, byte-identical today). Verify with
    `git diff <file> | grep '^+'` on each and compare the added lines — do **not** expect the trees to
    be identical overall (5 other files already differ). Root `INSIGHTS.md:216`,
    `client/AGENTS.md:145-147`. `AgentColumnFinding` is **not** widened. Do **not** touch
    `vendor/shared/index.ts` (T2 owns it).
15. Integration test seeds `reviews` + `findings` **directly through the repository/db**, never by
    driving a live review run — a seeded finding whose lines do not intersect an injected diff hunk is
    silently dropped by the grounding gate with no error (`server/INSIGHTS.md:62`). Do not hardcode
    fixture finding ids in assertions: `insertFindings` mints its own uuid (`server/INSIGHTS.md:201`).
    If an `.it.test.ts` fails, re-run it in isolation **n ≥ 3** before attributing it to this diff —
    that family flakes under load (root `INSIGHTS.md:75`, `server/INSIGHTS.md:205`).
16. `resolveTargets` (`reviews/service.ts:52-63`) gains an `agentIds?: string[]` branch that resolves
    each id through the workspace-scoped `agents.getById` and throws the existing `NotFoundError` for
    an unknown id. The `agentId` and `all` branches are unchanged, and
    `POST /pulls/:id/review` keeps its current behaviour (the MCP `run_agent_on_pr` tool depends on it).
17. `server/src/platform/container.ts` is **not** edited — the new module constructs
    `new ReviewService(container)` the way `modules/reviews/routes.ts` already does.

### T2 criteria (discharges AC-7 server half, AC-10 server half, AC-25 estimates route)

1. `GET /agents/estimates?repoId=<uuid>` returns `AgentEstimate[]`, one entry per agent with history.
   `repoId` is a required uuid query param validated by Zod. The route is a **static** segment so
   find-my-way prefers it over `/agents/:id`; do **not** register it under `/repos/:id/…` (the repos
   module owns `/repos/:repoId/…` and a different param name at the same position is a boot-time
   error). **(AC-7)**
2. `avg_duration_ms` = mean `durationMs` over that agent's `agent_runs` with `status = 'done'`, scoped
   to `workspaceId` **and** to the repo via INNER JOIN `pull_requests` ON
   `pull_requests.id = agent_runs.pr_id` filtered by `pull_requests.repoId`
   (`server/src/db/schema/pulls.ts:12`) — `agent_runs` has **no** `repoId` column
   (`server/src/db/schema/runs.ts:8-38`). Failed/cancelled/running runs are excluded. **(AC-7)**
3. `avg_cost_usd` = mean over the subset of those `done` runs with a **non-null** `costUsd`, and is
   `null` when that subset is empty. `sample_size` = the count of `done` runs contributing to the
   duration mean. An agent with no `done` run in the repo yields **either** no row **or** a row with
   both averages `null` — never `0` (§4 Q9). **(AC-7, AC-9)**
4. This is a **separate endpoint** from `GET /agents` (`agents/routes.ts:85-88`) and that handler is
   left untouched, so an estimate failure cannot block listing or selecting agents. **(AC-10)**
5. The route calls `getContext(container, req)` (`_shared/context.ts:14-23`) and scopes every query by
   `workspaceId`; a `repoId` from another workspace yields an empty list, never another workspace's
   numbers. The cross-workspace test seeds a **real second `workspaces` row**
   (`server/INSIGHTS.md:64`). **(AC-25)**
6. The aggregate arithmetic is covered by a deterministic test over a fixed set of seeded runs — this
   is one of the few things the spec says **is** safe to assert exactly (`specs/…:396-401`). Assert no
   exact model output, no exact cost of a live run.
7. `contracts/estimates.ts` is created **identically** in both vendored trees and each
   `vendor/shared/index.ts` gains one `export *` line; those two barrels are byte-identical today —
   keep them so. Verify with `git diff <file> | grep '^+'` on all four files
   (root `INSIGHTS.md:216`). Do **not** touch `contracts/observability.ts` (T1 owns both copies).

### T3 criteria (discharges AC-1, AC-2, AC-3 client half, AC-4, AC-5, AC-6, AC-7 rendering, AC-8, AC-9, AC-10 client half)

1. The PR page renders one checkbox per agent in place of the old dropdown, plus a per-agent time
   hint, a **Clear** action, a **Configure-agents** link to `/agents` (the affordance
   `RunReviewDropdown.tsx` provided), and a primary button reading
   `Run multi-agent review (N)` where N is the checked count. The swap point is
   `PrDetailHeader.tsx:5` (import) and `:92-99` (render) — the dropdown is **not** rendered by
   `page.tsx`. **(AC-1)**
2. With zero boxes checked the button is `disabled`, carries `aria-disabled="true"` and an accessible
   name, and its label reads `(0)`; checking one enables it and the label reads `(1)`. Status and
   score are conveyed as **text**, never colour alone (`specs/…:370-375`). **(AC-2)**
3. Clicking the button with N ≥ 1 issues **exactly one** create-multi-run request carrying the N
   checked agent ids and then navigates to `/repos/{repoId}/multi-agent/{number}`. It never runs a
   review inline on the PR page. **(AC-3)**
4. `RunReviewDropdown/` is deleted in full — component, `constants.ts`, `styles.ts`, and
   `RunReviewDropdown.test.tsx` (its single assertion, `RunReviewDropdown.test.tsx:29-32`, goes with
   it). The `useRunReview` hook (`client/src/lib/hooks/reviews.ts:124-136`) and the
   `POST /pulls/:id/review` route **stay** — the MCP tool uses them. Do not edit `lib/hooks/reviews.ts`.
5. Configure-run page at `/repos/[repoId]/multi-agent`: before a PR is picked it shows the
   "Pick a pull request first" empty state and renders **neither** the agent list **nor** any summary
   estimate. **(AC-4)**
6. After a PR is picked each agent row shows a one-line description and a `"Ns · $X"` hint; a
   **Select-all** control is present; the run button renders with an adjacent summary estimate.
   PR selection reuses `usePulls(repoId)` and the number → uuid resolution of
   `pulls/[number]/page.tsx:35-36`. **(AC-5)**
7. Running from the Configure-run page issues the **same** mutation and lands on the **same** route as
   AC-3 — one shared hook, one shared agent-list component in `features/multi-agent/`, used by both
   entry points. **(AC-6)**
8. An agent with `avg_duration_ms`/`avg_cost_usd` `null` (or with no row at all) renders its hint as
   the literal `—`, never `0s` and never `$0`. **(AC-7)**
9. Summary estimate: time = **MAX** of the selected agents' time hints, cost = **SUM** of the selected
   agents' cost hints; agents without history are excluded from the cost sum and their presence sets an
   **approximate** marker on the summary. Implemented as a pure function in
   `features/multi-agent/helpers.ts` with its own unit test over fixed inputs. **(AC-8)**
10. When **every** selected agent lacks history the summary renders with **no** numeric time and **no**
    numeric cost (parallel-fan-out copy only), never a fabricated or zero estimate, and never crashes.
    **(AC-9)**
11. When the estimates query fails, agents remain checkable, the run button still works, and every hint
    reads `—`. Use `retry: false` on that query so the degraded state appears immediately. **(AC-10)**
12. `client/src/vendor/ui/nav.ts:21-39` gains one WORKSPACE item with **`key: "multi-agent"`** and
    `href: "/repos/:repoId/multi-agent"` (`resolveHref` at `:74-77` fills `:repoId`). Do **not** edit
    `client/src/components/app-shell/helpers.ts` — `:28` already returns `"multi-agent"` — and do
    **not** edit `client/messages/en/shell.json` — `:26` already holds the label. The key must match
    both. **(AC-1, AC-4)**
13. All new strings live in a **new** `client/messages/en/multiAgent.json` namespace consumed via
    `useTranslations("multiAgent")`. Do **not** read from or write to `client/messages/en/runs.json`
    (T4 owns it). One locale exists (`client/INSIGHTS.md:123`), and the loader globs the directory
    (`client/src/i18n/request.ts:17-25`) — no config change needed. No hard-coded user-facing literal.
14. No `fetch()` in a component or page — everything through `lib/hooks/multi-agent.ts` → the `api`
    helper (`client/src/lib/api.ts:65-74`). Contract types come from `@devdigest/shared`; never
    redefine an API type locally.
15. Tests: `vi.mock` the `lib/hooks/*` module rather than standing up a `QueryClientProvider`
    (`client/INSIGHTS.md:97`). Use `fireEvent` — **`@testing-library/user-event` is not installed**
    (`client/INSIGHTS.md:99`). Stub `Element.prototype.scrollIntoView = vi.fn()` per test file if any
    component scrolls (`client/INSIGHTS.md:35,39`).
16. Navigating to `/repos/{repoId}/multi-agent/{number}` will 404 until T4 lands in the same wave.
    That is expected — do **not** create that route or any file under it.

### T4 criteria (discharges AC-12 client half, AC-13 client half, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-21 rendering, AC-22, AC-23, AC-24 rendering)

1. Results page at `/repos/[repoId]/multi-agent/[number]`, keyed by PR: resolve `number → prId` via
   `usePulls(repoId)` exactly as `pulls/[number]/page.tsx:35-36` does, then read the latest multi-run.
   Header shows `N selected agents · parallel`, the PR title, the summary line
   (`N agents · fan-out via worktrees · <total time> · <total cost>`, per AC-14 — note the scaffolded
   value at `client/messages/en/runs.json:120` currently reads "p-queue"; update the **value**, keep
   the key), and a **Configure-run** control linking to `/repos/{repoId}/multi-agent`.
   There is **no** display-mode toggle — do not build one, and leave the unused
   `runs.page.view.columns/tabs` keys in place. **(AC-14)**
2. When the read returns `null` (PR has no multi-run yet), render the scaffolded first-run empty state
   (`runs.page.noRun`), **not** a 404 and not a blank area. **(AC-14 null case)**
3. One column per agent. Each header shows status, score (blank when `null`, never `0`), duration,
   cost, findings count, and a **View-trace** link. The trace link navigates to
   `/repos/{repoId}/pulls/{number}?trace={run_id}` — the PR page already reads `?trace=` and opens
   `RunTraceDrawer` (`pulls/[number]/page.tsx:61,219-227`). Do **not** import `RunTraceDrawer` across
   route folders; `_components/` is route-local by convention. **(AC-15)**
4. Live status: `useLatestMultiRun(prId)` polls (~4 s) **only** while some column is non-terminal and
   stops on its own once all are terminal — the self-clearing pattern of `usePrActiveRuns`
   (`client/src/lib/hooks/reviews.ts:28-35`) and `usePrRuns` (`:40-48`). A running column transitions
   to `done`/`failed`/`cancelled` **without a manual refresh**. Optionally overlay
   `useRunEvents(runningRunIds)` (`reviews.ts:168-215`) filtered on `ev.runId`
   (`contracts/trace.ts:22`) as a per-column activity line; that hook exposes **no** status/score/cost,
   so it must never be the status source. **(AC-16)**
5. Opening a finding in a column renders the **existing** `FindingCard`
   (`.../pulls/[number]/_components/FindingCard/FindingCard.tsx`) — do **not** build a new detail view.
   `FindingCard` requires a full `FindingRecord`, while `AgentColumnFinding` is a subset
   (`observability.ts:23-31`, deliberately not widened). Obtain the full record by a **client-side join
   on `id`** against `usePrReviews(prId)` (`reviews.ts:51-57`) → `ReviewRecord.findings[]`. If the
   reviews payload has not loaded or the id is absent, render a loading/fallback state — never crash.
   A `null` `suggestion` already renders as an empty-suggestion state (`FindingCard.tsx:123-130`).
   **(AC-17)**
6. Accept/Dismiss go through the existing `useFindingAction()` (`reviews.ts:139-161`) →
   `POST /findings/:id/(accept|dismiss)`. The action targets exactly one finding id; a co-located
   finding from a different agent is untouched and its column's count is unchanged. The hook already
   invalidates `["reviews", prId]`, which is the same cache the AC-17 join reads, so the new state
   renders without a manual refresh. **(AC-18, AC-12)**
7. `FindingCard` exposes **one** unified optional handler
   `onAction?: (action: FindingCardAction, reply?: string) => void` (`FindingCard.tsx:35,37-60`), not
   per-action props. Pass a handler that acts **only** on `"accept"` and `"dismiss"` and returns
   immediately for `"seed_eval_case"`, `"learn"` and anything else — no request, no state change, no
   toast. Do **not** modify `FindingCard`. **(AC-19)**
8. The "Where agents disagree" block renders the server-computed `conflicts[]` **as-is**: it performs
   no grouping, no re-bucketing and no re-sorting. Each group shows one row per take — a severity for a
   flagging agent and the `did not flag` label (scaffolded at `client/messages/en/runs.json:10-15`) for
   an `ignored` take. Agents with no take (still running, failed, cancelled) are shown as
   pending/absent, **never** as "did not flag". **(AC-21, AC-24, AC-12)**
9. **Show only conflicts** toggle: a group is a conflict when its takes contain at least one `ignored`
   **or** at least two distinct non-`ignored` severities. `Conflict` carries no `is_conflict` field and
   the contract must not be widened, so this predicate lives client-side as a pure, unit-tested helper.
   Unanimous groups are hidden while the toggle is on. The toggle is keyboard-operable and labelled.
   **(AC-22)**
10. With the toggle on and no conflict groups, render the explicit scaffolded empty state
    (`runs.conflicts.empty`), never a blank area. **(AC-23)**
11. The block recomputes as the poll delivers newly-completed agents — no manual refresh, no stale
    "did not flag" for an agent that was running a moment ago. **(AC-24)**
12. A second multi-run for the same PR makes the page show the newer one on the next read; the page
    itself deletes nothing and shows no history browser (out of scope). **(AC-13)**
13. i18n: extend the **existing** `client/messages/en/runs.json` (`conflicts` block `:10-15`, `page`
    block `:110-134`) and consume via `useTranslations("runs")`. **Append/extend only — never remove or
    rename an existing key**: `RunTraceDrawer` and its whole subtree read this namespace
    (`RunTraceDrawer.tsx:44`, `PromptBlock.tsx:24`, `TraceBody.tsx:20`, `ToolCallRow.tsx:11`,
    `PromptModalBody.tsx:35`, `FindingsSection.tsx:19`). Do **not** create or read
    `client/messages/en/multiAgent.json` (T3 owns it). No hard-coded user-facing literal — "did not
    flag", "approximate", empty states and status labels are all keys.
14. Model-authored text (finding titles, summaries, rationales, suggestions) is rendered as escaped JSX
    text; nothing reaches `dangerouslySetInnerHTML`; any `file:line` link uses the existing safe
    blob-URL helpers (http/https only). No keyword/regex injection filter is added — that would violate
    the repo's single-guard rule. **(spec Untrusted inputs, `specs/…:533-545`)**
15. No `fetch()` in a component or page — everything through `lib/hooks/multi-agent-runs.ts` and the
    existing `lib/hooks/reviews.ts` (read-only import; **do not edit** that file). Types come from
    `@devdigest/shared`.
16. Tests: `vi.mock` the hook modules (`client/INSIGHTS.md:97`); `fireEvent` only —
    `@testing-library/user-event` is **not** installed (`client/INSIGHTS.md:99`); stub
    `Element.prototype.scrollIntoView` per file (`client/INSIGHTS.md:35,39`). Assert **no** exact
    finding text, score number, or cost — those are model-authored and vary (`specs/…:396-401`). Do
    assert: conflict-group membership over a fixed fixture, the conflicts-only predicate, the empty
    state, and that a non-`done` agent never renders "did not flag".
17. **Client closer:** after T3 also reports done, re-run `cd client && pnpm test` and
    `cd client && pnpm typecheck` for the authoritative whole-project green. Until then, grep the `tsc`
    output for your own filenames only (root `INSIGHTS.md:132`).

---

## 9. `AC-N` → Task coverage

| AC | Task(s) | Note |
|----|---------|------|
| AC-1 | T3 | picker replaces `RunReviewDropdown` at `PrDetailHeader.tsx:92-99` |
| AC-2 | T3 | disabled + `aria-disabled` + `(0)` label |
| AC-3 | T1, T3 | T1 = create route + persistence; T3 = click → one request → navigate |
| AC-4 | T3 | |
| AC-5 | T3 | |
| AC-6 | T1, T3 | same mutation + same route as AC-3 |
| AC-7 | T2, T3 | T2 = the `done`-run mean scoped to the repo; T3 = `—` rendering |
| AC-8 | T3 | pure helper: MAX time / SUM cost / approximate flag |
| AC-9 | T3 | no numeric estimate when every selection is history-less |
| AC-10 | T2, T3 | T2 = separate endpoint so failure is isolated; T3 = degrade to `—`, `retry: false` |
| AC-11 | T1 | `multi_agent_runs` row + `multiAgentRunId` on every launched `agent_run` |
| AC-12 | T1, T4 | T1 = read-time overlay, no mutation; T4 = per-finding action only |
| AC-13 | T1, T4 | T1 = latest by `ranAt`, no deletes; T4 = renders the latest |
| AC-14 | T1, T4 | T1 = totals (MAX/SUM) + null case; T4 = header, empty state, no mode toggle |
| AC-15 | T1, T4 | T1 = column fields incl. the reviews join; T4 = header render + trace link |
| AC-16 | T1, T4 | T1 = status mapping incl. `cancelled`; T4 = self-clearing poll |
| AC-17 | T4 | reuse `FindingCard` + client-side join on finding `id` |
| AC-18 | T4 | reuses `useFindingAction` / existing route — **no server change** |
| AC-19 | T4 | unified `onAction` no-ops for non-accept/dismiss |
| AC-20 | T1 | exact `(file, start_line)` map key, shuffle-invariant unit test |
| AC-21 | T1, T4 | T1 = complete takes incl. `ignored`; T4 = render |
| AC-22 | T4 | conflict predicate over `takes[]` (contract carries no flag) |
| AC-23 | T4 | scaffolded `runs.conflicts.empty` |
| AC-24 | T1, T4 | T1 = takes over `done` columns only; T4 = recompute on poll |
| AC-24a | T1 | `line` = `start_line`; `title` by severity then finding id |
| AC-25 | T1, T2 | `getContext` + `workspaceId` on all three new routes; 404 across workspaces |
| AC-26 | T1 | `{ rateLimit: { max: 10, timeWindow: '1 minute' } }` on create only |

Every AC is covered by ≥ 1 task; every task traces to ≥ 1 AC (T1 → 14 ACs, T2 → 3, T3 → 11, T4 → 13).

---

## 10. Testing Strategy

Canonical per-module commands live in `TESTING.md:63-74` (mirrored in `server/AGENTS.md:67-74` and
`client/AGENTS.md:167-170`); each task's exact command string is in its **Tests to run** cell in §8.
The planner runs none of them.

- **Server integration lane (`.it.test`) is mandatory for T1 and T2.** T1 adds a schema column and
  two routes; T2 adds a route with a two-table aggregate join. Neither is provable by a hermetic unit
  test — workspace-scoped 404 (AC-25), the rate-limit override (AC-26), the boot-time route-param
  check, and the estimate aggregate all need a real Postgres (testcontainers). The `.it.test.ts`
  filename suffix is what splits the lanes in CI — do not rename
  (root `CLAUDE.md` "Gotchas", `TESTING.md:67-69`).
- **Hermetic server unit lane for the deterministic arithmetic.** `buildConflicts` (AC-20, AC-21,
  AC-24, AC-24a) and the estimate mean/exclusion rules (AC-7) are pure functions and belong in the
  unit lane. AC-20's shuffle-invariance test is the single most valuable test in this feature.
- **Client lane (vitest + jsdom, `fetch` mocked).** Component tests `vi.mock` the
  `lib/hooks/<domain>` module rather than standing up a `QueryClientProvider`
  (`client/INSIGHTS.md:97`); interactions use `fireEvent` because
  `@testing-library/user-event` is **not installed** (`client/INSIGHTS.md:99`); stub
  `Element.prototype.scrollIntoView` per file (`client/INSIGHTS.md:35,39`).
- **What must not be asserted.** Model-authored output varies run to run
  (`specs/…:396-401`): no exact finding text, no exact score, no exact cost. Safe to assert exactly:
  estimate aggregates over a fixed set of past runs, group membership over a fixed finding set, the
  `did not flag` / conflict classification over a fixed set of completed agents, per-finding verdict
  persistence, and call counts (N agents ⇒ N calls; grouping and estimates ⇒ **0** model calls).
- **`reviewer-core`: no change, no new test.** Nothing is imported from it.
- **e2e: no change expected.** `e2e/specs/02` and `04` operate on read-only seeded data and never
  drive `RunReviewDropdown`, so deleting it carries no e2e breakage. If the orchestrator wants
  confirmation it is `TESTING.md:73-74` — but it is not a task-level requirement here.
- **Whole-project typecheck ownership.** `tsc` covers the whole package, so a parallel sibling's
  in-flight file produces errors that are not your fault (root `INSIGHTS.md:132`,
  `server/INSIGHTS.md:56,175`). Non-closing tasks grep `tsc` output for their **own** filenames;
  **T1 is the server closer** and **T4 is the client closer** for the authoritative green.
- **Flake protocol.** The `.it.test.ts` family flakes under full-suite load; re-run a failing file in
  isolation **n ≥ 3** before attributing the failure to your diff (root `INSIGHTS.md:75`,
  `server/INSIGHTS.md:205`).

---

## 11. Risks & Mitigations

| # | Risk | Sev | Mitigation |
|---|------|-----|------------|
| 1 | Two implementers write the same file (no worktree isolation — root `INSIGHTS.md:49`) | **High** | §8's "Files owned" **and** the explicit "NOT owned" list in every card. The three contested surfaces are pre-assigned: `contracts/observability.ts` → T1 only; `vendor/shared/index.ts` + `contracts/estimates.ts` → T2 only; `messages/en/runs.json` → T4 only, `messages/en/multiAgent.json` → T3 only. |
| 2 | `drizzle-kit generate` opens the un-pipeable "created or renamed?" prompt and busy-loops at 100 % CPU (`server/INSIGHTS.md:36`) | Medium | A plain nullable ADD COLUMN should not trigger it. T1 must **inspect the emitted SQL** for `ADD COLUMN` before applying, and roll back with the three-file recipe (`server/INSIGHTS.md:106-113`) if anything else appears. |
| 3 | `agent_runs.status` is free text but `AgentColumn.status` is a 4-literal enum ⇒ response-serialisation 500 | Medium | T1 criterion 8: explicit mapping with a `running` fallback for every unrecognised value; covered by a unit test over an unexpected status string. |
| 4 | `reviews.runId` has no FK and no unique index ⇒ a run may yield >1 review row (`server/INSIGHTS.md:30`) | Medium | T1 criterion 7 pins the selection rule (latest `kind === 'review'`, then latest of any kind, then null/empty). §4 Q2 records the assumption for the verifier. |
| 5 | An it-test's seeded findings vanish through the grounding gate (`server/INSIGHTS.md:62`) | Medium | T1 criterion 15: seed `reviews`/`findings` through the repository/db, never by driving a live review run. |
| 6 | Cross-workspace 404 tested with a fake auth header, which `LocalNoAuthProvider` ignores (`server/INSIGHTS.md:64`) | Medium | T1 criterion 5 / T2 criterion 5: seed a real second `workspaces` row. |
| 7 | `.it.test.ts` flake attributed to this diff (root `INSIGHTS.md:75`) | Medium | n ≥ 3 in isolation before blaming the change; stated in both server cards. |
| 8 | Dual-vendored drift — 5 files already differ, so whole-tree `diff` is not a valid check | Medium | Verify by `git diff <file> \| grep '^+'` on each of the paired files and compare the **added** lines (root `INSIGHTS.md:216`). T1 and T2 own disjoint contract files, so neither can clobber the other. |
| 9 | New route registered with a param name differing from the existing `/pulls/:id/*` or `/repos/:repoId/*` family ⇒ find-my-way throws **at boot** | Medium | T1 criterion 3 pins `:id`; T2 criterion 1 puts estimates under the static `/agents/estimates` rather than `/repos/:id/…`. Any it-test that boots the app catches it immediately. |
| 10 | T3 navigates to a route T4 creates in the same wave ⇒ runtime 404 until both land | Low | Compile-safe (Next resolves routes from the filesystem, not imports). Accepted and stated in T3 criterion 16; the orchestrator should smoke both pages only after wave 1 completes. |
| 11 | Whole-project `pnpm typecheck` reports a sibling's transient errors (root `INSIGHTS.md:132`) | Low | Non-closers grep for their own filenames; T1 (server) and T4 (client) are the designated closers. |
| 12 | Deleting `RunReviewDropdown/` breaks an unseen consumer | Low | Its only import site is `PrDetailHeader.tsx:5,92-99` and its only test is `RunReviewDropdown.test.tsx:29-32`; `useRunReview` and `POST /pulls/:id/review` are explicitly retained for the MCP tool. T3 greps before deleting. |
| 13 | No index on `agent_runs` at all (`runs.ts:8-38`) ⇒ the p95 500 ms target (`specs/…:358-362`) has no headroom | Low | Fine at starter volumes. Recommendation R1 (a plain index) is available if it ever bites; deliberately not in the plan since no AC requires it. |
| 14 | AC-14's "fan-out via worktrees" copy contradicts the scaffolded "p-queue" string and the spec's own Design-gaps note | Low | §4 Q4: follow AC-14 (normative), R2 records the alternative for a human to overrule. |

---

## 12. Success Criteria

- [ ] All 27 acceptance criteria in §2 (AC-1 … AC-26 **including AC-24a**) are implemented and traced
      through the §9 matrix.
- [ ] `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` — green.
- [ ] `cd server && pnpm exec vitest run .it.test` — green (n ≥ 3 in isolation for any flaky file).
- [ ] `cd server && pnpm typecheck` — green after **both** wave-0 tasks land (T1 closes).
- [ ] `cd client && pnpm test` and `cd client && pnpm typecheck` — green after **both** wave-1 tasks
      land (T4 closes).
- [ ] `cd server && pnpm db:generate` produced a migration whose SQL is a plain `ADD COLUMN`, and
      `pnpm db:migrate` applied it; `meta/_journal.json` has exactly one new entry (`idx: 17`).
- [ ] `git diff server/src/vendor/shared/contracts/observability.ts | grep '^+'` and the same for the
      client copy produce **identical** added lines; likewise for the four files of
      `contracts/estimates.ts` + `vendor/shared/index.ts`.
- [ ] `AgentColumnFinding` (`observability.ts:23-31`) is unchanged — the AC-17 detail comes from the
      client-side join, not a widened contract.
- [ ] A unit test shuffles the input findings and asserts `buildConflicts` output is deeply equal —
      AC-20/AC-24a's determinism is proved, not asserted by inspection.
- [ ] Zero new model calls: the grouping, the estimates, and the read model issue none; N selected
      agents still produce exactly N review calls.
- [ ] `reviewer-core/`, `e2e/`, `server/src/platform/container.ts`, `run-executor.ts`, the SSE/`RunBus`
      machinery, `FindingCard.tsx`, `RunTraceDrawer/`, and `POST /findings/:id/(accept|dismiss)` are
      untouched.
- [ ] The left nav shows **Multi-Agent Review**, it highlights on both new routes, and every new
      user-facing string is an i18n key in `client/messages/en/` — no hard-coded literal.
- [ ] `RunReviewDropdown/` is gone; the PR page still renders and its remaining tests pass.
