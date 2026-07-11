# Trend ledger

One row per `workflow-retro` run, appended after the dated retro file is written.
Append-only — never edit or reorder past rows. Numbers are copied from the
retro's own **Shape**/**Cost** sections, not recomputed; if a retro didn't
report a column, leave the cell as `—`.

| Date | Retro file | Session | Agents | Fix-loop iters | Total output | Total cache-read | Headline |
|---|---|---|---|---|---|---|---|
| 2026-07-10 | [project-context](2026-07-10-project-context.md) | `3d791dc5…` | 20 (19 sonnet, 1 opus) | 1 (cap 2) | ~996.9k (main 568.8k + agents 428.1k) | 316.5M | Root `INSIGHTS.md` re-read by 14 agents — biggest single inefficiency this run |
| 2026-07-10 | [onboarding-generator](2026-07-10-onboarding-generator.md) | `c3ebab56` | 6 (all depth-1) | 0 | ~537.6k (main 317.6k + agents 220k) | ~120.6M (main 39.6M + agents 81.0M) | 0 fix-loop iterations, but redesign wave had no review gate and shipped a layout bug the user caught |

## How to read trend columns

- **Fix-loop iters** is the headline quality number (lower is better; landmine-hoisting into spawn prompts is what drove it to 0 in the second run).
- **Total cache-read** is the real cost of a fan-out, not output tokens — watch it per agent-count to see if wider fleets are getting cheaper or just busier.
- A run with no review/fix-loop gate at all (e.g. a solo redesign task) should still get a row — record `0` fix-loop iterations but flag the gate gap in the retro's own "what it cost us", as the onboarding-generator row does.
