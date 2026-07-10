# Fleet retro — Onboarding Generator (L05) + UI redesign

Session `c3ebab56` · 2026-07-10 · span ~64 min · 6 agents (all spawn_depth 1)

## Shape

`P0 (solo agent ∥ inline S1) → S2 ∥ C1 → plan-verifier ∥ arch-reviewer → redesign (solo)`

- **Wave 0** — P0 prompt reconciliation (sonnet, 39s), run in parallel with the orchestrator's **inline** S1 (dual-vendored contract + DB schema + migration 0014 + fixture check). S1 was not an agent, so P0 shows as a solo agent.
- **Wave 1** — S2 server module (opus, 16.5 min) ∥ C1 client tour (sonnet, 19.3 min). Overlap 15.7 min; C1 tail-alone 3.6 min. Wall 20.1 min vs 35.8 min serial → **parallelism saved 15.7 min**.
- **Wave 2 (review)** — plan-verifier (sonnet, 4.2 min) ∥ architecture-reviewer (opus, 2.85 min); `/code-review` + `/security-review` ran **inline** on the main thread. Wall 4.2 min vs 7.05 min serial → saved 2.85 min.
- **Wave 3** — onboarding UI redesign (sonnet, 7.5 min), solo, triggered by the user after the /impl run closed.

## Cost

- **Main thread**: output **317.6k**, cache-read 39.6M, cache-create 1.1M, input 67k, across 176 assistant msgs. Main-thread output is the single largest generation bucket — long S2/C1 spawn cards + the inline `/code-review` and `/security-review` analysis + the /impl report + insights writes.
- **Agents**: output **220k** total, cache-read **81.0M** total, 388 tool calls, 2 tool errors.
- **Cache-read dominates**: ~120M read (main + agents) vs ~538k total output — a ~220:1 ratio. This is the real cost of the fan-out; every agent re-primes a system prompt + its share of the repo.
- **Top-3 agents by cache-read**: C1 40.6M · S2 21.5M · plan-verifier 9.8M.
- **Top-3 agents by output**: C1 90.9k · S2 68.4k · redesign 31.6k. C1 was the heaviest on every axis (167 tool calls — many client Read/Edit/test cycles).

## What worked (with the number)

- **0 fix-loop iterations.** The review wave came back clean enough to skip the fix loop entirely: plan-verifier 23/23 AC MET (0 MISSING/PARTIAL), arch-reviewer 2 SUGGESTIONs (both intentional parity with `conventions`), `/code-review` 1 Medium + 3 SUGGESTION, `/security-review` clean. First-try AC compliance is the strongest decomposition-quality signal available, and it's directly attributable to hoisting the plan §13 amendments + the 3–5 relevant INSIGHTS landmines into each spawn card.
- **Balanced package split.** Wave-1 straggler ratio **1.17** (S2 16.5 min vs C1 19.3 min) — the all-server ∥ all-client cut kept both agents busy the whole wave, no barrier idle. Same for the review wave (1.47).
- **Model routing 5/6 on-tier.** S2 opus (cross-module floor: new module + repo-intel facade + DI/job wiring), C1/redesign sonnet (single-surface), plan-verifier sonnet + arch-reviewer opus (per catalog). Correct.

## What it cost us

- **The redesign shipped a layout bug the fleet could not catch.** The redesign agent produced a `position: sticky` rail that did not stick (`align-items: start` collapsed the grid rail cell to the nav's own height, leaving zero scroll range). Unit tests don't assert layout, and — unlike the /impl waves — **the redesign task had neither a review wave nor a self-report gate**. Its only gate was `pnpm test` green, so the bug shipped and the **user became the review wave**. Orchestrator fixed it inline in one line after the user flagged it. This is the run's clearest miss, attributable to (a) the redesign agent, and (b) the spawn card, which specified `position: sticky; top: 16` but not the `align-items: stretch` precondition, and did not require any visual verification.
- **P0 was borderline too small to be an agent.** 1704 output tokens, 6 tool calls — under the ~2k/~5-call inline threshold. Justified *only* because it ran parallel to the orchestrator's inline S1; a lone 8-line markdown reconciliation would otherwise have been an inline edit. It also sat on sonnet where the work (1 file, no logic, guided by the `security` skill) was Haiku-eligible.
- **Main-thread output 317.6k** is high for an orchestrator. Much is unavoidable (the S2/C1 cards were long by design — landmine hoisting is what bought the 0 fix-loops), but the inline `/code-review` + `/security-review` reproduced analysis that partly overlapped the arch-reviewer's scope.
- **Duplicated reads were cross-phase, not intra-wave.** The N≥3 files (`SectionRenderer.tsx`, `OnboardingHeader.tsx`, `onboarding.json`, the spec) were re-read by build → verify → redesign — three legitimately-different phases, not a fan-out rediscovering shared context. No hoisting win there. The only mild intra-repo waste: `vendor/ui` primitives (`CopyButton`/`IconBtn`/`MonoLink`/`PromptBlock`) read by both C1 and the redesign agent (2 each) — a one-line "reuse these primitives, here's their API" note in the redesign card would have saved a few reads.

## Change next run

1. **Gate pure-visual/layout tasks with something that sees pixels.** Unit tests are blind to layout; a redesign delegated "blind" and gated only by `pnpm test` will ship CSS bugs. Either (a) require the agent to run the app + screenshot (via `run`/`verify`) before declaring done, or (b) have the orchestrator do a visual pass, or (c) at minimum add a CSS-mechanism checklist to the card (for sticky-in-grid: *"the grid must use `align-items: stretch` so the sticky rail cell has scroll range; the scroll container is AppFrame's `<main overflow:auto>`"*).
2. **Add a `## Retro` self-report to spawn cards.** End each card with *"close with what you had to guess, what you looked for and couldn't find, and your confidence per deliverable."* This run instrumented "misses" only via the review wave (which the redesign skipped), so the redesign's miss surfaced only from the user. A few hundred tokens/agent would have surfaced the redesign agent's own uncertainty about the untested sticky layout.
3. **Do P0-sized work inline unless it parallelizes a bigger inline block.** A single sub-2k/sub-5-call edit is an inline edit by default; only spawn it when (as here) it genuinely overlaps other inline orchestrator work. When spawned, route it to Haiku, not Sonnet.
4. **Hand the redesign card the `vendor/ui` primitive APIs it will reuse.** C1 already discovered `CopyButton`/`IconBtn`/`MonoLink`/`PromptBlock`'s shapes; quoting them (or their file paths + one-line API) in the redesign card avoids the re-reads.

## Instrumentation honesty

Agent *difficulty* and *disagreement* were not instrumented (no `## Retro` self-report). *Misses* were instrumented for the /impl waves via the downstream review verdicts (mechanism #2): plan-verifier + arch-reviewer + `/code-review` + `/security-review` → S2 carried 1 Medium (AC-1 "exactly five" robustness gap, owned by `normalize.ts`), C1 carried 0 confirmed defects. The **redesign wave had no miss-instrumentation at all** — its one real defect (the sticky bug) was caught by the user, not by any gate, which is precisely change #1 above.
