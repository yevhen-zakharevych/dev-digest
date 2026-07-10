---
name: impl
description: "Executes an EXISTING Implementation Plan from docs/plans/ end-to-end: parallel implementer waves by file ownership, a read-only review wave (plan-verifier + architecture-reviewer + /code-review), a bounded fix loop for review findings, a test-writer wave, the pr-self-review gate, and one engineering-insights write-up. Does NOT author specs or plans (run spec-creator / implementation-planner manually first). Trigger: /impl <docs/plans/…​.md> [extra instructions]."
metadata:
  tags: orchestration, sdd, implementation, review-loop, fleet
---

## When to use

Run `/impl <path-to-plan>` when a plan already exists in `docs/plans/`. This skill
covers phases ①–⑦ of the full loop in `.claude/agents/README.md` — everything
AFTER planning.

Out of scope, on purpose:
- **No spec authoring, no planning.** `spec-creator` and `implementation-planner`
  are invoked manually, before this skill. If the argument is not an existing
  `docs/plans/*.md` file, stop and tell the user to run the planner first.

## Inputs

- `$1` — path to the plan (required). If omitted, list `docs/plans/*.md` sorted by
  mtime and ask the user which one.
- Everything after the path — extra instructions/constraints; they amend task cards
  but never silently override the plan. A conflict with the plan → ask the user.

## Steps

### 1. Intake

1. Read the plan. Read the spec it cites (its `Source` column / header) — you will
   need the `AC-N` ids and the spec path for reviewer spawns.
2. Session protocol: read root `INSIGHTS.md` + the `INSIGHTS.md`/`AGENTS.md` of every
   module the plan touches (`client/`, `server/`, `reviewer-core/`, `e2e/`).
3. Sanity-check the task table: every task has a disjoint "Files owned" set
   (`INSIGHTS.md` — collision safety is file ownership, not isolation). Overlapping
   ownership → stop and report; do not "fix" the plan yourself.

### 2. Implement (waves of parallel implementers)

1. Group tasks into waves by `Depends-on`; fuse tasks sharing a `Batch` id into one
   spawn (never across a `Depends-on` edge or a shared-contract two-file edit).
2. **Orchestrator does trivial work inline** — a mechanical ≤10-line edit (contract
   field, i18n key, constant flip) is cheaper done directly than via an agent spawn.
   Run the module typecheck immediately after each inline edit, not batched.
3. Spawn each wave's `implementer` agents **in one message**. Each gets ONLY its
   task card (files owned, skills named on the card, tests to run, relevant `AC-N`
   ids + spec path, **and the 3-5 `INSIGHTS.md` landmines that touch its files,
   quoted inline with `file:line`**) — never the full plan. Hoisting the landmines
   is mandatory, not optional: it is what lets each implementer skip reading
   `INSIGHTS.md` wholesale. You already read every `INSIGHTS.md` once at intake
   (step 1) — extract the relevant few per task; do not make N scoped agents each
   re-read the whole landmine log (one root `INSIGHTS.md` × N agents is the single
   largest avoidable fan-out cost — measured at ~14 re-reads of one 26k-token file
   in the L05 fleet).
4. Model routing per spawn (README "Orchestration policy"): Haiku — mechanical
   ≤3 files no new logic; Sonnet — self-contained/single-surface (the default);
   Opus — ONLY hard cross-module integration. **Floor:** anything touching
   `platform/container.ts`, adapters, or cross-module wiring runs on Opus.
5. A dual-vendored `vendor/shared` edit is ALWAYS a two-file mirrored edit assigned
   to one owner (task or inline), and budget for fixture fallout: grep existing test
   fixtures that construct the changed contract by name.

### 3. Review wave (spawn both agents in ONE message — they are independent)

- `plan-verifier` (Sonnet) — give it the plan path + spec path; verdict per `AC-N`.
- `architecture-reviewer` (Opus) — give it the branch diff scope.
- While they run, invoke `/code-review medium` inline (the correctness lane —
  architecture-reviewer refuses bugs by design).
- Conditionally add `/security-review`: only when the diff touches auth, secrets,
  file upload, or user-input handling paths.
- Reviewers trust green suites: they READ tests and spot-check, they do not re-run
  the full suites the implementers already passed.

### 4. Fix loop (bounded — max 2 iterations)

Exit condition: **no CRITICAL/WARNING architecture findings, no MISSING/PARTIAL
requirements, no CRITICAL correctness findings.** SUGGESTION-level findings never
trigger an iteration — carry them to the final report.

Per iteration:
1. Consolidate all findings into **amended task cards** (finding + file:line + fix
   direction), grouped by disjoint file ownership. Never re-onboard the full plan.
2. Spawn fix `implementer`s in parallel (same model routing; most fixes are
   Sonnet or Haiku).
3. **Narrowed re-review:** `architecture-reviewer` on the fix diff only;
   `plan-verifier` on the previously MISSING/PARTIAL rows only; skip `/code-review`
   unless the fix wave changed >50 lines of logic.

After 2 iterations with findings still open: STOP. Report the remaining findings
honestly and let the user decide — do not grind further iterations.

### 5. Test-writer wave (parallel by file-set)

Runs AFTER the fix loop settles the code's shape — tests written earlier get thrown
away the moment an architecture finding moves a function.

1. Group new-test work by disjoint file-set; spawn `test-writer` agents (Sonnet) **in
   one message**.
2. **Hand each `test-writer` the spec file path + the exact `AC-N` ids it must cover** —
   never the diff alone. Expected values come from the spec's `_(observable: …)_`
   hints, never from the implementation (a diff-only `test-writer` mirrors whatever the
   code does — the self-verification loop). This is mandatory, not optional.
3. `test-writer` runs each suite to green then mutation-checks it (green against correct
   code, red against mutated code); it never weakens an assertion to pass.
4. Each returns an `## Insights` section and touches no `INSIGHTS.md` (concurrent-append
   hazard — the orchestrator writes once in wrap-up).
5. Short `plan-verifier` second pass: only the Definition-of-Done rows and rows that came
   back MISSING/PARTIAL in step 3.

### 6. Final gate

1. Run the full verification the plan names (typecheck + unit + `*.it.test.ts`
   where touched) if any inline edits or fixes landed after the last agent-run
   suites — otherwise trust the implementers' green runs.
2. Invoke `/pr-self-review`. A CRITICAL there blocks the "ready" verdict.

### 7. Wrap-up

1. Invoke `engineering-insights` ONCE, feeding it the `## Insights` sections the
   agents returned (they write no files themselves — concurrent-append hazard).
2. Final report to the user:

```
/impl — <plan slug>
────────────────────────────
Tasks: <done>/<total>  (inline: N, agents: N — haiku/sonnet/opus split)
Review: plan-verifier <n MET / n total AC>, architecture <n findings>, code-review <n>
Fix loop: <k> iteration(s); remaining OPEN findings: <list or none>
Tests: test-writer <n suites, AC covered> ; second-pass verifier <n MET>
Gates: pr-self-review <PASS/BLOCKED>
Deferred: carried SUGGESTIONs
```

## Hard rules

1. Never author or amend the spec or the plan — those agents run manually.
2. `test-writer` is handed the spec path + `AC-N` ids, never the diff alone; never
   weaken or delete an existing test to go green.
3. Parallel spawns only with disjoint file ownership; shared files go last, alone.
4. The fix loop is capped at 2 — an honest stop beats a token grind.
5. `AC-N` ids travel verbatim into every reviewer/implementer spawn prompt.
