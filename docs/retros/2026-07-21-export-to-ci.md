# Orchestration retro — Export to CI (2026-07-21)

Session `200195b7-3d21-4793-b3c9-543f345d1cb4`. Full chain in one session:
`spec-creator` → `implementation-planner` → cross-model plan review → 4 implementers →
3-lens review wave → inline fix pass.

## Shape

**14 agents, 4 waves, ~7h55m of session span but only ~54 min of agent-active wall clock.**

```
spec-creator (opus, solo)                                    469s
  ↓ [user Q&A, decisions]
implementation-planner (opus)                               1025s
   └── 5 × researcher (sonnet, depth 2, nested)          92–145s ∥
  ↓ [cross-model plan review — GPT-5.1 via OpenRouter, not an agent]
A1 ∥ A3 ∥ A4 → A2 (staggered, not barriered)             424–1054s
  ↓
plan-verifier ∥ architecture-reviewer ∥ security review    195–441s ∥
```

Only 4 of the 5 permitted implementation agents were spent; the reserved fix-loop slot was
never used because the review findings were closed inline by the orchestrator.

**Straggler ratios (slowest / median within a wave):** implementers **1.39**, reviewers
**1.32**, researchers **1.51**. All healthy — no wave wasted meaningful time waiting on a
straggler. The implementer wave avoided a barrier entirely: A2 was launched the moment A1
(its only real dependency) finished, while A3/A4 were still running. Had A2 waited for a
`parallel()` barrier across A1/A3/A4, it would have started 11 min later for no reason —
A4, the longest client task, was on a disjoint tree.

**Serial tail ≈ 1895s (~32 min)** — the portion where exactly one agent was live, i.e. the
ceiling on what more parallelism could ever have bought. It is dominated by two
single-agent phases that are inherently serial: `spec-creator` (469s) and
`implementation-planner` after its researchers returned (847s solo).

## Cost

| | Output tokens | Cache read |
|---|---|---|
| Main thread | 332,854 | 127.5M |
| 14 agents | 393,849 | 85.4M |
| **Total** | **726,703** | **212.9M** |

Main-thread tool calls: Bash 119, Edit 57, Read 22, Agent 9, Write 8, SendMessage 2.
381 assistant messages. **1 tool error across all 14 agents.**

**Three most expensive agents (output):** planner 72.1k, A4 68.9k, A2 62.1k.
**Three most expensive (cache read):** A4 18.1M, plan-verifier 14.7M, A2 13.9M.

Model routing: 4 opus (`spec-creator`, planner, A2, security review), 10 sonnet. Matches
the declared policy — opus only where a bad output compounds downstream. No agent ran above
its tier.

**The orchestrator was 46% of all output tokens.** That is not drift; it is the
cost-discipline rule working as designed — I1–I5 (dual-vendored contract, migration, GitHub
port + mocks + octokit, i18n catalogue, shared pill) and the entire post-review fix pass
were done inline rather than spawned. Six inline items plus ~8 fix edits at 57 `Edit` calls.

## What worked

**Three review lenses caught three non-overlapping defect classes — the fourth consecutive
run where this holds.** Architecture found a duplicated status-mapping rule and a helper
reaching into a sibling's private folder; plan-verifier confirmed 50/50 ACs and
independently flagged the same dead request body architecture had noted; the security lane
found two HIGH issues neither of the other two could see. **A single reviewer would have
shipped a memory-exhaustion vector.**

**The cross-model plan review paid for itself again** — 5 findings, of which the CRITICAL
was directionally right even though its stated mechanism was wrong (it claimed a *parallel*
edit collision on `mocks.ts`; the two writers were actually sequential). The underlying
observation — that one file had two owners across time — was real, and fixing it by scope
rather than by sequencing then exposed a second instance (`octokit.ts`) that no reviewer
had flagged.

**Empirical verification beat reading, twice, on the two highest-severity issues.**
Building and *running* the runner bundle exposed that AC-6 shipped a workflow that dies on
line 1 in any ordinary target repo — invisible to three text-reading agents. Reproducing the
zip bomb (181 bytes → 1.4 GB RSS, 4 s blocked) confirmed the security finding rather than
taking it on faith. Neither is discoverable by static review.

