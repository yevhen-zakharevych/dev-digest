---
name: workflow-retro
description: "Post-mortem for a multi-agent run. Reconstructs what the fleet actually did — agent count, launch order, concurrency, tokens per agent, duplicated context acquisition, tool-error hotspots — from the session transcript, and turns it into an orchestration retro with concrete next-run changes. Use after a workflow/fleet finishes (spec-creator, implementation-planner, /impl, or any parallel Agent fan-out). Trigger: /workflow-retro [session-id]."
---

# workflow-retro — did the fleet earn its tokens?

`engineering-insights` records what we learned **about the code**.
This skill records what we learned **about the orchestration**: how many agents ran,
in what order, how much they cost, what they duplicated, and what the shape of the
fan-out got wrong. Different lens, different artifact, no overlap.

## Hard rules

1. **Never `Read`, `cat`, `head`, or `tail` a transcript or `*.output` file.** They are
   multi-megabyte JSONL; reading one overflows the context and destroys the very session
   you are analysing. Every number comes from `scripts/collect.sh`, which aggregates with
   `jq` and emits one small JSON object.
2. **Report measured numbers as measured; label everything else as inference.** The
   transcript records what agents *did*, never what they *found hard*. Do not narrate a
   struggle the data cannot show (see *The honest boundary*).
3. **Do not re-run agents** to gather data. The retro is read-only and costs one Bash call.
4. Durable lessons about the *codebase* go to `engineering-insights`, not here. This skill
   emits orchestration lessons only, and may hand one line to `engineering-insights`.

## Procedure

### 1. Collect

```bash
.claude/skills/workflow-retro/scripts/collect.sh            # current session
.claude/skills/workflow-retro/scripts/collect.sh <session>  # a specific one
```

Returns `{session, span, main_thread, agents[], totals, duplicated_reads[]}`. Each agent
carries `agent_type`, `model`, `description`, `spawn_depth`, `started`/`ended`,
`output_tokens`, `cache_read`, `tool_calls`, `tool_errors`.

If `agents` is empty, the session ran solo — say so and stop. There is no fleet to retro.

### 2. Derive (compute, don't guess)

- **Launch order & waves.** Sort by `started`. Two agents whose `[started, ended]`
  intervals overlap ran concurrently. A wave = a maximal set of mutually overlapping
  agents. Report the wave structure, e.g. `2 ∥ → 1 → 4 ∥ → 1`.
- **Serial tail.** Sum of wall-clock where exactly one agent was live. This is the part
  parallelism did not buy anything on — the ceiling on how much faster the fleet could go.
- **Straggler ratio.** Within each wave: `slowest / median`. A ratio > 3 means a barrier
  made the fast agents idle, and the wave probably wanted a pipeline, not a `parallel()`.
- **Token distribution.** `output_tokens` per agent, and `cache_read` per agent. Cache-read
  usually dominates and is the real cost of a wide fan-out: every agent re-reads a
  system prompt and its share of the repo.
- **Duplicated context acquisition.** `duplicated_reads` = a file `Read` (or pattern
  `Grep`ed) by N distinct agents. N ≥ 3 on the same file means that content should have
  been passed *down* in the spawn prompt, not rediscovered N times.
- **Model routing.** Cross `agent_type` × `model` against the routing policy in
  `.claude/agents/README.md`. Flag any agent on a model above its tier.
- **Tool-error hotspots.** `tool_errors > 0` per agent. Cluster them: a repeated error
  across agents is a missing precondition in the spawn prompt, not N agent mistakes.

### 3. Judge

Answer these, each with a number attached:

- Did parallelism pay? Compare fleet wall-clock against the serial tail plus the
  straggler waste. If a wave's straggler ratio is high, the barrier was the wrong tool.
- Was any agent too small to justify its fixed cost? An agent whose `output_tokens` is
  under ~2k and whose `tool_calls` is under ~5 probably should have been an inline edit
  by the orchestrator (the cost-discipline rule in `INSIGHTS.md`).
- What did the fleet rediscover? Every `duplicated_reads` row with `agents ≥ 3` is a
  candidate for hoisting into the spawn prompt or a shared brief.
- Where did work land in the wrong place? An agent that read files far outside its
  declared file-ownership scope is a decomposition smell.

