# Retro — Multi-Agent Review (L07)

Session `1f3ca111-81ae-4658-88b1-00e7df23ba95` · 2026-07-21 · span 91.4 min

## Shape

**10 agents** — 1 `implementation-planner` (which self-spawned 3 `researcher`s at depth 2),
4 `implementer`, 1 `architecture-reviewer`, 1 `plan-verifier`. Models: 5 opus / 5 sonnet.

Depth-1 wave structure: **1 → 2 ∥ → 2 ∥ → 2 ∥** (planner, then server wave, then client wave,
then the review wave). Agent wall-clock (≥1 agent live) **55.4 min** against **87.2 min** if the
same work had run serially — parallelism bought ~32 min, ~36%.

> **Correction to the skill's own wave heuristic.** Interval-overlap grouping reports "wave 0:
> n=4, straggler 6.11×", which is an artifact: the 3 researchers are the planner's *children*
> (`spawn_depth: 2`), so they are nested inside its 16.5 min, not siblings stalled at a barrier.
> **Compute waves over depth-1 agents only, or a parent will always look like a straggler next to
> its own children.** The three real parallel waves each have a straggler ratio of **1.00×**.

## Cost

| | Output | Cache-read |
|---|---|---|
| Main thread | 226.5k | 39.4M |
| Agents (10) | 301.4k | 83.4M |
| **Total** | **~528k** | **~122.7M** |

Main thread wrote **43%** of all output tokens — the orchestrator did a large share of the work
itself (43 `Edit` + 44 `Bash` calls: the spec revisions, both review fixes, the regression test,
the mutation check, and every verification pass).

Three most expensive agents by cache-read: **T1** (21.2M / 36.6k out / 93 tools),
**T3** (20.9M / 65.9k out / 89 tools), **T4** (13.4M / 37.9k out / 97 tools).

Cache-read is **232× output** — again the dominant cost of a fan-out, and again not visible in
output-token counts. 520 agent tool calls, **6 tool errors** (1.2%), no cluster: 3 in T1, 2 in T4,
1 in T3, zero in every read-only agent.

## What worked

- **Fix-loop iterations: 0 agent-driven.** Both confirmed review findings (the `FindingCard`
  cross-route import, the missing AC-13 cache invalidation) were fixed **inline by the
  orchestrator** — a folder move plus two import edits, and a 4-line `onSuccess`. No fix wave was
  spawned. Second run in a row at zero (cf. `onboarding-generator`), and this time with a real
  review gate that actually found defects.
- **The two-reviewer split paid for the third consecutive run.** `plan-verifier` marked
  `FindingDetailPanel.tsx:19` **PASS** (AC-17 only asks that the existing `FindingCard` be reused —
  it is); `architecture-reviewer` marked the same line **CRITICAL**. Conversely the AC-13 stale-cache
  defect is invisible to a boundaries lens and was caught only by requirement tracing. Neither
  reviewer alone would have shipped this correctly. Combined cost: 41.4k output, 14.1M cache-read.
- **The ≤5-task ceiling held and the planner beat it** — 4 tasks, 2 waves, zero file collisions
  across a shared tree. Both parallel implementation waves have a straggler ratio of 1.00×, i.e.
  the pairing was well balanced and no agent idled at a barrier.
- **Landmine-hoisting held.** Zero agents read root `INSIGHTS.md`; the orchestrator quoted 5–8
  relevant entries with `file:line` into each spawn prompt. (Baseline: 14 re-reads in the
  2026-07-10 project-context run.)
- **Telling read-only reviewers "suites are green, do NOT re-run them"** redirected their whole
  budget into reading. `plan-verifier` used it to check tests for *non-vacuity* — e.g. that AC-19's
  inertness test clicks an **enabled** eval-case button — which is worth more than re-running a
  suite the orchestrator had already run twice.

## What it cost us

- **The spec was read 6 times and the plan 5 times** — the two most duplicated reads of the run,
  and both are *unavoidable by design* (every agent legitimately needs its contract). But at ~600
  lines each that is ~11 re-reads of ~1,200 lines. A per-task **extract** (the 3–4 ACs that task
  discharges, inlined into the spawn prompt) would cut most of it. This is the single largest
  remaining duplication now that `INSIGHTS.md` re-reads are solved.
- **7 files were read by ≥3 agents** (spec, plan, `observability.ts`, `run.repo.ts`,
  `schema/runs.ts`, `multi-agent/[number]/page.tsx`, `runs.json`). The last three are review-wave
  re-reads of freshly written code — irreducible.
- **T3 produced 65.9k output on sonnet, the largest of any agent**, ~1.8× T1's on opus. The task
  was genuinely large (two pages + nav + a deletion), but it is the one task that most deserved
  splitting under a higher ceiling — and the one that produced a UX deviation from the mockup
  (inline cluster instead of the specified dropdown) that is still unresolved.
- **Two ACs were unimplementable as written** (AC-16 mandated a transport `useRunEvents` cannot
  provide; AC-19 forbade passing a handler `FindingCard` requires) and a third had a copy conflict
  (AC-14). All three were caught by the *planner* reading the spec against the code — but only
  because the spec was written before anyone checked those two APIs. The spec-authoring pass should
  have grepped them.
- **Agent difficulty and misses were only partially instrumented.** Mechanism 2 (downstream review
  verdicts as ground truth for "missed") was active and produced a clean per-agent attribution:
  T4 owned the CRITICAL boundary violation, T3 owned the AC-13 invalidation gap. Mechanism 1
  (self-reported `## Retro` sections in spawn prompts) was **not** used — so what each agent had to
  guess, and its confidence per deliverable, is unknown.

## Change next run

1. **Compute retro waves over `spawn_depth == 1` only.** The overlap heuristic reports a 6.11×
   straggler that does not exist, because it groups a parent with its own children. Fix the skill's
   derivation step, not the interpretation.
2. **Hand each implementer an AC extract, not the whole spec.** Inline the 3–4 acceptance criteria
   that task discharges into the spawn prompt and reference the spec only for context. Expected
   saving: most of 11 full-document reads. Keep the full spec for the two whole-diff reviewers.
3. **Add the self-report clause to every implementer spawn prompt** — *"close with a `## Retro`:
   what you had to guess, what you looked for and could not find, what you would have wanted handed
   to you, confidence per deliverable."* A few hundred tokens each buys the one dimension this
   retro could not measure. This run's four implementers volunteered rich insights unprompted, so
   the marginal cost is near zero — it just needs to be *asked for* consistently.
4. **Grep the API before writing an AC that names a mechanism.** Three ACs asserted behaviour the
   codebase could not provide (SSE payload shape, per-button handler props, a scaffolded i18n
   string). A spec-time check of the two hooks involved would have caught all three before the plan
   existed, instead of costing a mid-run spec revision.
5. **Name the shared-component home in the plan, not just file ownership.** Two implementers hit
   the same "one component, two consumers" problem and solved it opposite ways; the "Files owned"
   column prevents collisions but is silent on *placement*, so parallel agents each invent an
   answer. One line in the plan ("shared client components go to `features/<domain>/components/`")
   would have prevented the run's only CRITICAL.
6. **Keep fixing small review findings inline.** Two findings, ~15 lines of change total, fixed by
   the orchestrator in one pass with a mutation-verified regression test. A fix wave would have cost
   two more agent spawns and their cache-read for strictly less context.
