# Implementation Plan — L06 Eval Pipeline

**Spec:** `specs/2026-07-13-eval-pipeline.md` (SPEC-2026-07-13-eval-pipeline)
**Plan status:** ready to execute — no blocking open questions.
**Revision:** v2 (2026-07-13) — amended after a cross-model plan review returned
`revise_before_implementing`. See §13 for what changed and why.

---

## 1. Overview

Turn accept/dismiss decisions into a replayable regression harness: seed an eval case from a
decided finding, run an agent over its whole case set as one first-class **batch run** that pins
the agent's **effective config by value**, score it **mechanically** (no model in the scorer),
compare two runs, and promote the winner.

The feature is heavily pre-scaffolded. Two tables are migrated, eight eval contracts are
dual-vendored, `client/messages/en/eval.json` is fully written, the sidebar already links `/evals`,
and `reviewer-core` already accepts a frozen diff with no repo. **20 tasks across 6 waves**;
server and client build in parallel from Wave 2 because §7.6 pins the REST surface up front.

AC ids are the spec's own (`AC-1`…`AC-55`, plus the withdrawn `AC-26a`). None were renumbered.

---

## 2. Requirements (as given)

All 56 ids restated from the spec. **AC-26a and AC-43 are WITHDRAWN by the spec itself** and carry
no implementation.

| ID | Requirement (abridged — spec is authoritative) | Source |
|----|-----------------------------------------------|--------|
| AC-1 | FindingCard offers a "Turn into eval case" action beside Accept/Dismiss | `specs/2026-07-13-eval-pipeline.md:208` |
| AC-2 | Undecided finding ⇒ action disabled, names the reason, creates no case | `:212` |
| AC-3 | Expectation derived from the decision: accepted→`must_find`, dismissed→`must_not_flag`; never asked | `:215` |
| AC-4 | `must_not_flag` editor shows the source finding's **original rationale**; a **recorded reason** is required to save | `:221` |
| AC-5 | `must_find` expected output may list >1 item; each needs a file + line range | `:225` |
| AC-6 | A case freezes exactly two model-reaching inputs (diff + PR meta); no live repo/clone/GitHub at run time | `:229` |
| AC-7 | Creation-/edit-time diff-freeze integrity: reject (never persist) a case whose diff cannot satisfy its expectation | `:233` |
| AC-8 | One case per source finding; a second seed surfaces the existing case | `:247` |
| AC-9 | One execution over the whole set = one first-class run owning aggregate metrics, pass count, cost, duration, status, config snapshot | `:253` |
| AC-10 | A run pins the **effective config by value** — prompt, provider, model, strategy, `repo_intel`, resolved skills **with versions**; never a version pointer | `:259` |
| AC-11 | A run is asynchronous with observable progress; never a blocking HTTP request | `:270` |
| AC-12 | While running: report "k of N" and offer cancel | `:275` |
| AC-13 | ≤1 in-flight run per agent; ≤1 in-flight draft per case; no draft while the agent's run is in flight | `:280` |
| AC-14 | A run records, per case, the case identity **and an input fingerprint** | `:286` |
| AC-15 | Same review engine entry point + same mandatory grounding gate as a real review | `:292` |
| AC-16 | Discard the model's self-reported score; derive metrics only from grounded findings + the gate's drop record | `:298` |
| AC-17 | Match rule = the gate's own locality rule per `kind`: full-file kinds → file equality only; else file + line overlap. Title/category/severity never participate | `:307` |
| AC-18 | Set-level **recall** = matched `must_find` items ÷ all `must_find` items across the set | `:326` |
| AC-19 | Set-level **precision** = surviving findings that match an expected item ÷ **all** surviving findings across every case; zero findings ⇒ 1.0 | `:330` |
| AC-20 | Set-level **citation accuracy** = findings that survived the gate ÷ **every** finding the model emitted; zero emitted ⇒ 1.0 | `:339` |
| AC-21 | State everywhere that citation accuracy measures "cited a line inside a real hunk", not "the right line" | `:348` |
| AC-22 | Per-case pass/fail distinct from set metrics; extra findings on a positive case don't fail it but do hit precision | `:353` |
| AC-23 | The scorer makes **zero** model calls; the Evals tab says so | `:360` |
| AC-24 | Compare exactly two runs of one agent: metric deltas + a system-prompt diff of the two config snapshots | `:366` |
| AC-25 | Two runs of the **same** version are comparable (the noise floor) | `:371` |
| AC-26 | A comparison reports shared fingerprint-identical case count, excludes+names changed/absent cases, lists flipped cases; no shared case ⇒ "not comparable", not a delta | `:375` |
| AC-26a | **WITHDRAWN** by the spec | `:382` |
| AC-27 | Promote writes the **whole** effective config live — **including re-linking the pinned skill set** — appending a new version | `:387` |
| AC-28 | If the promoted side is worse on any metric, name it and require explicit confirmation | `:399` |
| AC-29 | Eval Dashboard at the already-wired `/evals` nav slot: every agent + latest metrics + a cross-agent recent-runs table | `:434` |
| AC-30 | Agent Editor gains an **Evals** tab: metric cards, case list with pass/fail + badge, run-all/create/run/edit/delete controls | `:440` |
| AC-31 | Zero cases ⇒ explicit empty state; never render a metric as 0%. Absent ≠ measured-zero | `:445` |
| AC-32 | Cases but never run ⇒ "never run", no metrics, no trend point | `:449` |
| AC-33 | Dashboard alert when the latest run's metrics moved vs the previous comparable run, naming metric + direction | `:452` |
| AC-34 | Before a run starts, state how many cases (⇒ how many model calls) it will run | `:536` |
| AC-35 | "Run all agents" requires confirmation naming total agents + total cases; skips zero-case agents | `:538` |
| AC-36 | A case's model failure is contained: run continues, case is **errored**, excluded from every denominator | `:542` |
| AC-37 | Every case failed ⇒ run status `failed`, **null** metrics, no trend point | `:547` |
| AC-38 | Never present a delta alone: always with the comparable-case count and the flipped cases | `:552` |
| AC-39 | Every eval route is workspace-scoped; cross-workspace resolves as 404 | `:560` |
| AC-40 | v1 routes accept only an **agent** owner; a skill owner is rejected with an explicit error | `:563` |
| AC-41 | Run-starting routes carry a per-route rate limit at least as tight as the review-run route's | `:566` |
| AC-42 | Frozen diff + PR meta pass through the existing untrusted-wrapping / `INJECTION_GUARD`; no denylist | `:569` |
| AC-43 | **WITHDRAWN** by the spec (superseded by AC-47) | `:459` |
| AC-44 | Every run runs the whole set as it stood at start; a run whose set has since **drifted** is marked | `:463` |
| AC-45 | The trend chart plots **every** run, marks drifted points, and never plots a draft | `:469` |
| AC-46 | Headline metric cards, the authoritative "N / M passing", and the alert derive from the latest **eval run**, never a draft | `:473` |
| AC-47 | A single-case run is a **draft**: not in run history, not on the trend, never comparable | `:481` |
| AC-48 | A draft persists **on the case** with its timestamp + config snapshot; a since-changed config marks it **stale** | `:487` |
| AC-49 | Draft cost is charged to the agent's eval spend as **its own component**, distinct from run spend | `:493` |
| AC-50 | Case rows show the latest run's outcome; a newer draft shows with a **draft marker**; an unmeasured case shows **not-yet-measured**. The headline never moves on a draft and names its run | `:499` |
| AC-51 | Comparability is decided on **effective configs**, never version tags; same tag + different config ⇒ say so and name the skill delta | `:513` |
| AC-52 | A run with no config snapshot still renders deltas; prompt-/skill-diff render as **unavailable**, not an error | `:522` |
| AC-53 | A deleted/disabled agent's cases present **read-only**; deleting an agent cascade-deletes its cases and runs | `:527` |
| AC-54 | `pnpm verify:l06` exists, runs this feature's suite, and is green; no implementation file at two paths | `:406` |
| AC-55 | `pnpm db:seed` extended with a demo agent + **≥8 eval cases** mixing both expectations; every seeded case satisfies AC-7 | `:420` |

---

## 3. Requirements Review

Audited against **complete / consistent / unambiguous / testable**. The spec is unusually
well-grounded — it names its own landmines with `file:line`. Eight issues found; **none blocking**.

### Verified correct (spot-checked against the code)

- AC-17's authority claim holds: `FULL_FILE_KINDS = {secret_leak, lethal_trifecta, phantom, hook}`
  at `reviewer-core/src/grounding.ts:16`, applied at `:59-70` (file presence only) vs `:72-80`
  (range intersect). The scorer must mirror exactly this.
- AC-15/AC-6 hold: `reviewPullRequest` (`reviewer-core/src/review/run.ts:132`) hard-requires only
  `{ systemPrompt, model, diff, llm }`, and `groundFindings` (`grounding.ts:52-84`) reads nothing
  but the parsed diff. It also already exposes `checkCancelled` (`run.ts:101`, called at `:182`)
  and returns `dropped[]` + `costUsd` (`run.ts:110,119`) — exactly what AC-12, AC-20 and the cost
  column need. **No engine change is required for any of this.**
- AC-10's RISK is real, **and it runs one level deeper than the spec states** — see R-7.

### Issues found

- **R-1 (completeness, non-blocking) — the spec's drift note is incomplete.** Assumptions say the
  two copies of `eval-ci.ts` have drifted. In fact **four** contract files differ (`diff` over both
  trees): `eval-ci.ts`, **`knowledge.ts`**, `productionize.ts`, `trace.ts`. `knowledge.ts` is where
  `EvalCase` / `EvalRun` / `EvalPerTrace` live, and the server copy carries `AgentVersionConfig` +
  `AgentVersion` (`knowledge.ts:371-394`) that the client copy does **not**. The spec's *substantive*
  claim still holds — the eight eval schemas are byte-identical in both copies at identical line
  numbers — but a contract task told "only `eval-ci.ts` is drifted" could rationally decide
  `knowledge.ts` is a clean mirror and sync it, deleting a contract.
  → Handled: **T2** owns all four files and its card forbids file-level syncing outright.

- **R-2 (completeness, non-blocking) — AC-49 is unsatisfiable by AC-48's storage alone.** AC-48
  says a draft is persisted "on the case as that case's **latest** scratch result" (one slot). AC-49
  says "ten drafts at $0.02 move the agent's reported eval spend by $0.20". A single latest-draft
  slot cannot remember the cost of the nine it overwrote. → Resolved by storing drafts as **rows**
  (`eval_drafts`), with "the case's latest scratch result" = the newest row and draft spend =
  `SUM(cost_usd)`. This satisfies both ACs literally and is what T1 builds.

- **R-3 (completeness, non-blocking) — AC-53's cascade has no FK to hang on.**
  `eval_cases.owner_id` is a bare `uuid` with **no FK** (`server/src/db/schema/eval.ts:13`) because
  `owner_kind` makes it polymorphic. Postgres therefore cannot cascade an agent delete to its eval
  cases. → Resolved: the new batch-run table gets a real `agent_id` FK (cascade, so **runs** cascade
  for free), and the **cases** are deleted application-side inside `AgentsRepository.deleteById`
  (`repository.ts:93-99`). Owned by T7. Risk R-c.

- **R-4 (ambiguity, non-blocking) — is a draft synchronous or asynchronous?** AC-13's phrasing
  ("invoking Run case twice on the same case **before the first returns**") reads as synchronous;
  AC-11 only mandates async for a *run*. Both readings satisfy every AC. → **Assumption A-1**: a
  draft is **asynchronous**, same fire-and-forget + poll mechanism as a run.

