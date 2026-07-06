# Repo-wide INSIGHTS

Landmines, surprises, and engineering insights that span more than one module.
Module-specific insights live in `<module>/INSIGHTS.md`.

> Append-only. New entries go into the section that best fits. Each entry must
> be actionable cold and cite `file:line`. If it would be obvious to anyone
> reading the code, do not write it. The `engineering-insights` skill writes
> here.

## What Works

_No entries yet._

## What Doesn't Work

_No entries yet._

## Codebase Patterns

_No entries yet._

## Tool & Library Notes

**Attaching skills to a `.claude/agents/*.md` subagent: `skills:` preloads the body, `Skill` tool invokes on demand — they are different mechanisms.** To have a subagent load a skill's *full content* at startup, list it under the `skills:` frontmatter field (NOT by adding `Skill` to `tools`). A subagent can still invoke any other project/user skill dynamically at runtime as long as the `Skill` tool is in its `tools:` list. We use both deliberately: `planner.md:9` preloads only the two architecture skills (`onion-architecture`, `frontend-architecture`) via `skills:` so planning is grounded in real practice content, while `implementer.md` keeps `Skill` in `tools` and invokes the backend/UI skill set on demand (preloading every set would bloat context for an agent that does both UI and backend). `permissionMode: plan` (planner.md:8) makes an agent runtime-read-only — stronger than merely omitting Write/Edit from `tools`.

**Parallel implementer agents share the working tree — collision safety is by file ownership, not isolation.** `implementer.md` intentionally omits `isolation: worktree`; multiple implementers run in the same branch/checkout. The only thing preventing overwrites is the planner decomposing tasks so no two own the same file (`planner.md` task table + "Files owned" column). If you re-enable parallelism, keep task file-sets disjoint or add `isolation: worktree` back.

## Recurring Errors & Fixes

_No entries yet._

## Session Notes

### 2026-06-25 — Cost & Tokens Surfacing

**Vendored `shared` lives in TWO places — every contract edit is a two-file edit.**
`server/src/vendor/shared/contracts/*.ts` and `client/src/vendor/shared/contracts/*.ts` are logically the same source but physically separate files. `client/CLAUDE.md` calls this out, but it's easy to forget mid-edit and the symptoms are nasty: typecheck passes on each side independently, but at runtime Zod rejects the wire payload (server emits a field the client schema doesn't know, or vice versa). During this feature I had to mirror three changes in lockstep: `cost_usd` on `RunSummary` and `RunStats` (`trace.ts`), and `cost_usd_cycle` on `PrMeta` (`platform.ts`). The minor cosmetic differences between the two copies (slightly different docstrings) make `diff -u` noisy — verify diffs with `diff -u | grep -v '^[-+]\s*///\?'` or compare just the schema shapes.

Future cleanup question: can these two trees be replaced with a single source via path alias (the way `reviewer-core` is consumed)? Currently they aren't — it's a deliberate vendoring per the root `CLAUDE.md` ("NOT a workspace. Each package owns its `package.json` + lockfile").

### 2026-07-02 — Four new subagents (test-writer, architecture-reviewer, plan-verifier, doc-writer)

**Adding several `.claude/agents/*.md` files in parallel: give each implementer ONE file, and put the shared `README.md` catalog update in a separate task that depends on all of them.** The four agent files are fully disjoint (one file each) so four implementers ran in parallel with no collision (per the file-ownership rule at `INSIGHTS.md:27`); the single coordination hazard is `.claude/agents/README.md` (catalog table + "Skill wiring" + "What these agents are based on"), which every task would otherwise touch — treat it like the shared-contract hazard and do it last, alone. Creating the file is enough for the harness to auto-register the agent (a "New agent types are now available" notification fires mid-session; no restart needed).

**Read-only vs write subagents split cleanly on frontmatter and this is worth validating mechanically.** Read-only reviewers (`architecture-reviewer.md`, `plan-verifier.md`) = `tools: Read, Grep, Glob, Bash` + `permissionMode: plan`, NO Edit/Write/Skill. Write agents (`test-writer.md`, `doc-writer.md`) = `Read, Edit, Write, Bash, Grep, Glob, Skill`, NO `permissionMode`. Skill wiring follows `INSIGHTS.md:25`: `architecture-reviewer` *preloads* the two architecture skills via `skills:` (like planner); `test-writer`/`doc-writer` invoke skills dynamically via the `Skill` tool; `plan-verifier` does neither (lean — names principles only). A quick `awk`-extract-frontmatter + `grep` check catches a read-only agent accidentally shipped with write tools before it's ever invoked.