**Mid-flight correction to a running agent worked.** A1 received the AC-6 fix via
`SendMessage` while still writing `bundle.ts`, applied it, and — notably — *independently
verified the claim before trusting it*. Cost: one message. Re-spawning would have cost ~33k
output.

## What it cost us

**The planner re-derived terrain I had already mapped and handed it.** Its 5 nested
researchers cost **41.6k output + 6.0M cache (~10% of all agent output)** to map the
server module, client surfaces, contracts/schema/port, the agent-runner contract, and
testing lanes — all of which my own pre-planning recon had already established and quoted
into the planner's spawn prompt (agent-runner is complete; contracts already written;
tables migrated; `commitFiles`/`findOpenPr` implemented; i18n present; only `NAV` missing).
This is the single clearest inefficiency of the run.

**25 files were read by 3+ agents**, topped by 5-agent reads of `bundle.ts`,
`docs/plans/export-to-ci.md`, `nav.ts` and `ci.json`. Honest caveat: the three reviewers
*must* read broadly, so a file read by 5 is often 3 legitimate reviewer reads plus 2
implementers. The collector cannot separate the two, so this number overstates the waste.
The defensible subset is the small, quotable files — `nav.ts` and `ci.json` are both short
enough to have been pasted into the two client spawn prompts.

**The plan shipped an ordering defect that no review caught.** I3 declared two methods on
`GitHubClient` while assigning the implementation to A2 in a *later* wave — leaving the
whole server tree failing `tsc` for the entire first wave, contradicting I3's own
"whole tree still typechecks" criterion. Found only when I executed I3 by hand. Neither the
planner, nor GPT-5.1, nor the reviewers saw it, because all of them were reading a plan
rather than running it.

**One optimisation was written and reverted.** Skipping already-terminal runs on refresh
broke AC-34's stated observable. Reverted rather than resolved by amending the AC — correct
call, but ~15 min of work that a closer read of the AC before coding would have avoided.

## Instrumentation honesty

Mechanism 2 (downstream verdicts as ground truth for "what was missed") **was** active and
is the basis for the per-agent attribution below. Mechanism 1 (self-report) was **partially**
active — the `implementer` prompt asks for deviations-with-mechanism, and all four complied,
which is how A4's duplicate-text wart and A2's missing mock hook surfaced without a reviewer
finding them. Agent *difficulty* was not instrumented and is not inferred here.

Findings attributed back to the agent that owned the file:

| Agent | Confirmed misses | Notable |
|---|---|---|
| A1 | 0 | — |
| A2 | 4 | zip decompression bound, workflow-override content validation, unbounded `agent`, artifact `pr_number` precedence — all from the security lane |
| A3 | 2 | repo derived by URL parsing; unsafe status cast |
| A4 | 2 | dead update-config body; duplicated "no runs yet" (self-reported) |

A2's count is not a quality signal against it: it owned the only surface that touches
third-party bytes, and every one of its four came from the lane specifically built to
look there.

## Change next run

1. **Tell `implementation-planner` explicitly what recon is already done, and forbid
   re-deriving it.** Its prompt already carried a "what already exists" section; it spawned
   5 researchers anyway. Add a hard line: *"The terrain section below is verified. Do not
   spawn researchers to re-establish it; spawn one only for a question it does not answer,
   and name that question."* Expected saving: ~40k output, ~6M cache.
2. **Add a plan self-check: "does every wave typecheck at its own boundary?"** The I3/A2
   split failed this and nothing caught it. A one-line check in the planner's output —
   *for each wave, does the tree compile with only that wave's work applied?* — would have.
3. **Quote small shared files into spawn prompts instead of letting agents read them.**
   `nav.ts` (60 lines) and `ci.json` were each read by 5 agents. For files under ~100 lines
   that every agent in a wave needs, paste them.
4. **Run the artifact before reviewing the plan for it.** Both highest-severity findings of
   this run came from execution, not reading. Where a feature produces a runnable artifact
   (a bundle, a generated config), build and run it *before* the review wave, and hand the
   result to the reviewers.
5. **Keep launching a dependent agent the moment its dependency clears** rather than at a
   wave barrier. A2 started 11 min earlier this way at zero risk, since its file set was
   disjoint from the still-running client agents.
6. **Read the AC before optimising against it.** The reverted refresh optimisation was
   discoverable as a conflict by reading AC-34's observable first.