- **R-5 (completeness, non-blocking) — AC-27's promote cannot fully restore a skill's *content*.**
  Promote re-links skill **ids** (`setSkills`, `repository.ts:266-281`). If a linked skill's body was
  edited since the run, the live skill is at `v5` while the run measured `v3`, and no "revert skill
  body" primitive is exposed. AC-27's own observable only demands the **set** be restored. →
  **Assumption A-2**: promote restores the skill set and **names** any version divergence rather than
  silently shipping different content (a derivation of AC-27 + AC-51, not a new requirement).

- **R-6 (completeness, non-blocking) — AC-4's "source rationale" had no data path.** AC-4 requires
  the negative-case editor to display *the source finding's original rationale*. No contract field
  carried it, and no repository read produced it — the editor would have had nothing to render. And
  after the case is frozen, the finding may be edited or deleted. → Resolved: the case **freezes a
  `source_finding` snapshot** (title, rationale, severity, category, kind, file, lines) at seed
  time. A live join on `source_finding_id` would also work, but freezing is consistent with the
  feature's whole ethos and **also supplies AC-17's display-only severity·category chip**, which had
  the identical missing data path. **AC-4 demands two different texts and the plan must never
  conflate them:** the finding's **original rationale** (frozen, read-only) and the user's
  **recorded reason** (`notes`, required to save).

- **R-7 (consistency, would-have-shipped-broken, resolved in-plan) — `promoteConfig` as first
  drafted would fail AC-27 in exactly the scenario the feature exists for.** Verified:
  `isConfigChange` (`server/src/modules/agents/helpers.ts:63-74`) compares only `name`,
  `description`, `provider`, `model`, `systemPrompt`, `strategy`, `ciFailOn`, `repoIntel`; and
  `UpdateAgent` (`repository.ts:32-43`) has **no `skills` field at all**. So a promote whose config
  differs from the live agent **only in its skill set** passes `update()` with no changed field →
  **no version bump and no `agent_versions` snapshot** → AC-27's observable ("a new version appears
  at the head of the history") **fails**. This is the `agent_versions` landmine one level deeper than
  the spec states: we knew `setSkills` bumps nothing; the consequence is that **promote inherits that
  hole**, precisely in the skill-regression case this whole feature was built to catch. A second,
  independent ordering bug rides along: `update()` calls `snapshotVersion` *internally*
  (`repository.ts:161`), so an `update()`-then-`setSkills()` sequence snapshots the **pre-promote**
  skill links. → Resolved in T7: `promoteConfig` **owns** the bump — `setSkills` **first**, then an
  unconditional version bump + snapshot — and `isConfigChange` is **not** weakened (that would change
  the general agent-update path, which is out of scope). Risk R-k.

- **R-8 (testability, non-blocking — resolved in-plan) — the lesson gate would have been green and
  hollow.** `server/vitest.config.ts:14` includes **both** `test/**/*.test.ts` **and**
  `src/**/*.test.ts`. A `verify:l06` scoped to `server/test/` would run the integration tests and
  **never execute** the colocated pure tests (`src/modules/eval/{scorer,fingerprint,diff-freeze,
  compare}.test.ts`, `src/modules/agents/effective-config.test.ts`) — i.e. the gate would prove
  nothing about AC-17…AC-22, AC-26 or AC-51, the exact place §10 says the feature's *judgment* lives.
  A green gate with nothing behind it is the same disease as root `INSIGHTS.md:63`.
  → Resolved: `verify:l06` runs **both lanes** (T19). The `verify:l03` hazard the spec warns about is
  already mitigated — `server/tsconfig.json:29` carries `"exclude": ["src/**/*.test.ts"]` (verified),
  so colocated tests are build-clean and `pnpm build` emits none of them into `dist/`. Risk R-l.

### Testability

Every AC is testable with the LLM mocked. The metric arithmetic, the match rule, the per-case pass
rule, the errored-case exclusion, the fingerprint comparability logic, and the diff-freeze rejection
are all pure and unit-testable; the async run, cancel, workspace scoping, cascade, promote and rate
limits are integration-testable. AC-21, AC-23, AC-38 are copy assertions (RTL). Nothing requires
asserting on model prose or on a real metric value.

---

## 4. Open Questions

All non-blocking. The plan proceeds on the stated assumption in each case.

1. **[non-blocking] Draft execution model — async or sync?** (R-4)
   *Assumption A-1:* asynchronous, polled, `eval_drafts` row created `running` first. Rationale: one
   structured call can exceed an HTTP timeout; an in-flight draft then has a persisted meaning
   (AC-13); a failed draft becomes an errored scratch result for free (AC-36); the client reuses one
   poll hook. Blast radius if reversed: T11's draft path and one client hook.

2. **[non-blocking] Does promote restore skill *bodies*, or only skill *links*?** (R-5)
   *Assumption A-2:* links only; a version divergence is surfaced, never silently accepted.

3. **[non-blocking] May `reviewer-core` gain a two-word `export`?** AC-17 makes the gate "the
   **authority**" for the match rule, but `FULL_FILE_KINDS` is a module-private `const`
   (`reviewer-core/src/grounding.ts:16`). The scorer therefore either (a) imports it — requiring
   `export` on that line plus one re-export in `src/index.ts`, a **zero-behaviour-change** edit — or
   (b) re-declares the set, creating exactly the duplicate-authority drift AC-17 exists to prevent.
   *Assumption A-3:* take (a). It contradicts the letter of "reviewer-core needs zero changes" but
   serves AC-17's intent; it adds no logic and cannot alter the gate. T4 owns it, with the fallback
   on its card.

4. **[non-blocking] Where does the compare view live in the IA?** The spec shows a compare view but
   no route. The pre-written breadcrumbs (`eval.json` `page.crumbEvalDashboard`, `crumbEvals`,
   `crumbEvalCase`, `crumbNewCase`) imply eval surfaces are **pages**, not modals.
   *Assumption A-4:* `/evals/compare?a=<runId>&b=<runId>`, entered from the Evals tab's run history.

5. **[non-blocking] `verify:l06` now needs Docker.** Because the gate must execute the integration
   lane (workspace isolation, cascade, promote, async run) as well as the pure lane (R-8), it
   requires testcontainers Postgres. AC-54 only says the script "runs this feature's test suite and
   passes green", so this is compliant. *Assumption A-5:* Docker is available where the lesson is
   graded (it already is for `pnpm test` in this repo). If the grader must run Docker-free, split
   into `verify:l06` (pure lane) + `verify:l06:it` — but then the gate no longer covers AC-27/39/53,
   and that trade must be made deliberately, not by accident.

---

## 5. Recommendations

Advice only — **the emitted plan assumes none of these.**

- **REC-1 — Route the review path through the same effective-config resolver (≈3 lines).**
  `run-executor.ts:219-222` inlines the skill filter (`l.enabled && l.skill.enabled` → bodies). T7
  extracts that rule for the eval run. Leaving the review path on its private copy means the two can
  silently diverge — and the day they do, the eval measures a differently-configured agent than the
  one that ships, the exact failure AC-15 exists to prevent. *Cost:* a 3-line substitution + a green
  review suite. *Not adopted* because the spec says "nothing existing changes shape" — but this is
  the highest-value 3 lines available in this feature.

- **REC-2 — Pin skill *body hashes*, not just versions, in the effective config.** Versions are
  enough to *detect* divergence (AC-51); a content hash would make a run fully *reproducible* and
  catch a body edited without a version bump. *Cost:* one string per skill. *Not adopted:* AC-10
  specifies versions.

- **REC-3 — Surface a "pinned skill has moved on" warning on promote.** See R-5/A-2. Folded into
  T7/T11's acceptance criteria as a derivation of AC-27+AC-51, not as a new requirement.

- **REC-4 — Make `isConfigChange` skill-aware in a follow-up.** R-7 is worked around *inside promote*
  here, deliberately, so the general agent-update path keeps its current behaviour. But the root hole
  remains: any future caller that changes skills expecting a version bump will hit it too. *Cost:*
  touching a hot path and re-baselining `agents-versions.it.test.ts`. *Not adopted:* out of this
  spec's scope; worth its own ticket.

---

## 6. Relevant Insights (top 3, all load-bearing)

1. **`agent_versions` is a trap — the whole feature turns on not trusting it, and the trap is deeper
   than it looks.** `snapshotVersion()` is called from `insert()`
   (`server/src/modules/agents/repository.ts:102-123`) and `update()` (`:129-163`) only.
   **`setSkills()` (`:266-281`) is neither** — re-linking skills bumps no version and writes **no
   snapshot at all**, so the existing snapshot's `skills` array goes stale against the live agent.
   The snapshot also stores skill **ids only** (`:165-183`) — no versions, no `order`, no per-link
   `enabled`, all three of which change behaviour. **And the hole propagates:** because
   `isConfigChange` (`helpers.ts:63-74`) does not consider skills and `UpdateAgent`
   (`repository.ts:32-43`) has no `skills` field, a *promote* that changes only the skill set also
   bumps nothing — see R-7. Any task that "simplifies" AC-10 back to `(agent_id, version)`, or that
   trusts `update()` to bump on a skill-only promote, produces two runs tagged `v7` that measured
   different agents and a compare view showing a real metric delta beside an **empty prompt diff** —
   a false negative on the exact regression this feature exists to catch. Full write-up:
   `server/INSIGHTS.md` (Codebase Patterns, first entry).

2. **The grounding gate silently drops findings whose lines miss a hunk — no error, just
   `findings: []`** (`server/INSIGHTS.md:50`; the code is `grounding.ts:76-80`). This is why AC-7 is
   a **creation-time rejection** rather than a run-time warning, and it has a precise home in the
   code: `server/src/modules/reviews/diff-loader.ts:37` — `if (!f.patch) continue;` — is the line
   that silently drops a file from a reconstructed diff when GitHub omitted its patch. A case seeded
   through that path is **unsatisfiable by construction** and will read as a permanent recall
   regression. T5 must reject it; T18's seeded fixtures must not trip it (AC-55).

3. **Every shared-contract change is a two-file edit** (root `INSIGHTS.md:74`) — here a **four-file**
   edit, because both `knowledge.ts` and `eval-ci.ts` are involved and **both are already drifted**
   between the copies (§3 R-1). Mirror **only your own additions**; never copy one file over the
   other. Corollary (root `INSIGHTS.md:112`): only vendor what the client imports — the scorer, the
   fingerprint fn, the executor and the diff-freeze validator are **server-only** and must not enter
   `vendor/shared`.

---

## 7. Architecture Changes

### 7.1 Storage (`server/src/db/schema/eval.ts`) — a real reshape, on empty tables

The scaffolded `eval_runs` is **one row per case** with no parent and no config pin
(`db/schema/eval.ts:22-35`). The contract `EvalRun` (`knowledge.ts:100-109`) is already
**aggregate-shaped**. The table is wrong; the contract is right. Both tables are empty
(root `CLAUDE.md`: "Empty tables are intentional"), so we reshape rather than add a parallel entity.

