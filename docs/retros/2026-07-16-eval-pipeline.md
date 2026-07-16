# Workflow retro — Eval Pipeline (L06)

Session `e97d6e12` · spec-creator → implementation-planner → cross-model plan
review (Gemini) → `/impl` 20-task fleet → review wave → bounded fix loop.
All numbers from `jq` aggregation over the session's subagent transcripts
(the skill's `collect.sh` died on a `pipefail`/`fromdateiso8601` bug; numbers
were gathered by hand with the same read-only method).

## Shape

27 agents total — **19 at spawn-depth 1** (my direct spawns) + **8 at depth 2**
(researchers spawned *by* spec-creator and the planner). Wave structure:

- **Spec** — spec-creator ∥ 3 researchers → **Plan** — implementation-planner ∥ 5 researchers
- **W1** T1, T2 ∥ (2) → **W2** T4+T6, T5, T7, T8, T9 ∥ (5) → **W3** T10, T18, B-C1, B-C2 ∥ (4)
- *(large overnight human gap 22:33 → 05:43)*
- **W4** T11 (solo) → **W5** T17 (solo) → **W6** T19, T20 ∥ (2) → **Review** plan-verifier ∥ architecture-reviewer (2)

Active fleet wall-clock (excluding the human gap): **≈ 4 h 10 m** — spec+plan
≈ 91 m, impl W1–W3 ≈ 103 m, resume W4–review ≈ 56 m.

## Cost

- **Main thread:** output **846.9k**, cache-read **340.2M**, 772 assistant msgs.
- **27 agents:** output **1,060.3k**, cache-read **297.7M**, 1,376 tool-calls, **13 tool-errors (0.9 %)**.
- **Combined output ≈ 1.9 M; combined cache-read ≈ 638 M** — cache-read is **~335×** the output. On a session this long, re-reading the growing context each turn *is* the cost; token spend on actual work is a rounding error next to it.
- Three most expensive agents by cache-read: **T19 test-writer** (out 79.8k / cache **53.1M** / 1,436 s), **B-C1 implementer** (out 99.1k / cache 41.1M / 3,466 s), **B-C2 implementer** (out 84.1k / cache 31.0M / 3,409 s). Highest *output*: **implementation-planner 150.9k** (wrote the 606-line plan **twice** — v1, then v2 after the cross-model review found 4 defects).

## What worked (with the number)

1. **Landmine hoisting held: only 1 of 27 agents read any `INSIGHTS.md`** (spec-creator, 2 reads — a whole-feature author, allowed to read broadly). Every implementer/reviewer got its 3–5 relevant landmines quoted with `file:line` in the spawn prompt instead. The `project-context` retro six days earlier measured **14** agents re-reading one 26k-token `INSIGHTS.md`; this run cut that to **1**. That is the single biggest measured cache-read saving of the session. **Caveat (see cost #5): the duplication did not vanish, it moved** — the plan became the new most-re-read file.
2. **Error rate 0.9 %** (13 / 1,376 tool-calls), no cluster — max 2 errors on any agent. No systemic missing-precondition in the spawn prompts.
3. **Zero file-ownership collisions across 20 tasks on a shared tree** — the disjoint "Files owned" discipline held again; no two agents fought over a file.
4. **The cross-model plan review paid its cost back before a single implementer ran.** One Gemini call on the finished plan surfaced 4 real defects (the planner then found 2 more re-deriving edges from imports) — all in the plan, none in code. Cheapest possible place to catch them.

## What it cost us

1. **Cache-read dwarfs everything (638 M).** The two client batches (B-C1, B-C2) ran ~57 min each and carried 41 M / 31 M cache-read — a long-lived agent's cost is dominated by re-reading its own accumulating context, not by output. Splitting the client work into **two ~1-hour batches** was the largest avoidable cache cost; three or four shorter client agents would each have carried less context.
2. **B-C2 died to a watchdog stall** (84.1k output, 3,409 s) having written its components but not its tests — rescued inline in ~5 min. A ~1-hour agent is a big blast radius for a silent stall; it left two previously-green tests red.
3. **W3 straggler ratio ≈ 3.8** — B-C1/B-C2 (~3.4k s) vs T10/T18 (~0.9k s) in the same wave. It cost nothing *this* run because W4 depended on T10 (done early), not on the client batches — but a wave that mixes a 1-hour task with 15-minute tasks is a barrier waiting to bite the moment a downstream task needs the slow one.
4. **`collect.sh` was broken** — `set -o pipefail` + `ls -t …*.jsonl | head -1` throws SIGPIPE (exit 141) whenever the project has more transcripts than `head` reads, which is always (441 here). The retro's own tool died before emitting anything; every number above was gathered by hand with the same read-only `jq` method. **Fixed this run** with `|| true` on the two `| head`-terminated command substitutions (line 17 and the `duplicated_reads` block); the script now runs clean and its output matches the hand numbers exactly. *(The `fromdateiso8601` millisecond issue I first suspected was in my ad-hoc command, not the script — the script never computes durations.)*

5. **The landmine-hoist win moved the duplication, it did not remove it.** With `INSIGHTS.md` reads down to 1, the new most-re-read files are the **plan (14 agents) and the spec (11)**, then the shared contracts (`knowledge.ts` 9, `findings.ts`/`eval-ci.ts` 8). Every implementer was told to "read §X of the plan" and so read the whole 606-line file to reach its slice. Legitimate for a *contract* the fleet must share — but 14 full reads of one plan is now the top duplicated-context cost, and the fix is the same move that worked for INSIGHTS: paste the relevant plan **section** into the spawn prompt instead of citing it.

## Change next run

1. **Cap a single agent at ~30 min of expected work.** Split the client UI (which became two ~1-hour batches) into 3–4 route-scoped agents (dashboard / case-editor / compare / tab+card). Smaller agents carry less cache-read and a stall loses minutes, not an hour.
2. **Put a review gate on the client wave, not only the server wave.** Both this run and the `onboarding` retro shipped a client-only bug the *user* caught (here: an orphaned compare page reachable from nowhere, plus overflow/axis chart bugs). `plan-verifier` marked AC-24 MET on code existence without checking reachability. Add a spawn-prompt line to whichever agent owns a new route: *"a page with no link into it does not satisfy its AC — wire and test the entry point."*
3. **Never mix a >45-min task and <20-min tasks in one wave** unless nothing downstream depends on the slow one. If they must coexist, model it as a pipeline so the fast agents' successors start immediately.
4. **`collect.sh` is fixed** (this run) — the next retro's data step will run. If it regresses, the cause is a `| head`-terminated pipeline under `pipefail`; guard it with `|| true`.
6. **Hoist the plan *section*, not the plan *citation*.** "Read §7.1 of the plan" cost 14 full-file reads of a 606-line plan. Paste the task's own §7.x block into the spawn prompt (as was already done for the landmines) so no implementer needs to open the plan at all.
5. **Keep the landmine-hoist discipline verbatim** — it is the proven win (14 → 1 INSIGHTS reads). Do not relax it as fleets grow.
