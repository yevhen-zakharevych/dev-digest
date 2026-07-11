# Fleet retro — Project Context (L05)

Session `3d791dc5…`. Measured span 2026-07-10 12:31 → 16:05 (3h34m captured; the
session continued past the collector with the page redesign + "all-md" change,
which are NOT in these numbers). All figures from `fleet-retro/scripts/collect.sh`.

## Shape

`1 planner (opus, +4 researchers nested at depth-2) → [inline T1/T2/T3] → 9 ∥ build (rolling) → [inline code-review + security-review] → 2 ∥ review → 3 ∥ fix → [inline nav/tab fixes] → 1 redesign`

- **20 agents**: 1 `implementation-planner` (opus), 4 `researcher` (sonnet, spawned BY the planner at depth 2), 13 `implementer` (sonnet), 1 `plan-verifier`, 1 `architecture-reviewer`. 19 of 20 on sonnet.
- **Fix-loop iterations: 1** (cap is 2; exited after one round with all gate findings closed). This is the headline quality number — decomposition was good enough that one fix wave cleared every CRITICAL/PARTIAL.
- **5 tool errors across 1004 agent tool-calls** (0.5%), no cluster — nothing to chase.

## Cost

- **Main-thread output 568.8k tokens > all 20 agents combined (428.1k).** The orchestrator was the single largest token producer this feature. Partly correct (cost discipline: T1 contract-mirror, T2 migration, T3 adapter, and later the nav-entry, the `VALID_TABS` tab bug, and the whole "all-md" change were done inline). Partly overhead: **406 main-thread assistant messages**, many of them a status-narration turn fired by each of ~20 task-notifications.
- **Cache-read dominates: 316.5M total (193.5M agents + 123.0M main) ≈ 316× the ~1.0M total output.** This is the real cost of a 20-agent fan-out — every agent re-reads the system prompt + its repo slice.
- Three most expensive implementers by output: **T10 page 53.4k**, **T11 agent-tab 52.4k**, **T7 discovery 40.2k** (redesign 42.0k close behind). By cache-read: **Fix-S1 27.7M**, **T7 24.9M**, **T6 24.9M**, **plan-verifier 20.4M**.

## What worked

- **Build wave paid: ~4.2× speedup.** 9 implementers ran 12:58–13:16 (~18 min wall) for ~76 agent-minutes of work. Disjoint file-ownership held — zero collisions on the shared tree.
- **Contract-mirror + fixture-fallout kept inline, off the critical path of the fan-out.** The one dual-vendored two-file edit and the 5-producer + 3-fixture `tsc` fallout were the orchestrator's, so no implementer raced on `vendor/shared`. Zero vendored-drift findings in the review wave.
- **One fix iteration cleared the gate.** code-review (8) + architecture (2 WARNING) + security (1 CRITICAL) + plan-verifier (1 PARTIAL) all closed in a single 3-agent fix wave.

## What it cost us

- **Session-protocol reads were rediscovered N times, not passed down.** Root `INSIGHTS.md` was `Read` by **14** distinct agents, the spec by **12**, `client/INSIGHTS.md` by 8, `server/INSIGHTS.md` by 7, `client/CLAUDE.md` by 7. Root INSIGHTS alone is ~26k tokens → ≈360k tokens of cache-read for that one file across the fleet. I *did* paste the specific relevant landmines into each spawn prompt, but the mandated "read module INSIGHTS first" made every agent re-read the whole file anyway. This is the biggest single inefficiency.
- **Fix-wave straggler ratio 3.9** (S1 22.8m vs S2 3.9m / C1 5.9m; median 5.9m). No idle waste (they were independent, not barriered), but the wave was unbalanced: S1 bundled 6 fixes + a symlink-adapter change + tests while S2/C1 were single-fix agents. A defect hotspot masquerading as one task.
- **Defect attribution (from downstream review verdicts — the honest "what was missed" signal):**
  - **T7 discovery was the defect hotspot** — ~5 of the 8 code-review findings traced to it (byte-vs-char token estimate, `used_by_agents` cross-repo scope, `assignBucket` enum cast, missing read-route rate-limit, duplicated `RepoParam`). Proportionate to its size (biggest task, 96 tool-calls) but concentrated.
  - **The orchestrator's own inline work was NOT immune**: the symlink-realpath bug and the case-sensitive `.md` bug were in `simple-git.ts`, which I wrote inline as "T3". Inline ≠ higher quality.
  - **Two bugs came from file-ownership GAPS, not agent error**: the agent Context tab not opening (`VALID_TABS` in `page.tsx` — a file no task owned; T11 owned the editor's tab switch but not the page's allowlist) and the missing sidebar nav entry (`nav.ts` — owned by nobody). Both were features that spanned a file outside every task's declared scope.
- **Model intent ≠ model actually spawned.** I narrated T6/T7 and Fix-S1 as running "on Opus", but passed no `model` override, so they inherited `implementer.md`'s sonnet and ran sonnet. Sonnet handled them (all green), but the claim was false. No agent ran ABOVE its tier; two ran below what I said.

## Change next run

1. **Hoist the landmine digest into the spawn prompt; tell agents NOT to re-read whole INSIGHTS files.** Extract the 3-5 relevant landmines (I already select these) into the prompt, and change the session-protocol line from "read root + module INSIGHTS" to "the relevant landmines are inlined below; skim module INSIGHTS ONLY if your task touches an area not covered here." Saves ~14×26k on root INSIGHTS alone.
2. **Map every feature file to an owner BEFORE the wave — including pre-existing glue files.** The tab-open and nav bugs were both in files (`page.tsx` `VALID_TABS`, `nav.ts`) that no task card claimed because the plan only listed NEW files. Add a "wiring/registry files this feature touches" line to each UI task, or own them inline deliberately.
3. **Split a fix-wave hotspot into peers instead of one bundle.** S1 carried 6 fixes; had its security allowlist fix been its own agent and the discovery-correctness fixes another, the wave's straggler ratio drops from 3.9 toward 2 and the security change gets a cleaner, smaller diff.
4. **When you intend a model tier, pass `model:` explicitly and verify — don't rely on narration.** If T6/T7/S1 genuinely warranted Opus, they didn't get it. Decide per-task and set the param.
5. **Batch status-narration.** ~20 task-notifications each got a turn. Acknowledge silently and narrate only on a wave boundary or a load-bearing finding — the 406 main-thread messages are mostly these.
6. **Add a `## Retro` self-report to every spawn prompt** (what you guessed / couldn't find / wanted handed to you / confidence). This run had the review-wave "missed" signal but NO agent difficulty signal — the self-report is the only cheap way to get it.