- **`eval_cases`** (extend, `eval.ts:7-20`): `+ expectation` (`must_find`|`must_not_flag`, notNull),
  `+ source_finding_id` (uuid, FK→`findings.id` `ON DELETE SET NULL`, **UNIQUE** ⇒ AC-8 is enforced
  by the DB), `+ source_finding` (jsonb, nullable — the **frozen snapshot** of the seeding finding:
  title, rationale, severity, category, kind, file, lines. This is the data path for AC-4's
  "original rationale" **and** AC-17's display-only provenance chip, and it survives the finding
  being edited or deleted — §3 R-6), `+ forbidden_region` (jsonb, null unless `must_not_flag`),
  `+ input_fingerprint` (text, notNull ⇒ AC-14). `input_diff` becomes `notNull`. Index on
  `(owner_kind, owner_id)`.
  **`notes` remains the user's *recorded reason* (AC-4) — a different field from `source_finding`'s
  rationale. Never conflate them.**
- **`eval_runs`** (reshape ⇒ **the batch**, AC-9): `id`, `workspace_id` FK, `agent_id` FK→`agents`
  **cascade** (⇒ AC-53's run cascade is free), `agent_version` int (display label only — *never* a
  comparability key), `effective_config` jsonb **notNull** (AC-10), `status`
  (`running|done|failed|cancelled` — mirrors the review vocabulary at
  `server/src/modules/reviews/repository/run.repo.ts:149`, not a new one), `started_at`,
  `finished_at`, `cases_total`, `cases_done` (⇒ AC-12's "k of N", **persisted** so it survives a
  reload, AC-11), `errored_count` (AC-36), `traces_passed`, `traces_total`,
  `recall`/`precision`/`citation_accuracy` **all nullable** (AC-37, and AC-18's "—" for a set with
  no `must_find` item), `duration_ms`, `cost_usd`, `error`.
- **`eval_case_results`** (new, per-case rows of a batch): `run_id` FK→`eval_runs` cascade;
  `case_id` FK→`eval_cases` **`ON DELETE SET NULL`** + a `case_name` snapshot — this is what makes
  "a run outlives its cases" true; `input_fingerprint` (AC-14/AC-26); `outcome`
  (`passed|failed|errored` — `errored` distinct from `failed` is the whole point, AC-36); `error`;
  `expected_count`, `matched_count` ("expected N, got M"); `emitted_count`, `kept_count` (the two
  numbers AC-20 divides); `findings` jsonb; `unmatched_findings` jsonb; `duration_ms`; `cost_usd`.
- **`eval_drafts`** (new — a draft is **not** a run, AC-47): one **row per draft** (not one slot per
  case — §3 R-2). `workspace_id`, `agent_id` FK cascade, `case_id` FK cascade, `ran_at`, `status`,
  `effective_config` jsonb (⇒ staleness is derivable, AC-48), `input_fingerprint`, `outcome`,
  `error`, counts, `findings` jsonb, `duration_ms`, `cost_usd`. A case's "latest scratch result" =
  its newest row. Draft spend (AC-49) = `SUM(cost_usd)`; run spend = `SUM` over `eval_runs` — two
  columns of two tables that **cannot silently disagree**. Partial unique index on
  `(case_id) WHERE status='running'` ⇒ AC-13's one-draft-per-case guard.

Barrel: add the new tables to the named import at `server/src/db/schema.ts:37` and the `schema`
object at `:50-92` (the `export *` at `:23` covers re-export automatically). Then
`pnpm db:generate` → `0016_*.sql` + `meta/0016_snapshot.json` + a `_journal.json` entry →
`pnpm db:migrate`. **Migrations are not applied on boot.** To amend a generated migration, roll it
back the documented three-file way (`server/INSIGHTS.md:94-101`) — never hand-edit the SQL.

### 7.2 Contracts (dual-vendored — **four files, one task**)

`knowledge.ts` (both copies): make `EvalRun`'s three metrics + `duration_ms` **nullable** and add
`errored_count` — the "extend, don't rival" the spec asks for (AC-31/32/37 require it; nothing
imports `EvalRun` today, so it is free).

`eval-ci.ts` (both copies) — all net-new shapes:

- `EvalExpectation` = `must_find | must_not_flag`
- `EvalExpectedItem` = `{ file, start_line, end_line, kind: FindingKind, severity?, category?, title? }`
  — `kind` is **load-bearing** (it selects the locality rule, AC-17); severity/category/title are
  **display-only provenance and participate in no match**.
- `EvalForbiddenRegion` = `{ file, start_line, end_line, kind }`
- **`EvalSourceFinding`** = `{ finding_id, title, rationale, severity, category, kind, file, start_line, end_line }`
  — the **frozen** snapshot of the seeding finding. Supplies AC-4's *original rationale* and AC-17's
  provenance chip. **Distinct from `notes`**, which is the user's recorded reason (AC-4).
- `EvalSkillPin` = `{ id, name, version, order, enabled }` ← the fix for the `agent_versions` trap
- `EvalEffectiveConfig` = `{ system_prompt, provider, model, strategy, repo_intel, skills: EvalSkillPin[] }`
  — **not** `AgentVersionConfig` (`knowledge.ts:371-394`), which stores skill **ids only** and exists
  only in the server copy.
- `EvalRunStatus` = `running | done | failed | cancelled`; `EvalCaseOutcome` = `passed | failed | errored`
- `EvalCaseResult`, `EvalRunSummary` (batch-shaped — what `EvalDashboard.recent_runs` becomes,
  replacing the per-case `EvalRunRecord`), `EvalRunDetail` (= summary + `effective_config` +
  `results[]`), `EvalDraftResult` (+ `stale: boolean`), `EvalSpend` =
  `{ total_usd, run_usd, draft_usd }`, `EvalComparison`, `EvalWorkspaceDashboard`,
  `EvalRunAllPreview`, `EvalPromoteResult` (+ `skill_version_divergence[]` for REC-3 / A-2).
- `EvalCase` / `EvalCaseInput` extended with `expectation`, `source_finding_id`, **`source_finding`**
  (read-only to the client), `forbidden_region`, `input_fingerprint` (read-only), typed
  `expected_output: EvalExpectedItem[]`, `latest_draft`.
- `EvalTrendPoint` extended with `run_id` + `set_drifted`; metrics nullable.
- `EvalDashboard`: `current`'s metrics become nullable (AC-31/32); `recent_runs: EvalRunSummary[]`;
  `+ spend: EvalSpend`.
- `EvalRunRecord` is **left untouched** (unused; the deferred CI spec may want it). Do not delete.

### 7.3 Server — the new `eval` module (onion layers)

```
server/src/modules/eval/
  routes.ts        infrastructure — HTTP only. getContext() scoping, Zod from vendor/shared,
                   per-route rate limits. Zero business logic.
  service.ts       application  — case CRUD, seed-from-finding, start/cancel run + draft,
                   dashboard aggregates, compare + promote orchestration, in-flight guards.
  repository.ts    application  — Drizzle over the four eval tables. No HTTP, no LLM.
  run-executor.ts  application  — the async batch executor (fire-and-forget), one
                   reviewPullRequest() per case, cancellation checkpoints, progress writes.
  scorer.ts        PURE — match rule + metric arithmetic + per-case pass. No I/O. No model call.
  fingerprint.ts   PURE — content hash over frozen inputs + expectation (AC-14).
  diff-freeze.ts   PURE — AC-7 integrity check.
  compare.ts       PURE — shared-fingerprint deltas, flipped/excluded cases, skill delta.
```

The four **pure** files are the heart of the feature and of `verify:l06`: AC-17 through AC-22, AC-26
and AC-51 actually live there, and they are unit-testable with no Docker and no model. Their tests
are **colocated** (`src/modules/eval/*.test.ts`) — build-clean thanks to `server/tsconfig.json:29` —
and **`verify:l06` must execute them** (§3 R-8).

Reuse, do not rebuild:
- **Async run:** fire-and-forget `void executor.executeRun(...)` after synchronously inserting the
  run row so the id exists immediately — the mechanism at `reviews/service.ts:109-145`. No queue.
- **Progress + cancel:** persist `cases_done`/`cases_total` on the run row (survives a reload, which
  the in-memory `RunBus` does not) **and** reuse `runBus.cancel()` / `isCancelled()`
  (`server/src/platform/sse.ts:28-35`), passed into the engine as `checkCancelled`
  (`reviewer-core/src/review/run.ts:101`), plus a between-cases check. Pattern:
  `reviews/run-executor.ts:293-295`.
- **Diff capture (AC-7):** `loadDiff(container, repo, workspaceId, pull, repoRow)`
  (`reviews/diff-loader.ts:12-30`) already does "live `git diff base...head`, falling back to
  reconstructing from `pr_files.patch`" — precisely the spec's Assumption. Freeze `diff.raw`.
  **The fallback at `diff-loader.ts:37` silently skips files with no patch** — AC-7's named failure
  mode, and T5's validator is what turns it from a silent bad fixture into a named rejection.
- **Diff replay:** `parseUnifiedDiff(raw)` (`server/src/adapters/git/diff-parser.ts:14`) turns a
  frozen `input_diff` back into a `UnifiedDiff`. No clone, no GitHub (AC-6).
- **Line-overlap math:** `buildLineIndex(diff)` is already **exported**
  (`reviewer-core/src/grounding.ts:24`) — the scorer and the diff-freeze validator both use it, so
  the overlap rule has one implementation.
- **Untrusted wrapping (AC-42):** inherited for free via `reviewPullRequest` → `assemblePrompt` →
  `wrapUntrusted` + `INJECTION_GUARD`. Nothing to add. **Add no denylist.**
- **Workspace scoping (AC-39):** `getContext(container, req)` (`modules/_shared/context.ts:14-23`).
- **Rate limit (AC-41):** `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` — copied
  verbatim from the review-run route (`reviews/routes.ts:33`).
- Registration: one import + one key in `server/src/modules/index.ts:30-45`.

### 7.4 Server — `agents` module extensions (the AC-10 / AC-27 fix)

- **New** `agents/effective-config.ts`:
  `resolveEffectiveConfig(agentRow, linkedSkills) → { config: EvalEffectiveConfig; skillBodies: string[] }`.
  **Two outputs on purpose:** `config` is what gets **pinned by value** onto the run (ids + versions +
  order + enabled — AC-10); `skillBodies` is what the **executor feeds to `reviewPullRequest`** (the
  engine wants resolved *bodies*, `reviewer-core/src/review/run.ts:56`). The pin carries no bodies and
  the engine cannot use ids, so **both are needed** — an edge the first draft of this plan left
  implicit, and the reason T7 → T10 is now a dependency. Sources: the agent row +
  `AgentsRepository.linkedSkills(agentId)` (`repository.ts:209-221`, already returns the full skill row
  incl. `version`, ordered by `agent_skills.order`), filtered by the review path's rule
  `l.enabled && l.skill.enabled` (`reviews/run-executor.ts:220-222`).
- **New** `AgentsRepository.promoteConfig(workspaceId, agentId, cfg)` — **the version bump is
  promote's own responsibility, not `update()`'s** (§3 R-7). In one transaction:
  1. `setSkills(agentId, cfg.skills.map(s => s.id))` — **first**, so that
  2. the version bump + `agent_versions` snapshot, taken **after**, captures the **promoted** skill
     links rather than the pre-promote ones (`update()` snapshots internally at `repository.ts:161`,
     which is why the naïve `update()`-then-`setSkills()` order is wrong), and
  3. the bump is **unconditional** for any effective-config difference — including a **skill-only**
     one. `isConfigChange` (`helpers.ts:63-74`) does not consider skills and `UpdateAgent`
     (`repository.ts:32-43`) has no `skills` field, so relying on `update()`'s conditional bump would
     produce **no new version** on exactly the promote AC-27 was written for.
  **`isConfigChange` is NOT weakened** — that would change the general agent-update path, which is out
  of scope. No version is ever deleted or rewritten.
