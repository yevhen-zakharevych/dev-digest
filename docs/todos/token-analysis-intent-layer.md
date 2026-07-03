# Token Analysis — Intent Layer (L03) build

> Retrospective on the agent-fleet build of the Intent Layer feature.
> Numbers are **subagent context tokens** as reported per agent — an approximation of
> LLM throughput, NOT billed tokens or cost (prompt caching makes actual paid tokens
> lower). Date: 2026-07-03.

## Per-agent usage

| Phase | Agent | Tokens |
|---|---|---:|
| Research | researcher — reviewer-core | 39,792 |
| Research | researcher — client | 55,793 |
| Research | researcher — server | 113,054 |
| Planning | planner | 49,788 |
| Wave 0 | A — reviewer-core intent slot | 79,263 |
| Wave 0 | B — feature-model default flip | 53,482 |
| Wave 0 | C1 — pure input helpers | 68,846 |
| Wave 0 | D1 — client intent hooks | 57,704 |
| Wave 1 | C2 — service + routes + executor | 153,423 |
| Wave 1 | D2 — Intent card + UI + i18n | 83,896 |
| Review | architecture-reviewer | 71,290 |
| Review | plan-verifier | 55,041 |
| Fixes | fix implementer (Req4 + port + wiring) | 148,570 |
| | **Total (subagents)** | **≈ 1,029,942** |

Plus the orchestration thread (coordination, reading reports, plan doc) — not separately
metered here; its working window was ≈ 120k.

## By phase

| Phase | Tokens | Share |
|---|---:|---:|
| Research + planning | ~258k | 25% |
| Implementation (Wave 0 + 1) | ~496k | 48% |
| Review + fixes | ~275k | 27% |

Heaviest agents: **C2 (153k)** and **fix (148k)** — both read a lot of existing code
(adapters, container, github/git) and made cross-module edits.

## Where tokens were wasted

1. **Repeated onboarding × 13 agents.** Every subagent restarts cold and re-reads
   `CLAUDE.md` + its module `INSIGHTS.md`/`AGENTS.md` + the plan doc. ~5–8k fixed overhead
   × 13 ≈ **70–100k spent purely re-ingesting the same context**.
2. **`researcher → implementer` double-read.** A researcher reads a file and reports
   `file:line`; the implementer then re-opens the same file in full to edit it. Part of the
   research reading was paid for twice.
3. **Three researchers with overlap.** The server researcher alone was 113k; all three
   independently re-read shared contracts (`platform.ts`, `brief.ts`) and re-discovered the
   pre-scaffolding.
4. **A whole extra fix wave (148k).** The Req-4 inline-plan-truncation fix was **already in
   the plan (§7)** but under-specified in the C2 task prompt — a tighter acceptance
   criterion would have folded it in and avoided part of this round.
5. **Trivial tasks as standalone agents.** Task B (change 3 constants) cost 53k — almost
   all onboarding, not work.

## Recommendations (ranked by impact)

### ① Right-size the model per task — biggest lever (cost, not token count)
Research, mechanical edits (B), pure helpers (C1), client hooks (D1) — ~440k of tokens that
can run on **Sonnet/Haiku**. Reserve Opus for hard integration (C2) and the reviews. Token
count stays similar, but **cost drops ~5–10×** on those tasks.

### ② Fewer, coarser task slices — cuts repeated onboarding (token count)
Merge the small disjoint Wave-0 tasks (B + C1 + D1) into one agent — pay onboarding once,
not four times. Est. **−60–80k**.

### ③ Give each agent only its task card, not the whole plan
Instead of 6 implementers each ingesting the full plan doc, pass each only its section +
the relevant `file:line` refs. Less repeated ingestion.

### ④ Tighter acceptance criteria up front → fewer correction rounds
Had the C2 prompt included the explicit token-budget algorithm (plan/body untouched, only
hunk-headers trimmed), the Req-4 fix round would have been unnecessary. Saves part of 148k.

### ⑤ Narrower researcher briefs
"Read only these dirs, skip `clones/`, want signatures not whole files" — less exploration.

## What NOT to cut

- **The research phase itself.** It cost 258k but **prevented rebuilding** the already-
  existing table / contracts / repo functions — building from scratch then deleting the
  duplicates would have cost far more.
- **Two separate reviewers.** `architecture-reviewer` and `plan-verifier` caught
  **non-overlapping** defect classes (boundaries vs requirement coverage). Merging saves
  ~55k but costs quality.

## Target

Realistic without quality loss: **~1.03M → ~0.75–0.85M tokens** (via ②③⑤ + avoiding the fix
round), **plus ~5× lower cost** from ① (model right-sizing). The biggest win is not fewer
tokens — it's **running the expensive model only where it's actually needed**.