**Refinement (same session): the `Skill` tool does NOT break read-only — `permissionMode: plan` does the gating, so a read-only reviewer can safely carry `Skill` to load skills on demand.** `architecture-reviewer.md:8` was updated to `tools: Read, Grep, Glob, Bash, Skill` so it can *preload* the two architecture skills AND *invoke* others (`zod`, `security`, backend/UI sets) when a diff needs a rule to judge a boundary — hybrid wiring, like a read-only version of the planner+implementer split. Invoking a skill only loads instructions; it writes nothing, and plan mode still forbids all mutations. So the read-only invariant to validate is "no `Edit`/`Write` + `permissionMode: plan`" — NOT "no `Skill`." `plan-verifier` still deliberately carries no `Skill` (lean, names principles only), so the two read-only agents now differ on purpose.

### 2026-07-03 — Intent Layer Task B (feature-model default flip)

**`git diff` blob hashes are a fast, zero-tooling way to confirm two vendored contract copies stay byte-identical after a mirrored edit.** After flipping `review_intent`'s `defaultProvider`/`defaultModel` identically in `server/src/vendor/shared/contracts/platform.ts` and `client/src/vendor/shared/contracts/platform.ts`, `git diff --stat` showed both files reporting the exact same `index dd3173b..e3aef45` blob-hash pair — proof the two files were identical before AND after the edit, without needing a manual `diff -u` (which the `INSIGHTS.md:38` note warns is noisy due to docstring differences). If the hashes ever diverge after a "mirrored" edit, the two copies were NOT byte-identical to begin with, or the edit wasn't applied the same way in both — worth checking before trusting a mirror edit is complete.

### 2026-07-03 — Intent Layer review fixes: `GitClient.readFileSafe` added to the port