- **Extend** `AgentsRepository.deleteById` (`repository.ts:93-99`) to also delete
  `eval_cases WHERE owner_kind='agent' AND owner_id=:id` in the same transaction — the polymorphic
  `owner_id` has no FK, so Postgres will not do it (§3 R-3). Runs and drafts cascade via their real
  `agent_id` FK.

### 7.5 Client

No `src/features/` directory exists; the codebase's real convention is `app/<route>/_components/`.
Follow the code, not the aspiration.

- `client/src/app/evals/page.tsx` + `_components/EvalDashboard/**` — AC-29. **The nav needs no edit:**
  `client/src/vendor/ui/nav.ts:36` already points at `/evals`; creating the route *repairs* the
  dangling link.
- `client/src/app/evals/cases/{new,[id]}/page.tsx` + `cases/_components/EvalCaseEditor/**` — the
  pre-written breadcrumbs (`eval.json` `page.crumbNewCase` / `crumbEvalCase`) confirm these are pages.
- `client/src/app/evals/compare/page.tsx` + `compare/_components/**` — AC-24..28, 51, 52.
- `client/src/app/agents/[id]/_components/AgentEditor/`: one entry in `constants.ts:12-16` (which
  already comments "further lessons add Evals/Stats/CI") + a render branch in `AgentEditor.tsx:25-31`
  + `EvalsTab/**`. Tab validity is auto-derived from `TABS` (`agents/[id]/page.tsx:18`) and the label
  already exists (`client/messages/en/agents.json:50`) — **no other file changes.**
- `client/src/lib/hooks/evals.ts` — the single data-access surface. Poll an in-flight run with the
  `refetchInterval`-while-running idiom at `client/src/lib/hooks/reviews.ts:28-35`, **not** SSE (its
  buffer is in-process and does not survive a reload, which AC-11 requires).
- FindingCard: a third action in the actions block
  (`app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:121-142`), wired at
  `FindingsPanel.tsx:37,94` like Accept/Dismiss.
- **i18n:** `client/src/i18n/request.ts:16-25` globs `messages/en/*.json` — **there is no registry to
  edit** and `eval.json` is already loaded. Single locale (`en`). Because four UI tasks would
  otherwise all edit `eval.json`, **every missing key is added once, up front, in T3**.

### 7.6 REST surface (pinned here so client and server can be built in parallel)

| Method | Path | AC |
|---|---|---|
| `GET/POST` | `/agents/:agentId/eval/cases` | AC-5, AC-30, AC-40 |
| `GET/PUT/DELETE` | `/eval/cases/:caseId` | AC-4, AC-7, AC-53 |
| `POST` | `/eval/cases/from-finding` `{finding_id}` → `{case, created}` | AC-1, AC-2, AC-3, AC-7, AC-8 |
| `POST` | `/eval/cases/:caseId/draft` **[rate-limited]** | AC-47, AC-13 |
| `GET` | `/eval/cases/:caseId/draft` (poll) | AC-48 |
| `POST` | `/agents/:agentId/eval/runs` **[rate-limited]** → run in `running` | AC-9, AC-11, AC-13, AC-34 |
| `GET` | `/agents/:agentId/eval/runs` (history) | AC-44, AC-45 |
| `GET` | `/eval/runs/:runId` → `EvalRunDetail` (poll ⇒ "k of N") | AC-12 |
| `POST` | `/eval/runs/:runId/cancel` | AC-12 |
| `GET` | `/eval/compare?a=&b=` | AC-24, AC-25, AC-26, AC-51, AC-52 |
| `POST` | `/eval/runs/:runId/promote` `{acknowledge_regression?}` | AC-27, AC-28 |
| `GET` | `/agents/:agentId/eval/dashboard` | AC-30..33, AC-46, AC-49, AC-50 |
| `GET` | `/eval/dashboard` | AC-29, AC-33 |
| `POST` | `/eval/run-all` **[rate-limited]** (+ `GET /eval/run-all/preview`) | AC-35 |

All routes: `getContext()` → 404 on cross-workspace (AC-39); reject `owner_kind: 'skill'` (AC-40).

---

## 8. Parallelizable Tasks

20 tasks, 6 waves. **No two tasks own the same file.** Model tier is named per the standing
cost-discipline instruction; "inline" means the orchestrator edits directly and **does not spawn an
agent**.

> **`Depends-on` discipline.** Every edge below was re-derived from *the imports each task's files
> will actually contain*, not from narrative order. If a task's card describes calling another task's
> module, that task **is** a dependency. **A pinned interface does not make a non-existent module
> importable** — this is the error that produced v1's broken wave structure (§13).