### 4. Write

Append a dated entry to `docs/retros/YYYY-MM-DD-<slug>.md` (get the date with
`date +%Y-%m-%d`; create `docs/retros/` if absent). Structure:

- **Shape** — one line: wave structure, agent count, wall-clock.
- **Cost** — main-thread vs agent tokens; output vs cache-read; the three most expensive agents.
- **What worked** — with the number that shows it.
- **What it cost us** — duplication, stragglers, oversized agents, error clusters.
- **Change next run** — a numbered list of concrete, *actionable* changes to the spawn
  prompts, the wave structure, or the model routing. Not "communicate better."

Then append one row to `docs/retros/ledger.md` (create it from the header in an
existing row if it doesn't exist yet): date, link to the retro file, session id,
agent count, fix-loop iterations, total output, total cache-read, one-line headline.
Copy numbers from the sections you just wrote — don't recompute. Leave a cell `—`
if this run didn't produce that number. Append-only: never edit or reorder past rows.

Then, if and only if a lesson generalises beyond this feature, invoke
`engineering-insights` with that one lesson. Do not paste the metrics into `INSIGHTS.md`.

## The honest boundary

The transcript is a record of **actions**, not of **experience**. These are measurable:

| Question | Measurable? | From |
|---|---|---|
| How many agents, of what type, on what model | yes | `meta.json` + `message.model` |
| Launch order, concurrency, wall-clock | yes | first/last `timestamp` per agent |
| Tokens per agent, cache-read per agent | yes | `message.usage` |
| Which context was acquired more than once | yes | `Read`/`Grep` inputs, deduped per agent |
| Which tools failed, for whom | yes | `tool_result.is_error` |
| Which agent found its task **hard** | **no** | — |
| What an agent **missed** | **no** | — |
| Whether two agents **disagreed** | **no** | — |

The bottom three are exactly what the retro most wants, and no amount of post-hoc parsing
recovers them: an agent's final report is a summary it chose to write, and its internal
reasoning is not addressable from the parent. There are only two ways to get them, and
both must be set up **before** the fleet runs, not after:

1. **Make the agents self-report.** Have each spawn prompt end with: *"Close your final
   message with a `## Retro` section: what you had to guess, what you looked for and could
   not find, what you would have wanted handed to you, and your confidence (high/medium/low)
   in each deliverable."* The orchestrator's context then carries these, and this skill can
   collect them. Cheap — a few hundred tokens per agent.
2. **Use downstream verdicts as ground truth for "missed."** In this repo the review wave
   (`architecture-reviewer`, `plan-verifier`, `/code-review`) already produces exactly that
   signal: every confirmed finding is something the implementer missed. Attribute each
   finding back to the agent that owned the file, and you get a per-agent defect count that
   no self-report could give you honestly.

State plainly in the retro which of the two mechanisms was active. If neither was, say
"agent difficulty and misses were not instrumented this run" rather than inferring them.

## Extensions worth adding (in the order they pay off)

1. **Fix-loop iterations as the headline quality metric.** `/impl` caps its fix loop at 2.
   How many iterations a run needed, and which findings drove them, says more about
   decomposition quality than any token count. Needs the review wave's output parsed.
2. **Cost in currency, not tokens.** `output_tokens` and `cache_read` per model × a price
   table gives a real number. Keep the table in one file; it goes stale, and a stale price
   is worse than none.
3. **Rework rate.** Files touched by more than one agent, or by the same agent after a
   review wave, from `git` history plus agent `Edit`/`Write` targets. High rework = the
   file-ownership decomposition leaked.
4. **Spawn-prompt size vs agent output.** A long prompt producing little output is a brief
   that over-specified. Both sides are in the transcript.
5. **Compare against the plan.** `docs/plans/*.md` declares waves and file ownership.
   Diffing declared-vs-actual catches an orchestrator that improvised away from its plan.

A cross-session trend line is already live: step 4 appends one row per run to
`docs/retros/ledger.md`, giving tokens-per-feature and agents-per-feature over time
without re-running `collect.sh` over old sessions.

Deliberately *not* recommended: scoring agents against each other. They get different
tasks with different difficulty, and a leaderboard would optimise the fleet for whatever
the score measures rather than for the feature landing correctly.