**Adding a NEW method to a dual-vendored port interface (`adapters.ts`, not a `contracts/*.ts` Zod schema) still requires the identical two-file edit — the "every contract edit is a two-file edit" rule (`INSIGHTS.md:37-40`) is NOT limited to Zod contracts.** `GitClient.readFileSafe(repo, relPath): Promise<string | null>` was added to `server/src/vendor/shared/adapters.ts` and `client/src/vendor/shared/adapters.ts` in the SAME session, with byte-identical JSDoc + signature (verified via `git diff <file> | grep '^+'` on both, since the surrounding `GitClient` interface bodies differ between the two copies — server's has `sync`/`diffNameOnly` that client's lacks — so a raw `diff -u` of the whole files is not meaningful here; only the ADDED lines need to match). Since `adapters.ts` is a plain TypeScript interface (no Zod, no runtime validation), a one-sided edit wouldn't even fail at runtime the way a Zod contract drift does (`INSIGHTS.md:38`) — it would just silently make the client's `GitClient` type narrower, caught only by `pnpm typecheck` on the client if something there depended on the new method (nothing currently does, since client doesn't run git ops directly — but the port interface should still stay a faithful mirror for anyone reading it as the contract).

### 2026-07-03 — Intent Layer (L03) built by an agent fleet in two waves

**The whole Intent Layer feature was ~80% pre-scaffolded as an unused lesson stub — the load-bearing planning step was discovering what already existed, not designing from scratch.** Before writing any code, three parallel `researcher` agents found: the `pr_intent` table already migrated (`server/src/db/schema/reviews.ts:48-55`), the `Intent` contract + `PrIntentRecord` already defined (`brief.ts:9-14`, `review-api.ts:59-61`), `upsertIntent`/`getIntent` repo functions already written with ZERO callers (`pull.repo.ts:47-68`), the `review_intent` feature-model already registered in all three synced copies (just defaulting to the wrong `openai`/`gpt-4.1`), and the Settings model-picker already rendering it via a generic `FEATURE_MODELS.map`. The lesson (root `CLAUDE.md`: "Empty tables are intentional — a lesson fills them") means the first move on ANY lesson feature here should be an exhaustive grep for pre-built contracts/tables/registry entries — implementing from scratch would have duplicated all of it. The reviewer-core `INJECTION_GUARD` even already named "derived intent/scope" as untrusted (`reviewer-core/src/prompt.ts:16-28`), i.e. the prompt was written anticipating this feature.

**Wave-based decomposition with disjoint file ownership let 4 then 2 `implementer` agents run in parallel on a shared tree with zero collisions — the discipline that made it safe was the plan's per-task "Files owned" column (`docs/plans/intent-layer.md` §9), enforcing `INSIGHTS.md:27`.** Wave 0 = {reviewer-core slot, feature-model flip, pure server helpers, client hooks} — four fully disjoint file sets. Wave 1 = {server service+routes+executor, client card+wiring+i18n} — two disjoint sets that each depend on Wave 0 outputs. Each agent independently ran its own module's typecheck at completion; because the tree is shared, the LAST agents in each wave effectively integration-typechecked everyone's changes. Post-implementation, read-only `architecture-reviewer` + `plan-verifier` ran in parallel and each surfaced exactly one actionable gap the implementers missed (a leaked `node:fs` sandbox → port method; an inline-plan truncation regressing a stated requirement) — the two-reviewer split (boundaries vs requirement-coverage) caught non-overlapping classes of defect, worth repeating.

### 2026-07-04 — Smart Diff (L03) built cross-module by an agent fleet + reviewed

**Same pre-scaffolding pattern as Intent Layer (`INSIGHTS.md:60`): the SmartDiff feature had ZERO shared-contract edits because the entire wire contract already existed byte-identical in both vendored copies.** `SmartDiff`/`SmartDiffGroup`/`SmartDiffFile`/`ProposedSplit` (`server|client/src/vendor/shared/contracts/brief.ts:81-113`) + `SmartDiffResponse` (`review-api.ts:63-65`), and the `smartDiff.*` i18n strings (`client/messages/en/prReview.json:53-62`) were all pre-scaffolded. The load-bearing planning move was again "discover what already exists" (three researcher agents, server+client+deep-link mechanics) before designing — implementing from scratch would have duplicated the contract and strings. The classifier just deterministically composes already-persisted `pr_files` + latest-review `findings` into the frozen shape (compute-on-read, no LLM, no persistence). Final `git status` confirmed both `vendor/shared` trees untouched.

**Wave-based fleet with disjoint file ownership absorbed a mid-task requirement addition without replanning from scratch.** After the plan was written and Wave 0 dispatched, the user added "clickable per-line finding badges → deep-link to the Findings tab + auto-expand that FindingCard, no reload." Handled by: (a) one focused `researcher` pass on the Findings-tab/tab-nav mechanics (not a full re-plan), then (b) splitting the client work into `C2` (pure `SmartDiffViewer` render, owns `SmartDiffViewer/*`) and a NEW Wave-2 `C3` (integration + deep-link, owns `page.tsx`/`DiffTab`/`FindingsTab`/`FindingsPanel`/`FindingCard`), with `C3` depending on `C2`. Final shape: Wave 0 {S1, C1} → Wave 1 {S2, C2} → Wave 2 {C3}. Disjoint "Files owned" per task (`INSIGHTS.md:27`) held across all 5 — zero collisions on the shared tree.

**When a frozen contract lacks fields a new UI needs, prefer a CLIENT-SIDE join over a contract edit if the data is already loaded elsewhere on the page.** The added requirement needed per-line severity + a specific `findingId`, but `SmartDiff.finding_lines` is just `number[]` (no severity/id). Rather than extend the dual-vendored contract (a two-file edit, `INSIGHTS.md:37-40`), `SmartDiffViewer` joins the already-loaded `usePrReviews` findings (the exact data the Findings tab renders) by `file`+line-range to get severity+id per line — so every badge provably maps to a real, openable `FindingCard`. The deep-link then reused existing machinery almost entirely: tab/param nav (`page.tsx` `setParam`/`router.replace`, with the existing `?trace=` param as precedent for a 2nd coexisting query param) and `ReviewRunAccordion`'s existing `targetRunId`/`targetNonce` force-open+scroll; the ONLY genuinely new mechanism was a mirrored `targetFindingId`/`targetNonce` on `FindingCard`. Note `finding.review_id→review.id→review.run_id` resolution is required because a finding carries `review_id`, not `run_id`.

**The parallel read-only review wave (architecture-reviewer + plan-verifier) again caught non-overlapping defect classes — worth repeating (as at `INSIGHTS.md:62`).** `plan-verifier` traced 16/16 requirements to code as PASS (requirement-coverage lens); `architecture-reviewer` (boundaries lens) independently caught one MAJOR the five implementers missed: a **circular import** — `FindingTargetContext` was created in `FindingsTab.tsx` but imported back by its own render-subtree descendant `FindingsPanel.tsx` (cycle FindingsTab→ReviewRunAccordion→FindingsPanel→FindingsTab), surviving only by render-time-lazy context evaluation. Fixed by extracting the context to route-local `_lib/findingTarget.context.ts` so both provider and consumer import a neutral leaf module. A one-shot fix wave (2 parallel implementers: the cycle + a NIT dropping an unused `Container` injection from `SmartDiffService`) closed both, all suites green.

## Open Questions

_No entries yet._