| Task | Module | Files owned (`file:line` anchors) | Skills to apply | Model | Acceptance criteria | Tests to run | Depends-on | Batch |
|---|---|---|---|---|---|---|---|---|
| **T1** DB reshape + migration | server | `server/src/db/schema/eval.ts:7-35` (rewrite `evalCases`+`evalRuns`, add `evalCaseResults`+`evalDrafts`); `server/src/db/schema.ts:37,50-92`; **new** `server/src/db/migrations/0016_*.sql` + `meta/0016_snapshot.json` + `meta/_journal.json` | `postgresql-table-design`, `drizzle-orm-patterns` | sonnet | Exactly the four tables of §7.1, with: `eval_cases.source_finding_id` **UNIQUE** (AC-8 enforced in the DB); **`eval_cases.source_finding` jsonb** — the frozen snapshot of the seeding finding, which is the data path for AC-4's *original rationale* and AC-17's provenance chip (**`notes` stays the user's separate recorded reason — do not conflate**); `eval_cases.input_fingerprint` notNull (AC-14); `eval_runs.agent_id` FK **cascade** (AC-53 run cascade) + `effective_config` jsonb notNull (AC-10) + nullable metrics (AC-37) + `cases_done`/`cases_total` (AC-12) + `errored_count` (AC-36); `eval_case_results.case_id` FK **`ON DELETE SET NULL`** + `case_name` snapshot ("a run outlives its cases"); `eval_drafts` = **one row per draft**, never one slot per case (AC-49 needs a `SUM`), with a partial unique index on `(case_id) WHERE status='running'` (AC-13). `status` reuses `running\|done\|failed\|cancelled` — do NOT invent a vocabulary. Migration generated by `pnpm db:generate` (never hand-written); `pnpm db:migrate` applies clean on an empty DB. | `cd server && pnpm db:generate && pnpm db:migrate`; `cd server && pnpm exec vitest run .it.test` | — | — |
| **T2** Contracts (dual-vendored) **[shared: two-file edit ×2]** | shared | `server/src/vendor/shared/contracts/eval-ci.ts:20-89` + `client/src/vendor/shared/contracts/eval-ci.ts:20-89`; `server/src/vendor/shared/contracts/knowledge.ts:100-126` + `client/src/vendor/shared/contracts/knowledge.ts:100-126` | `zod`, `typescript-expert` | sonnet | Every shape in §7.2 exists **identically in both copies**. `EvalEffectiveConfig.skills` carries `{id,name,version,order,enabled}` — NOT bare ids. `EvalExpectedItem.kind` is required (it selects the match rule, AC-17). **`EvalSourceFinding` exists and is carried on `EvalCase`** (AC-4's original rationale + AC-17's chip) — **distinct from `notes`**. `EvalDashboard.current` metrics + `EvalRun` metrics are **nullable** (AC-31/32/37). `recent_runs: EvalRunSummary[]` (batch-shaped, AC-9). **DANGER: all four files are ALREADY DRIFTED between the copies** — the server `eval-ci.ts` has `AgentManifest` (`:144-172`) and server `knowledge.ts` has `AgentVersionConfig`/`AgentVersion` (`:371-394`), neither of which exists client-side. **Mirror ONLY your own additions. NEVER copy one file over the other, never "fix" the drift, never delete `EvalRunRecord`.** | `cd server && pnpm typecheck`; `cd client && pnpm typecheck` (both whole-project — ignore pre-existing sibling errors your diff did not cause) | — | — |
| **T3** i18n keys | client | `client/messages/en/eval.json`; `client/messages/en/prReview.json` | — | **inline — do not spawn an agent** | Add every missing key **once, up front**, so no UI task has to touch these files (they would collide): compare-view labels, `promote` (+ the AC-28 regression confirm), `MUST FIND`/`MUST NOT FLAG` badges, "Run all agents", `finding.turnIntoEvalCase` (+ its disabled reason, AC-2) in `prReview.json` beside `finding.accept`/`finding.dismiss`, the `errored` case state, the `draft` and `stale` markers, empty/never-run/not-yet-measured states, **the source-rationale vs recorded-reason labels (AC-4 — two distinct strings)**, the AC-21 citation help text ("cited a line inside a real diff hunk — not the *right* line") and the AC-23 line ("Scoring is mechanical — no model call in the scorer"). No registry edit: `client/src/i18n/request.ts:16-25` globs the dir. Single locale. | `cd client && pnpm test` | — | — |
| **T4** Scorer + fingerprint (**the heart**) | server + reviewer-core | **new** `server/src/modules/eval/scorer.ts`, `scorer.test.ts`, `fingerprint.ts`, `fingerprint.test.ts`; `reviewer-core/src/grounding.ts:16` (add `export`), `reviewer-core/src/index.ts` (re-export) | `typescript-expert`, `onion-architecture` | **opus** | **PURE — zero I/O, zero model calls (AC-23).** Match rule mirrors the gate exactly (AC-17): `kind ∈ FULL_FILE_KINDS` → **file equality only, no line check**; else file + line overlap via the already-exported `buildLineIndex` (`reviewer-core/src/grounding.ts:24`). Title/category/severity **never** participate. Import `FULL_FILE_KINDS` from reviewer-core by adding `export` to `grounding.ts:16` (zero-behaviour-change — OQ-3; if forbidden, re-declare it with a comment pointing at `grounding.ts:16`, but do NOT change its members). Metrics: recall = matched `must_find` items ÷ all such items, **null when the set has no `must_find` item** (AC-18 + the "—" edge case); precision = matching survivors ÷ **all** survivors across every case incl. negatives, **1.0 when zero survivors** (AC-19); citation = kept ÷ **every finding emitted** (kept + dropped, from the gate's own record — NOT re-derived, NOT narrowed to matched findings) — **1.0 when zero emitted** (AC-20). Errored cases excluded from **every** denominator (AC-36); all-errored → null metrics (AC-37). Per-case pass (AC-22): `must_find` passes iff **every** expected item is matched; `must_not_flag` passes iff no survivor overlaps the forbidden region (same kind-aware rule); an extra finding on a positive case does **not** fail it but **does** hit set precision. Fingerprint (AC-14): a content hash over the frozen diff + PR meta + expectation + expected items — deterministic, stable across processes. **Unit tests are COLOCATED (`src/modules/eval/*.test.ts`) and MUST be executed by `verify:l06` (T19)** — they are the only proof of AC-17..AC-22. They cover every numbered example in AC-18/19/20/22 verbatim. | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `cd reviewer-core && npm test` | T2 | **B-S1** |
| **T5** Diff-freeze integrity | server | **new** `server/src/modules/eval/diff-freeze.ts`, `diff-freeze.test.ts` | `typescript-expert` | sonnet | **PURE.** `validateFreeze(rawDiff, expectation, expectedItems, forbiddenRegion)` → ok \| a named rejection. Rules (AC-7): the diff **must** contain the file of every expected item and of a negative case's forbidden region — **no hunk at all for that file is a hard rejection**; and where the item's `kind` is **not** a full-file kind, a hunk on that file must **cover** the expected lines (new-side). Parse with `parseUnifiedDiff` (`server/src/adapters/git/diff-parser.ts:14`), check with `buildLineIndex` (`reviewer-core/src/grounding.ts:24`). The rejection **names the file and the lines**. This exists because `diff-loader.ts:37` (`if (!f.patch) continue;`) silently drops a file whose patch GitHub omitted — producing a case that is unsatisfiable by construction and reads as a permanent recall regression (`server/INSIGHTS.md:50`). Tests (colocated; executed by `verify:l06`): file absent → reject; lines outside every hunk → reject; full-file kind with the file present but no line overlap → **accept**. | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | T2 | — |
| **T6** Compare | server | **new** `server/src/modules/eval/compare.ts`, `compare.test.ts` | `typescript-expert`, `onion-architecture` | **opus** | **PURE.** Deltas computed **only** over cases the two runs share with an **identical input fingerprint** (AC-26). Report that shared count; **name** every excluded case and why (changed / added / removed); list every case whose pass/fail **flipped**, with direction. **Zero shared fingerprint-identical cases ⇒ `comparable: false` with a reason — never a delta, never zeros** (AC-26). Comparability is decided on the pinned **effective configs, never on version tags** (AC-51): same `agent_version` + different `effective_config` ⇒ set `effective_config_diverged` and name the skill delta (added / removed / version-changed / **reordered**) — the case where a skill re-link moved no version number (`agents/repository.ts:266-281` never bumps it), and without which a real regression renders beside an empty prompt diff and reads as "model noise". A run with **no** stored snapshot still yields deltas, with prompt-diff and skill-diff marked **unavailable** — never an error (AC-52). Two runs of the same version are comparable by design (AC-25). A draft is **never** an operand (AC-47). Emit both system prompts; the **client** renders the diff. Tests colocated; executed by `verify:l06`. | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | T2 | **B-S1** |
| **T7** Agents: effective config, promote, cascade (**the landmine**) | server | **new** `server/src/modules/agents/effective-config.ts` + `effective-config.test.ts`; `server/src/modules/agents/repository.ts:93-99` (cascade) and `:266-281` (new `promoteConfig`) | `onion-architecture`, `drizzle-orm-patterns`, `typescript-expert` | **opus** | **(a)** `resolveEffectiveConfig(agentRow, linkedSkills)` returns **both** `{ config, skillBodies }`: `config` is the value-pin (prompt, provider, model, strategy, `repo_intel`, and every resolved skill as `{id,name,version,order,enabled}` — AC-10); `skillBodies` is what the executor feeds `reviewPullRequest` (the engine wants resolved *bodies*, `reviewer-core/src/review/run.ts:56`; the pin carries no bodies and the engine cannot use ids — **both outputs are required**, which is why T7 → T10 is a dependency). Source skills from `AgentsRepository.linkedSkills()` (`repository.ts:209-221`, already returns the full skill row incl. `version`, ordered by `agent_skills.order`), filtered by the review path's rule `l.enabled && l.skill.enabled` (`reviews/run-executor.ts:220-222`). **Do NOT read `agent_versions` and do NOT return a version pointer** — `setSkills` bumps no version and writes no snapshot (`:266-281`, `:165-183`); `agent_version` is a **display label only**. **(b)** `promoteConfig(workspaceId, agentId, cfg)` (AC-27), in ONE transaction: **`setSkills` FIRST**, then an **UNCONDITIONAL version bump + `agent_versions` snapshot**. Both details are load-bearing and both are wrong in the obvious implementation: (i) `update()` snapshots **internally** (`repository.ts:161`), so `update()`-then-`setSkills()` would snapshot the **pre-promote** skill links; (ii) `isConfigChange` (`helpers.ts:63-74`) does **not** consider skills and `UpdateAgent` (`repository.ts:32-43`) has **no `skills` field**, so a promote differing **only** in its skill set would pass `update()` with no changed field and produce **NO version bump and NO snapshot** — failing AC-27's observable in precisely the skill-regression scenario this feature exists to catch. **Promote owns the bump; `isConfigChange` is NOT weakened** (that would change the general agent-update path, which this task must not do). No version is deleted or rewritten. Return any `skill_version_divergence` (a pinned skill whose live version has moved on — REC-3 / A-2). **(c)** Extend `deleteById` (`:93-99`) to also delete `eval_cases WHERE owner_kind='agent' AND owner_id=:id` in the same transaction — the polymorphic `owner_id` has **no FK**, so Postgres will not cascade it (AC-53); runs and drafts cascade via their real `agent_id` FK. **Existing agent behaviour is unchanged** — the review path is not touched (REC-1). Colocated unit test for the resolver; `promoteConfig`'s version-bump guarantee is asserted in T19 + T20. | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`; `cd server && pnpm exec vitest run .it.test` (`agents-versions.it.test.ts` must stay green) | T1, T2 | — |
| **T8** Eval repository | server | **new** `server/src/modules/eval/repository.ts` | `drizzle-orm-patterns`, `onion-architecture` | sonnet | Drizzle over the four eval tables. **Every method takes `workspaceId` first and filters by it** — a row from another workspace must be indistinguishable from a missing one (AC-39). Provides: case CRUD (+ `findBySourceFinding` for AC-8, + `deleteByOwner`), **returning the frozen `source_finding` snapshot on every case read** (AC-4/AC-17); run create/complete/cancel; `incrementCasesDone` (AC-12 — a persisted counter, so progress survives a reload); per-case-result insert; draft insert/complete + `latestDraftForCase` (newest row, AC-48) + `hasRunningDraft` (AC-13); `spendForAgent` → `{run_usd: SUM(eval_runs.cost_usd), draft_usd: SUM(eval_drafts.cost_usd)}` as **two separate figures that reconcile by construction** (AC-49); `inFlightRunForAgent` (AC-13); run history + trend (**every** run, each flagged `set_drifted`, AC-44/45). No HTTP, no LLM, no business rules. | `cd server && pnpm exec vitest run .it.test` | T1, T2 | — |
| **T9** Client hooks | client | **new** `client/src/lib/hooks/evals.ts` | `react-best-practices`, `frontend-architecture` | sonnet | One hook per endpoint in §7.6 — **the single data-access surface; no UI task may call `api` directly.** Copy the query/mutation shape at `client/src/lib/hooks/agents.ts:8-13` and `:34-40` (queryKey + `invalidateQueries`). For an in-flight run and an in-flight draft, poll with the self-clearing `refetchInterval: (q) => running ? 4000 : false` idiom at `client/src/lib/hooks/reviews.ts:28-35` — **not** SSE: its buffer is in-process and AC-11 requires the client to leave the page and come back. Types come from `@devdigest/shared` (T2); hand-write none. | `cd client && pnpm test`; `cd client && pnpm typecheck` | T2 | — |
| **T10** Eval run-executor | server | **new** `server/src/modules/eval/run-executor.ts` | `onion-architecture`, `typescript-expert` | **opus** | Executes a batch and a draft. **Same engine path as a real review (AC-15):** `parseUnifiedDiff(case.input_diff)` → `reviewPullRequest({systemPrompt, model, diff, llm, strategy, skills: <skillBodies from T7's resolver>, prDescription: <frozen PR meta>, checkCancelled})`. **No repo-derived slots** (`repoMap`/`callers`/`intent`/`specs`/`memory` stay empty — a frozen case has no repo, AC-6). The mandatory grounding gate runs inside the engine; **no eval-only path may bypass it**, and the model's self-reported score is discarded exactly as a real review discards it (AC-16). Untrusted wrapping + `INJECTION_GUARD` are inherited for free — **add no keyword or regex denylist** (AC-42, a hard repo rule). Citation accuracy's two numbers come from the engine's own record: `kept = outcome.review.findings.length`, `emitted = kept + outcome.dropped.length` (`reviewer-core/src/review/run.ts:110,226`) — **do not re-derive them** (AC-20). Cost/duration are **measured, not predicted** (`outcome.costUsd`; wall-clock) — a large diff may trigger map-reduce and cost more than one call. **Per-case failure is contained** (AC-36): catch, record `outcome:'errored'` + reason, continue, exclude from every denominator; **never** score an infra failure as a quality datum (root `INSIGHTS.md:63` — that mistake once produced a fictional 50-point regression). **All cases errored ⇒ run `failed` with NULL metrics** (AC-37) — not a zero. Bump `cases_done` after each case (AC-12). Check `runBus.isCancelled(runId)` between cases **and** pass it as `checkCancelled` into the engine (`reviews/run-executor.ts:293-295`) so an in-flight model call aborts. Scoring is delegated wholly to T4's pure scorer. | `cd server && pnpm exec vitest run .it.test` (with `MockLLMProvider` — `server/INSIGHTS.md:64`) | T2, T4, T7, T8 | — |
| **T11** Eval service | server | **new** `server/src/modules/eval/service.ts` | `onion-architecture`, `security`, `typescript-expert` | **opus** | Application layer, `Container`-injected (per `reviews/service.ts:30-43`). **Seed-from-finding** (AC-1/2/3/4/7/8): resolve via `findingContext(db, findingId)` (`reviews/repository.ts:138-142`); **neither `accepted_at` nor `dismissed_at` ⇒ reject, naming the reason — never a 5xx** (AC-2); accepted → `must_find` + that finding as the expected item, dismissed → `must_not_flag` + empty expected output + the finding as the forbidden region — **never ask the user to choose** (AC-3); **freeze the `source_finding` snapshot** (title, rationale, severity, category, kind, file, lines) onto the case so AC-4's *original rationale* and AC-17's chip have a data path that survives the finding being edited or deleted; capture the diff with `loadDiff(...)` (`reviews/diff-loader.ts:12-30`) and freeze `diff.raw`; run T5's validator and **reject the save** on failure (AC-7); a case already existing for that finding ⇒ **return the existing one, do not create a second** (AC-8). **Case save validation:** `must_find` needs ≥1 expected item, each with a file **and** a line range (AC-5); `must_not_flag` needs a **recorded reason** in `notes` — empty ⇒ rejected **naming the field** (AC-4; this is the *user's* reason, **a different field from the frozen `source_finding.rationale`**); re-validate the freeze on every diff edit (AC-7); recompute the fingerprint on every write (AC-14). **Start run:** resolve the effective config **at the moment the run starts** via T7 and pin `config` **by value** onto the run row (AC-10); the set is the agent's cases **as they stand right now** (AC-44); return immediately with a run id in a non-terminal status, then `void executor.executeRun(...)` — **never block the HTTP request** (AC-11), mirroring `reviews/service.ts:140`. **In-flight guards (AC-13):** reject a second run for an agent whose run is in flight **naming that run**; reject a second draft on a case; reject a draft while the agent's run is in flight. **Drafts (AC-47/48/49):** never in the run history, the trend, or any comparison; persisted as an `eval_drafts` row with its own config snapshot (so staleness is derivable); cost charged to the agent's **draft spend** as a distinct component. **Dashboards:** headline metrics, "N / M passing", and the alert derive from the **latest eval run only** and never move on a draft (AC-46/50); the passing denominator is that run's case count — deliberately allowed to be smaller than the current case count; a case the latest run never measured is **not-yet-measured**, neither pass nor fail (AC-50); zero cases ⇒ not-measured, never 0% (AC-31); the alert names which metric moved and in which direction vs the previous comparable run (AC-33). **Run-all** (AC-35) skips zero-case agents and exposes a preview naming total agents + total cases. **Promote** (AC-27/28): refuse a run with no snapshot (AC-52); if the promoted side is worse on **any** metric, return the regression and require explicit acknowledgement (AC-28); on confirm call T7's `promoteConfig` — **which owns the version bump; do NOT re-implement it here** — and surface any `skill_version_divergence`. A **disabled** agent's cases are read-only — no run, no draft, **no error** (AC-53). Every method is workspace-scoped (AC-39) and rejects `owner_kind: 'skill'` (AC-40). | `cd server && pnpm exec vitest run .it.test` | T4, T5, T6, T7, T8, **T10** | — |
| **T12** Client: Evals tab | client | `client/src/app/agents/[id]/_components/AgentEditor/constants.ts:12-16` (one entry); `.../AgentEditor.tsx:25-31` (one branch); **new** `AgentEditor/EvalsTab/**` | `next-best-practices`, `react-best-practices`, `frontend-architecture`, `react-testing-library` | sonnet | The tab renders between the existing tabs; the label already exists (`client/messages/en/agents.json:50`) and tab validity is auto-derived (`agents/[id]/page.tsx:18`) — **touch no other file**. Renders metric cards, the case list (per-case pass/fail **with a text label, not colour/icon alone** — a11y), a `MUST FIND`/`MUST NOT FLAG` badge per case, "expected N, got M", run-all / create / run / edit / delete controls (AC-30). **Zero cases ⇒ explicit empty state and "—" for every metric — NEVER 0%: an absent measurement and a measured zero must be visually distinct** (AC-31), Run disabled. **Cases but never run ⇒ "never run", "—", empty trend, Run enabled** (AC-32). Before starting a run, **name the case count** ⇒ the model-call count (AC-34); while running, show "k of N" from the polled run and offer **cancel** (AC-12). The trend chart plots **every** run, marks drifted points, and **never** plots a draft (AC-45). The authoritative "N / M passing" comes from the latest **run**, **names that run**, and does **not** move when a draft lands (AC-46/50); a case with a **newer draft** shows the draft's outcome **with a visible draft marker**; a case the latest run never measured shows **not-yet-measured** (AC-50). Show the AC-23 line and AC-21's citation help text. A delta never renders without its comparable-case count (AC-38). A disabled agent ⇒ controls disabled, no error (AC-53). Data via T9's hooks only; strings via T3 only. RTL tests: AC-31 vs AC-32 vs a measured zero are three distinct renders. | `cd client && pnpm test`; `cd client && pnpm typecheck` | T3, T9 | **B-C2** |
| **T13** Client: eval case editor | client | **new** `client/src/app/evals/cases/new/page.tsx`, `client/src/app/evals/cases/[id]/page.tsx`, `client/src/app/evals/cases/_components/EvalCaseEditor/**` | `next-best-practices`, `react-best-practices`, `react-testing-library` | sonnet | Two input tabs and **exactly two**: **Diff** and **PR meta**. **No "Files" tab** — the pre-written i18n has only `caseEditor.tabs.diff` and `caseEditor.tabs.prMeta` (`client/messages/en/eval.json:43-46`) and `input_files` reaches no model (AC-6). A `must_find` case may list **>1** expected item, each with a file **and** a line range; an item missing either is rejected at save **naming the field** (AC-5). **AC-4 requires TWO distinct texts and they must not be conflated:** the editor **renders the source finding's original rationale** (read-only, from the case's frozen `source_finding` snapshot — T2 types it, T8 reads it) **and** requires the **user's recorded reason** (`notes`) before a `must_not_flag` case can be saved — an empty reason is rejected and names the field. A save whose diff cannot satisfy the expectation is rejected with the server's message naming the file and lines — **the case is not persisted** (AC-7). The severity·category chip is **display-only provenance and participates in no match** (AC-17) — say so. "Run case" and a "Run on save" toggle produce a **draft** (AC-47): the footer reads the latest draft's outcome ("Last run passed · expected 1 finding, got 1 · 1.8s · $0.02") and **survives a reload** (AC-48); when the agent's config has changed since, the draft is marked **stale** rather than presented as current (AC-48). A second draft on the same case while one is in flight is refused (AC-13). Breadcrumbs use the existing `page.crumbNewCase` / `page.crumbEvalCase`. | `cd client && pnpm test`; `cd client && pnpm typecheck` | T3, T9 | **B-C1** |
| **T14** Client: `/evals` dashboard | client | **new** `client/src/app/evals/page.tsx`, `client/src/app/evals/_components/EvalDashboard/**` | `next-best-practices`, `react-best-practices`, `frontend-architecture`, `react-testing-library` | sonnet | The already-live nav entry (`client/src/vendor/ui/nav.ts:36`) resolves to a page instead of a dead link — **the nav file needs no edit; creating the route repairs it** (AC-29). Lists every agent with its latest run's recall/precision/citation and a "passed/total" count, plus a recent-runs table spanning **all** agents (AC-29). Agents with no cases / no runs render the not-measured state, **never 0%** (AC-31/32). An alert banner names which metric moved and in which direction vs the previous comparable run (AC-33), fed by the latest **eval run**, never a draft (AC-46). "Run all agents" opens a confirmation **naming both totals** (agents and cases) before a single model call is issued, and **skips zero-case agents** (AC-35). Agent eval spend shows its **draft component named**, so the run history's cost column and the total reconcile (AC-49). No delta renders without its comparable-case count (AC-38). a11y: direction of change is **never colour alone** — an arrow **and** a signed number; the trend series is exposed in text to a screen reader. Reuse `client/src/vendor/ui/charts/{LineChart,Sparkline,MetricCard}`; there is **no `Table` primitive** — compose rows with `Card`/flex as the codebase does elsewhere. | `cd client && pnpm test`; `cd client && pnpm typecheck` | T3, T9 | **B-C1** |
| **T15** Client: compare + promote | client | **new** `client/src/app/evals/compare/page.tsx`, `client/src/app/evals/compare/_components/**` | `next-best-practices`, `react-best-practices`, `react-testing-library` | sonnet | Select exactly **two runs of the same agent**; show before → after for recall, precision, citation and cost **with the direction of change**, plus a **line-level diff of the two snapshots' system prompts** (AC-24). Two runs of the **same** version are a legal comparison — that is how a user measures the noise floor (AC-25). **Every delta is accompanied by the count of fingerprint-identical shared cases, the named excluded cases, and the list of cases that flipped** — a 4-point recall delta on a 20-case set must visibly *be* one case flipping (AC-26, AC-38); the help text says a re-run of the same version can move a metric. **No shared case ⇒ render "not comparable", not a delta and not zeros** (AC-26). Where the two runs carry the **same version tag but different effective configs**, say so explicitly and show the **skill delta** (added / removed / version-changed / reordered) beside the empty prompt diff (AC-51) — without this the user's only available reading of a genuine skill regression is "model noise". A run with **no** snapshot still shows its deltas, with prompt-diff and skill-diff **unavailable** — the comparison must not error out (AC-52). **Promote** the chosen run's config; if that side is worse on **any** metric, surface it ("precision 93% → 91%") and require an explicit confirm — cancelling promotes nothing (AC-28). Surface any `skill_version_divergence` the promote returns (REC-3). Drafts are never selectable (AC-47). a11y as T14. | `cd client && pnpm test`; `cd client && pnpm typecheck` | T3, T9 | **B-C1** |
| **T16** Client: FindingCard action | client | `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingCard/FindingCard.tsx:121-142`; `.../FindingsPanel/FindingsPanel.tsx:37,94` | `react-best-practices`, `react-testing-library` | sonnet | Exactly **one** new action — a third control in the actions block beside Accept (`:122-131`) and Dismiss (`:132-141`), wired through the same `onAction` path used at `FindingsPanel.tsx:37,94` (AC-1). **Accept/Dismiss behaviour is unchanged.** On an **undecided** finding (neither `accepted_at` nor `dismissed_at`) the control is **disabled and names the reason** — a decision is what defines the expectation — and no case is created (AC-2). Invoking it twice yields **one** case; the second invocation navigates to / names the existing one (AC-8). Do **not** add "Learn" or "Reply to author" — in the mockup, not in scope. Strings from T3 (`prReview.json`). | `cd client && pnpm test` | T3, T9 | **B-C2** |
| **T17** Eval routes + registration | server | **new** `server/src/modules/eval/routes.ts`; `server/src/modules/index.ts:30-45` (one import + one key) | `fastify-best-practices`, `zod`, `security`, `onion-architecture` | sonnet | Exactly the surface in §7.6. **Transport only — zero business logic** (that is `service.ts`). Zod schemas come from `@devdigest/shared` (T2) and drive both validation and serialization via `fastify-type-provider-zod` — hand-roll no `parse`. **Every** handler calls `getContext(container, req)` (`modules/_shared/context.ts:14-23`) and threads `workspaceId` into every service call; a case/run/agent outside the caller's workspace resolves as **404, never another workspace's data** (AC-39). An `owner_kind` of `skill` is rejected with an explicit named error — the stored vocabulary is unchanged (AC-40). The three run-starting routes (`POST /agents/:id/eval/runs`, `POST /eval/cases/:id/draft`, `POST /eval/run-all`) carry `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` — copied verbatim from the review-run route (`reviews/routes.ts:33`), being LLM-calling, cost-incurring endpoints that fan out (AC-41). Every named failure (no decision, duplicate case, unsatisfiable diff, run in flight, no snapshot to promote, metric regression unacknowledged) is a handled 4xx with a reason — **never a 5xx**. | `cd server && pnpm exec vitest run .it.test` | T11 | — |
| **T18** Seed: demo agent + ≥8 cases | server | `server/src/db/seed.ts` (append a block before the `return` at `:352`) | `drizzle-orm-patterns` | sonnet | **Extends** the existing idempotent `pnpm db:seed` — **do not add a second seeding mechanism** (AC-55). Installs a demo agent with **≥8 eval cases mixing `must_find` and `must_not_flag`**, so the Eval Dashboard, run history and compare view render real data on first boot instead of empty states. Idempotent by the file's existing house pattern — select-by-`(workspaceId, name)` then conditional insert (`seed.ts:242-248`) or `.onConflictDoNothing()` (`seed.ts:296-299`); **re-running `db:seed` must not duplicate a case**. Each seeded case carries a frozen `source_finding` snapshot and (for the negatives) a recorded `notes` reason, so the case editor has **both** AC-4 texts to render. **CRITICAL: every seeded case must pass T5's own AC-7 validator** — its frozen diff must contain a hunk covering its expected item's lines, or, for a full-file kind, at minimum that file. A demo fixture whose diff does not cover its own expectation **fails its own scorer on first run and reads as a model regression** — the exact bad-fixture trap the spec warns about at AC-7 and that inverted an A/B verdict once already (root `INSIGHTS.md:17`). **Assert this by calling the validator over each fixture inside the seed itself, not by eye.** | `cd server && pnpm db:seed && pnpm db:seed` (twice — no duplicates); `cd server && pnpm exec vitest run .it.test` | T1, T4, T5 | — |
| **T19** Server test suite + `verify:l06` | server | **new** `server/test/eval-pipeline.it.test.ts`, `server/test/eval-scoring.it.test.ts`; `server/package.json:12` (add `verify:l06` beside `verify:l03`) | `typescript-expert` | sonnet | **Integration only** — the *unit* tests are owned and colocated by T4/T5/T6/T7; **do not duplicate or move them**. Filenames **must** end `.it.test.ts` (the CI lane split is by filename; renaming breaks it). The LLM is **always** mocked (`MockLLMProvider`, `src/adapters/mocks.ts`; gotchas at `server/INSIGHTS.md:64`) — assert only the **deterministic half**; never model prose, never a metric from a real model. Cover: workspace isolation → 404 (AC-39); skill owner → rejected (AC-40); undecided finding → rejected (AC-2); duplicate seed → one case (AC-8); unsatisfiable diff → rejected, **no case persisted** (AC-7); a run over a case whose repo was **deleted** still completes — no clone, no GitHub (AC-6); one provider failure in 20 → run completes, 19 scored + 1 errored, metrics over 19 (AC-36); **all** cases fail → run `failed`, **null** metrics, no trend point (AC-37); a second run while one is in flight → rejected naming it (AC-13); cancel → `cancelled`, no further model call (AC-12); editing a case changes its fingerprint (AC-14); deleting an agent leaves **no** readable orphaned case or run (AC-53); **promote makes the live config AND the linked skills equal to the run's snapshot and appends a new version — INCLUDING a promote whose config differs from the live agent ONLY in its skill set, which must still append a new version whose snapshot's `skills` array equals the promoted set** (AC-27; this is the R-7 hole — without this assertion the bug ships silently and green). **`verify:l06` (AC-54) MUST execute BOTH lanes** — the colocated pure tests (`src/modules/eval/*`, `src/modules/agents/effective-config`) **and** these integration tests. A gate that ran only `server/test/` would never execute the scorer/metric/match-rule tests and would be **green and hollow** — proving nothing about AC-17..AC-22, AC-26, AC-51 (§3 R-8). `server/vitest.config.ts:14` already includes `src/**/*.test.ts`, and `server/tsconfig.json:29` already excludes them from the build, so colocated tests are safe and `pnpm build` emits none into `dist/`. **Acceptance is NOT exit 0 alone:** the `verify:l06` output must visibly execute the scorer/metric tests (a non-zero passed count from `src/modules/eval/scorer.test.ts` et al.). No implementation file exists at two paths. | `cd server && pnpm verify:l06`; `cd server && pnpm build` | T10, T11, T17, T18 | — |
| **T20** Acceptance demo: the A/B experiment | server | **new** `server/test/eval-ab-experiment.it.test.ts`; `docs/plans/L06-eval-pipeline-demo.md` (runbook) | `typescript-expert` | sonnet | **The task that proves the pipeline measures something real** — without it the feature is plumbing nobody has pointed at anything. Drive a `MockLLMProvider` whose returned finding-set is a **function of the system prompt it receives** (a marker in the prompt selects finding-set A vs B). Fully deterministic, yet exercising the real path end-to-end: same engine entry point, same grounding gate, same scorer, no real model. Assert, over the ≥8-case seeded set (T18): **(a)** prompt v1 → improved prompt v2 ⇒ the metrics **move**, the comparison reports a non-zero delta, and the flipped cases **name exactly which cases moved** (AC-24, AC-26); **(b)** a deliberately **corrupted** prompt ⇒ **precision drops**, and it drops for noise emitted **anywhere in the set**, not only inside a forbidden region (AC-19); **(c)** two runs of the **unchanged** agent are comparable and their prompt diff is empty (AC-25); **(d)** link a skill between two runs ⇒ both runs carry the **same version tag** but **different effective configs**, and the comparison says so and names the skill delta rather than leaving "model noise" as the only reading (AC-51, AC-10); **(e)** promoting the winning run — **even when it differs only in its skill set** — appends a new version whose snapshot matches what that run measured (AC-27; the R-7 hole, asserted here end-to-end as well as in T19). The runbook documents how to reproduce (b) against a real provider by hand — the human-facing demo. | `cd server && pnpm exec vitest run .it.test` | T17, T18 | — |

**Batches** (safe to fuse into one implementer spawn — same module, no `Depends-on` between them, no
shared-contract edit): **B-S1** = {T4, T6} (both pure, both `modules/eval`, both opus).
**B-C1** = {T13, T14, T15} (all under `client/src/app/evals/**`, disjoint subtrees, one onboarding).
**B-C2** = {T12, T16} (both extend existing client surfaces). Everything else runs alone.
**T2 is never batched** — it is the shared-contract edit.

### Wave structure (re-derived from the `Depends-on` edges)

| Wave | Tasks | Why this boundary |
|---|---|---|
| **1** | T1, T2 (parallel) + **T3 inline** | Foundation. Nothing else can start. |
| **2** | T4, T5, T6, T7, T8 (server) ‖ T9 (client) | Everything here needs only T1/T2. **Six tasks, fully parallel.** |
| **3** | T10, T18 (server) ‖ T12, T13, T14, T15, T16 (client) | T10 needs T4+T7+T8; T18 needs T1+T4+T5. The five client tasks need only T3+T9 — they build against the REST surface pinned in §7.6, **not** against a running server. **Seven tasks, fully parallel.** |
| **4** | T11 | **T11 imports T10's executor** (`void executor.executeRun(...)`) as well as T4/T5/T6/T7/T8. It cannot typecheck before T10 exists. This edge was missing in v1 and is the single most consequential correction in this revision (§13). |
| **5** | T17 | Routes call the service; transport is thin and mechanical once T11's API is real. |
| **6** | T19, T20 (parallel) | Both need the full stack (T17 + T18); they own disjoint test files. |

---

## 9. `AC-N` → Task coverage

Every live AC maps to ≥1 task; every task traces to ≥1 AC. `AC-26a` and `AC-43` are **withdrawn by
the spec** and are deliberately uncovered.

| AC | Task(s) | AC | Task(s) |
|---|---|---|---|
| AC-1 | T16 | AC-29 | T14 |
| AC-2 | T11, T16, T19 | AC-30 | T12 |
| AC-3 | T11 | AC-31 | T2, T12, T14 |
| **AC-4** | **T1, T2, T8, T11, T13, T18** | AC-32 | T12, T14 |
| AC-5 | T2, T11, T13 | AC-33 | T11, T14 |
| AC-6 | T2, T10, T13, T19 | AC-34 | T12, T14 |
| AC-7 | T5, T11, T13, T18, T19 | AC-35 | T11, T14, T17 |
| AC-8 | T1, T11, T16, T19 | AC-36 | T4, T10, T19 |
| AC-9 | T1, T2, T10 | AC-37 | T4, T10, T19 |
| AC-10 | T2, T7, T11, T20 | AC-38 | T12, T14, T15 |
| AC-11 | T9, T11, T17 | AC-39 | T8, T17, T19 |
| AC-12 | T1, T8, T10, T12, T19 | AC-40 | T2, T17, T19 |
| AC-13 | T1, T8, T11, T19 | AC-41 | T17 |
| AC-14 | T1, T4, T10, T11, T19 | AC-42 | T10 |
| AC-15 | T10 | AC-26a | **WITHDRAWN** |
| AC-16 | T4, T10 | AC-43 | **WITHDRAWN** |
| **AC-17** | **T2, T4, T11, T13** | AC-44 | T1, T8, T11 |
| AC-18 | T4 | AC-45 | T8, T12 |
| AC-19 | T4, T20 | AC-46 | T11, T12, T14 |
| AC-20 | T4, T10 | AC-47 | T1, T10, T11, T15 |
| AC-21 | T3, T12 | AC-48 | T1, T10, T11, T13 |
| AC-22 | T4 | AC-49 | T1, T8, T11, T14 |
| AC-23 | T4, T12 | AC-50 | T11, T12 |
| AC-24 | T6, T15, T20 | AC-51 | T6, T7, T15, T20 |
| AC-25 | T6, T15, T20 | AC-52 | T6, T15 |
| AC-26 | T6, T15, T20 | AC-53 | T7, T11, T12, T19 |
| **AC-27** | **T7, T11, T15, T19, T20** | AC-54 | T19 |
| AC-28 | T11, T15 | AC-55 | T18 |

Bold rows changed in v2: **AC-4** gained its end-to-end data path (T1 frozen column → T2 contract →
T8 read → T11 write → T13 render → T18 seeded fixtures); **AC-17**'s display-only provenance chip
gained the same path; **AC-27** gained its version-bump assertions (T19, T20).

**Every task traces back:** T1→AC-4/8/9/12/13/14/44/47/48/49; T2→AC-4/5/6/9/10/17/31/40;
T3→AC-21 (+ every client task's strings); T4→AC-14/16..20/22/23/36/37; T5→AC-7; T6→AC-24/25/26/51/52;
T7→AC-10/27/51/53; T8→AC-4/12/13/39/44/45/49; T9→AC-11; T10→AC-6/9/12/15/16/20/36/37/42/47/48;
T11→AC-2..5/7/10/11/13/14/17/27/28/33/35/44/46..50/53; T12→AC-12/21/23/30..32/34/38/45/46/50/53;
T13→AC-4/5/6/7/17/47/48; T14→AC-29/31..35/38/46/49; T15→AC-24..28/38/47/51/52; T16→AC-1/2/8;
T17→AC-11/35/39/40/41; T18→AC-4/7/55; T19→AC-2/6..8/12..14/27/36/37/39/40/53/54;
T20→AC-10/19/24..27/51.

**The table closes:** 54 live ACs, 54 covered, 0 orphan tasks.

---

## 10. Testing Strategy

Canonical per-module commands: **`TESTING.md:63-74`**. The exact command for each task is in its
**Tests to run** cell. (The planner runs none of them.)

- **Server unit lane** (no Docker) — `vitest run --exclude '**/*.it.test.ts'`. This is where the
  feature's *judgment* lives: T4 (scorer + fingerprint), T5 (diff-freeze), T6 (compare), T7
  (effective-config resolver). Pure, so every metric rule in AC-17..AC-22 and every comparability rule
  in AC-26/51/52 is provable here with no Docker and no model. **These tests are colocated under
  `src/modules/**` and `verify:l06` MUST execute them** (§3 R-8) — `server/vitest.config.ts:14` already
  includes `src/**/*.test.ts`, and `server/tsconfig.json:29` already excludes them from the build, so
  `pnpm build` emits none into `dist/`.
- **Server integration lane** (testcontainers Postgres) — `vitest run .it.test`. **This change is a
  real schema change, so the DB-touching ACs must be judged here, not in the unit lane**: workspace
  isolation (AC-39), the `source_finding_id` uniqueness that enforces AC-8, the cascade in AC-53, the
  in-flight guards in AC-13, cancel (AC-12), the async run lifecycle (AC-11), and — critically — the
  **skill-only promote appending a new version** (AC-27 / R-7). **Filenames must end `.it.test.ts`**;
  the CI lane split is by filename and renaming breaks it.
- **The LLM is always mocked** (`MockLLMProvider`, `src/adapters/mocks.ts`; gotchas at
  `server/INSIGHTS.md:64`). Tests assert only the deterministic half — the match rule, the metric
  arithmetic over a fixed finding set, the gate's drop behaviour, the per-case pass rule, the
  errored-case exclusion, the fingerprint logic. **Never** model prose; **never** a metric produced by
  a real model.
- **Client** — `pnpm test` (Vitest + RTL). AC-31 vs AC-32 vs a measured zero must be three visibly
  distinct renders; the a11y rules (no colour-only direction, text pass/fail labels, screen-reader
  series values) are assertable.
- **reviewer-core** — `npm test`. Only T4 touches it (a two-line `export`); its suite must stay green
  to prove the gate's behaviour did not move.
- **The lesson gate — `pnpm verify:l06`** (AC-54) runs **both** lanes and is green. Its acceptance is
  **not merely exit 0**: the run must visibly execute the scorer/metric tests. A gate that exits 0
  without running them proves nothing about the feature's judgment (R-l). Note this makes the gate
  require Docker — see OQ-5.
- **`pnpm typecheck` is whole-project** (`server/INSIGHTS.md:44`): a parallel task **will** see sibling
  errors from files it does not own. **Judge only the errors your own diff caused; do not block on, and
  do not "fix", a sibling's error.**
- **Migrations are not applied on boot.** Any DB-touching task runs `pnpm db:migrate` first, or its
  integration suite fails with `relation ... does not exist`. To amend a generated migration, roll it
  back the documented three-file way (`server/INSIGHTS.md:94-101`) — **never hand-edit the SQL.**

---

## 11. Risks & Mitigations

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| R-a | **Someone "simplifies" the effective-config pin back to `(agent_id, version)`.** It looks purpose-built — the doc comment literally says "reproducibility for eval". Two runs tagged `v7` then measure different agents, and the compare view shows a real delta beside an empty prompt diff, steering the user to "model noise" — a false negative on the exact regression this feature exists to catch. | **High** | T7 owns the pin; its card forbids reading `agent_versions`. T2 types `EvalEffectiveConfig.skills` as `{id,name,version,order,enabled}[]`, so a bare id array will not typecheck. T20(d) asserts the same-tag/different-config case end-to-end. |
| R-b | **The four vendored contract files are already drifted; a well-meaning implementer "fixes" the mirror.** Copying one `eval-ci.ts` over the other silently deletes `AgentManifest`; copying `knowledge.ts` deletes `AgentVersionConfig`. | **High** | Exactly **one** task (T2) may touch them; its card names the drift, quotes the affected line ranges, and forbids file-level syncing. Repair the drift in the deferred CI spec, not here. |
| R-c | **AC-53's cascade cannot be a DB cascade.** `eval_cases.owner_id` is polymorphic with no FK, so an agent delete leaves orphaned cases that are still readable. | Medium | T1 gives `eval_runs`/`eval_drafts` a real `agent_id` FK (they cascade); T7 deletes the cases application-side inside `deleteById`. T19 asserts no orphan is readable. **A future `owner_kind:'skill'` will need the same treatment.** |
| R-d | **A bad seeded fixture inverts the demo.** A case whose frozen diff does not cover its own expectation fails its own scorer on first run and reads as a model regression. This has already happened in this repo and inverted an A/B verdict (root `INSIGHTS.md:17`). | **High** | AC-7 is a creation-time rejection (T5), and T18 must run that validator over **every** seeded fixture *inside the seed itself* — not check it by eye. |
| R-e | **The scorer drifts stricter than the gate.** If it requires line overlap for `secret_leak`/`lethal_trifecta`/`phantom`/`hook`, a correct agent reads as a recall regression. | **High** | T4 imports `FULL_FILE_KINDS` from `reviewer-core/src/grounding.ts:16` so there is one definition (OQ-3). Unit tests assert a full-file-kind case matches on file alone. |
| R-f | **The eval and review paths' skill-resolution rules diverge.** Two copies of `l.enabled && l.skill.enabled` will not stay equal forever — and the day they differ, the eval measures a differently-configured agent than the one that ships. | Medium | T7 centralises the rule in `effective-config.ts` and unit-tests it. **REC-1** would eliminate the second copy for 3 lines; not adopted, but recommended. |
| R-g | **Parallel implementers collide on a shared file.** `eval.json` (4 UI tasks), `evals.ts` hooks (5 UI tasks), `AgentEditor.tsx`. | Medium | Every shared file is pulled **forward** into a single owning task: T3 (all i18n keys), T9 (all hooks), T12 (the tab wiring). By Wave 3 every UI task only **reads** them. Ownership in §8 is disjoint by construction. |
| R-h | **A task's card describes a call the wave table does not permit.** v1 had T11 calling T10's executor with T10 absent from its `Depends-on` and both in the same wave — T11 could not have compiled. v1 rated this *Low* on the strength of "the interface is pinned". | **High** *(was Low — the review was right and I was wrong)* | Fixed: T10 → T11 edge added, waves re-derived (§8). **Every** edge re-derived from the imports each task's files will actually contain — which is also how the missing T7 → T10 `skillBodies` edge was found. The note above the task table now states that a pinned interface does **not** make a non-existent module importable. |
| R-i | **An infra failure gets scored as a quality datum** — the mistake that once put an agent 50 points below its own deliberately-weakened twin (root `INSIGHTS.md:63`). | **High** | AC-36/AC-37 explicit in T4 and T10: an errored case leaves **every** denominator; an all-errored run is `failed` with **null** metrics and **no** trend point — never a zero. T19 asserts both. |
| R-j | `server/package.json` was historically `skip-worktree` (`TESTING.md:83-86`), which would silently swallow the `verify:l06` edit. | Low | Verified: `git ls-files -v` shows **no** skip-worktree flags in this checkout. T19 may edit it normally. |
| R-k | **Promote silently appends no version on a skill-only promote.** `isConfigChange` (`helpers.ts:63-74`) ignores skills and `UpdateAgent` (`repository.ts:32-43`) has no `skills` field, so `update()` sees no changed field and bumps nothing — **AC-27's observable fails in exactly the skill-regression scenario the feature exists for.** A related ordering bug rides along: `update()` snapshots internally (`repository.ts:161`), so `update()`-then-`setSkills()` snapshots the **pre-promote** links. Both would have shipped silently and green. | **High** | T7's `promoteConfig` **owns** the bump: `setSkills` **first**, then an **unconditional** bump + snapshot, in one transaction. `isConfigChange` is **not** weakened (that would change the general update path). T19 **and** T20(e) assert a skill-only promote appends a new version whose snapshot's `skills` equals the promoted set. REC-4 tracks the residual root hole. |
| R-l | **The lesson gate is green and hollow.** A `verify:l06` scoped to `server/test/` never executes the colocated pure tests, so a green gate would prove nothing about AC-17..AC-22, AC-26, AC-51 — the very rules the feature *is*. Same disease as root `INSIGHTS.md:63`: a result with nothing behind it. | **High** | `verify:l06` runs **both** lanes (T19). Its acceptance is **not exit 0 alone** — the run must visibly execute the scorer/metric tests (a non-zero passed count from `src/modules/eval/*`), and §12 asserts their presence in the output. `server/tsconfig.json:29` already keeps colocated tests out of `dist/`. |

---

## 12. Success Criteria

- [ ] `pnpm verify:l06` exits 0 **and its output shows the colocated scorer / metric / match-rule /
      compare tests executing** (a non-zero passed count from `src/modules/eval/*` and
      `src/modules/agents/effective-config.test.ts`) — **exit 0 alone is not acceptance** (AC-54, R-l).
- [ ] `pnpm build` emits no test file into `dist/`; no implementation file exists at two paths.
- [ ] `pnpm db:migrate` applies `0016_*` clean; `pnpm db:seed` run **twice** yields ≥8 eval cases and
      no duplicates (AC-55), and **no seeded case fails its own AC-7 validator**.
- [ ] Server unit lane green; server integration lane green; client suite green; `reviewer-core` suite
      green.
- [ ] **A promote whose config differs from the live agent ONLY in its skill set still appends a new
      version, and that version's snapshot's `skills` array equals the promoted set** (AC-27, R-k) —
      asserted in both T19 and T20.
- [ ] The `/evals` nav entry resolves to a page instead of a dead link (AC-29).
- [ ] The negative-case editor renders **both** AC-4 texts and never conflates them: the source
      finding's **original rationale** (frozen, read-only) and the user's **recorded reason** (required
      to save).
- [ ] **The demo (T20) holds:** old prompt → new prompt moves the metrics and names the cases that
      flipped; a deliberately corrupted prompt **drops precision**; two runs of an unchanged agent
      compare with an empty prompt diff; and a skill linked between two runs produces two `v7` runs
      whose comparison says **"same version, different effective config"** and names the skill delta.
- [ ] An eval run completes for a case whose repository has been **deleted** from the workspace — no
      clone, no GitHub call (AC-6).
- [ ] Running one case ten times as a **draft** moves the agent's eval spend by 10× the call cost and
      moves **nothing** in the run history, the trend chart, or the "N / M passing" headline
      (AC-46..AC-50).
- [ ] Deleting an agent leaves **no** readable orphaned eval case or run through any surface (AC-53).
- [ ] Grep confirms **no keyword or regex denylist** was added anywhere in the eval path (AC-42), and
      **no eval-only path bypasses `groundFindings()`** (AC-15).
- [ ] Every one of the 54 live ACs is covered by ≥1 task in §9, and `plan-verifier` can trace each to
      code.

---

## 13. Revision log

**v2 (2026-07-13)** — amended after a cross-model plan review (skeptical-staff-engineer framing)
returned `revise_before_implementing` on v1. All four findings were re-verified against the code and
**all four were real**. Two further defects of the same class were found while re-deriving the
dependency edges. Nothing had been implemented, so this is a pure plan fix.

| # | Defect in v1 | Fix in v2 |
|---|---|---|
| 1 | **T11's `Depends-on` omitted T10**, yet T11's card told it to call `void executor.executeRun(...)` — and both sat in Wave 3. T11 could not have compiled. v1's own R-h named the hazard and rated it *Low* on the strength of "the interface is pinned"; **a pinned interface does not make a non-existent module importable.** | T10 → T11 edge added; waves re-derived (T11→W4, T17→W5, T19+T20→W6, now 6 waves). **Every** edge re-derived from actual imports. A `Depends-on` discipline note heads the task table. R-h re-rated **High**. |
| 2 | **`promoteConfig` would have appended no version on a skill-only promote** — `isConfigChange` (`helpers.ts:63-74`) ignores skills; `UpdateAgent` (`repository.ts:32-43`) has no `skills` field. AC-27 fails in exactly the scenario the feature exists for, silently and green. | T7 rewritten: promote **owns** an unconditional bump + snapshot; `isConfigChange` untouched. New §3 R-7, Risk **R-k**, assertions in T19 **and** T20(e), REC-4 for the root hole. |
| 3 | **`verify:l06` would have skipped the pure tests** — it pointed at `server/test/`, while T4/T5/T6/T7's unit tests are colocated under `src/modules/**` (and `server/vitest.config.ts:14` includes both trees). A green gate proving nothing about AC-17..AC-22, AC-26, AC-51. | `verify:l06` now runs **both** lanes; acceptance is **not exit 0 alone** but visible execution of the scorer/metric tests. New §3 R-8, Risk **R-l**, OQ-5 (the gate now needs Docker). Confirmed `server/tsconfig.json:29` already keeps colocated tests out of `dist/`. |
| 4 | **AC-4's "source rationale" had no data path** — no contract field, no repository read. T13 would have been blocked with nothing to render. | The case now **freezes a `source_finding` snapshot` (T1 column → T2 contract → T8 read → T11 write → T13 render → T18 fixtures). Chosen over a live join because it survives the finding being edited/deleted and **also** supplies AC-17's provenance chip, which had the identical hole. The plan now states in five places that the finding's **original rationale** and the user's **recorded reason** (`notes`) are two different fields. |
| 5 | *(found while re-deriving edges)* **`promoteConfig`'s ordering bug** — `update()` snapshots internally (`repository.ts:161`), so `update()`-then-`setSkills()` would snapshot the **pre-promote** skill links, and the new version would record the wrong skill set. | T7 now mandates `setSkills` **first**, bump + snapshot **after**. |
| 6 | *(found while re-deriving edges)* **T10 needs resolved skill *bodies*, which nothing produced.** The pinned config carries ids + versions (AC-10); `reviewPullRequest` wants bodies (`review/run.ts:56`). The plan had no producer for them. | T7's resolver now returns **both** `{ config, skillBodies }`; T7 → T10 edge added. |
