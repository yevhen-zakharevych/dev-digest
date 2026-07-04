# Agents

Custom Claude Code sub-agents for DevDigest. Each agent is a single `<name>.md`
file: YAML frontmatter (routing + config) followed by a Markdown system prompt.
Shared with the team via version control.

## Catalog

| Agent | Model | Access | Purpose |
|-------|-------|--------|---------|
| [planner](planner.md) | Opus | read-only (`permissionMode: plan`) | Produces a structured **Development Plan** before any code is written; decomposes work into parallelizable tasks and names the skills each task must apply. |
| [implementer](implementer.md) | Sonnet | write (`Read/Edit/Write/Bash/Grep/Glob/Skill`) | Implements **one scoped task** from a plan (UI or backend), applies the module skills, keeps existing tests green, self-reviews only the code it wrote. |
| [researcher](researcher.md) | Sonnet | read-only | Finds information in the codebase or on the web and returns a structured, scannable report. |
| [test-writer](test-writer.md) | Sonnet | write (`Read/Edit/Write/Bash/Grep/Glob/Skill`) | Writes automated tests for UI (Vitest + RTL) or backend (Vitest unit + `*.it.test.ts` testcontainers). Applies the testing skills; runs the suite to green then mutation-checks; never weakens an assertion to pass. |
| [architecture-reviewer](architecture-reviewer.md) | Opus | read-only (`permissionMode: plan`) | Reviews a diff for **architectural** quality (layering, dependency direction, module boundaries, misplaced business logic) — not line bugs or style. Returns a findings report; empty is a valid result. |
| [plan-verifier](plan-verifier.md) | Sonnet | read-only (`permissionMode: plan`) | Given a plan **and** the code written, verifies every requirement is actually implemented — one row per requirement, `file:line` evidence for each MET, four statuses (MET/PARTIAL/MISSING/CANNOT VERIFY). Coverage, not code quality. |
| [doc-writer](doc-writer.md) | Sonnet | write (`Read/Edit/Write/Bash/Grep/Glob/Skill`) | Documents shipped functionality, turns plans into docs, converts material into docs with Mermaid diagrams. Classifies by Diátaxis, knows where docs live in the repo, grounds every claim in `file:line`. |

## How the two planning agents work together

`planner` runs first and read-only: it explores, reads the relevant
`INSIGHTS.md` / `AGENTS.md`, and emits a plan whose task table is decomposed **by
file ownership**. Each task names its owned files, the skills to apply, and the
tests to run. `implementer` agents then run **in parallel in the same working
tree** (no worktree isolation) — collision safety comes entirely from the
planner's non-overlapping file ownership. The plan is the contract; each
implementer gets one self-contained task in its spawn prompt.

```
request → planner (Opus, read-only) → Development Plan
                                          │  tasks decomposed by file ownership
                                          ▼
        implementer ×N (Sonnet) — parallel, one task each, tests must stay green
```

## Orchestration policy (token/cost right-sizing)

The catalog `model` column is each agent's **default**. The orchestrator (main
thread) may **override the model per spawn** and **fuse tasks** to cut cost and
repeated onboarding, without touching quality.

**Model routing — pick the cheapest model the task shape allows, escalate only for
real cross-module integration or architectural judgment:**

| Task shape | Model |
|---|---|
| Mechanical edit, ≤3 files, no new logic (e.g. flip constants, add i18n strings) | **Haiku** |
| Self-contained, well-specified helpers / client hooks / single-surface UI | **Sonnet** |
| Read-only research | **Sonnet** |
| Requirement-coverage verification (`plan-verifier`) | **Sonnet** |
| Hard cross-module integration (adapters + `container.ts` + wiring) | **Opus** |
| Planning + architecture review | **Opus** |

**Model floor (never break):** any task that touches `platform/container.ts`,
adapters, or cross-module wiring runs on **Opus** regardless of size.

**Task batching:** the planner tags disjoint, fuseable tasks with a shared **Batch**
id. Fuse them into a single implementer spawn to pay onboarding once — but **never
batch across a `Depends-on` edge or a shared-contract two-file edit.**

**Task cards, not the whole plan:** hand each implementer only its plan row (the
self-contained card), never the full plan doc. Feed review fixes back as **amended
cards**, not a fresh full-plan re-onboard.

**Scoped researcher briefs:** give each researcher a dirs-allowlist, tell it to skip
`clones/`, and assign shared contracts (`platform.ts`, `brief.ts`, …) to exactly one
researcher so the others skip them.

**Verifier trusts green:** after implementers hand off passing suites, `plan-verifier`
(and reviewers) confirm coverage by **reading** tests + spot-checking — not by re-running
the full `unit + .it.test + Docker` suites the implementers already passed. Re-running
green duplicates expensive work; reading the assertions is what catches a test that
passes while asserting the wrong thing. (Codified as `plan-verifier.md` Hard rule 7.)

## Skill wiring (hybrid)

The agents use the repo's `.claude/skills/`, loaded two different ways:

- **planner** — *preloads* only the two architecture skills (`onion-architecture`,
  `frontend-architecture`) via the `skills:` frontmatter field, so it plans
  against real Ports-&-Adapters / frontend-layout rules. All other skills it
  merely *names* per task (it never invents a name).
- **implementer** — invokes skills *dynamically* via the `Skill` tool (nothing
  preloaded, since it works on both UI and backend). It must apply the full
  backend set (`onion-architecture`, `fastify-best-practices`,
  `drizzle-orm-patterns`, `postgresql-table-design`, `zod`) or the full UI set
  (`frontend-architecture`, `next-best-practices`, `react-best-practices`,
  `react-testing-library`), plus cross-cutting (`typescript-expert`, `security`).
- **test-writer** — invokes skills *dynamically* via the `Skill` tool (works on
  both sides, so nothing preloaded): `react-testing-library` + the UI set for
  `client/**`, the backend set for `server/**` & `reviewer-core/**`, always
  `typescript-expert` (and `security` for input/auth tests).
- **architecture-reviewer** — *hybrid*: *preloads* `onion-architecture` +
  `frontend-architecture` via `skills:` (same rationale as planner: it reviews
  against the real layering rules), AND keeps the `Skill` tool to *invoke* any
  other skill on demand when a diff needs it (`zod`, `security`, the backend/UI
  sets). `permissionMode: plan` keeps it read-only regardless — invoking a
  skill only loads instructions, it writes nothing.
- **doc-writer** — invokes `mermaid-diagram` *dynamically* via the `Skill` tool
  when a diagram earns its place; no preload.
- **plan-verifier** — *neither* preloads nor carries the `Skill` tool. Its lens is
  requirement coverage, not architecture, so it stays lean and only *names*
  principles (`onion-architecture`, `zod`, `security`, …) when judging correctness.

Rule of thumb: to load a skill's *body* at startup use `skills:`; to let an agent
*invoke* skills on demand keep `Skill` in its `tools:`. See root `INSIGHTS.md`
(Tool & Library Notes) for the full distinction.

## What these agents are based on

`planner` and `implementer` were designed from official Anthropic guidance and
vetted practitioner patterns (researched 2026). Key practices applied:

- **Single-responsibility agents** + **description-as-routing-trigger** +
  **minimal per-agent toolset** — [Create custom subagents, Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- **Read-only planner via `permissionMode: plan`** (the built-in Plan agent is the
  reference implementation) — [Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- **Structured multi-section plan skeleton** (no code in the plan; per-phase risk +
  dependency ordering) — [ECC `planner.md`, affaan-m/everything-claude-code](https://github.com/affaan-m/everything-claude-code/blob/main/agents/planner.md)
- **Test suite as the stopping criterion** (loop write→test→fix until green; the
  agent never judges its own output) — [Best practices for Claude Code](https://code.claude.com/docs/en/best-practices)
- **Light, scoped diff self-review** (code + tests only, not a deep design review) —
  [code-reviewer example, Claude Code Docs](https://code.claude.com/docs/en/sub-agents)
- **Divide parallel work by file ownership, never the same file** — [How we built our
  multi-agent research system, Anthropic Engineering](https://www.anthropic.com/engineering/multi-agent-research-system)
  and [Orchestrate teams of Claude Code sessions](https://code.claude.com/docs/en/agent-teams)
- **Detailed spawn prompt** (subagents don't inherit the parent's chat history) —
  [Agent teams, Claude Code Docs](https://code.claude.com/docs/en/agent-teams)
- **Hybrid skill loading** (`skills:` preload vs `Skill`-tool dynamic invocation;
  progressive disclosure) — [Sub-agents Docs](https://code.claude.com/docs/en/sub-agents)
  and [Equipping agents with Agent Skills, Anthropic Engineering](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills)
- **Per-module context via `AGENTS.md` / `INSIGHTS.md`** read at the working
  directory (matches this repo's Session Protocol) — [Agent teams, Claude Code Docs](https://code.claude.com/docs/en/agent-teams)

Repo-specific decisions layered on top: Implementer on **Sonnet**; **no worktree
isolation** (shared branch, disjoint file ownership); Planner **preloads only the
two architecture skills**; Implementer self-review is **code-writing only**.

The four later agents (`test-writer`, `architecture-reviewer`, `plan-verifier`,
`doc-writer`) were designed the same way — from the repo's own conventions plus
researched practice (researched 2026):

- **test-writer** — the repo's testing philosophy ("typological, not exhaustive";
  the `*.it.test.ts` CI split) — `TESTING.md`; the testcontainers pattern —
  `server/test/helpers/pg.ts`; RTL house style — `AgentCard.test.tsx`; and the
  AI-test-author failure mode ("self-verification loop", green/red-zone,
  run-green-then-mutate-to-red) — [Autonoma: when to trust Claude writing tests](https://getautonoma.com/blog/claude-writing-tests-when-to-trust),
  [Kent C. Dodds: common RTL mistakes](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library),
  [Testing Library query priority](https://testing-library.com/docs/queries/about/),
  [Fastify testing guide](https://fastify.dev/docs/v5.2.x/Guides/Testing/),
  [Testcontainers best practices](https://www.docker.com/blog/testcontainers-best-practices/),
  [AAA pattern](https://automationpanda.com/2020/07/07/arrange-act-assert-a-pattern-for-writing-good-tests/),
  [Kent Beck: Programmer Test Principles](https://medium.com/@kentbeck_7670/programmer-test-principles-d01c064d7934).
- **architecture-reviewer** — mirrors the repo's proven review skeleton
  (`docs/agent-prompts/general-reviewer.md`); Dependency Rule / Ports-&-Adapters —
  [Uncle Bob: The Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html),
  [ploeh: Layers, Onions, Ports, Adapters](https://blog.ploeh.dk/2013/12/03/layers-onions-ports-adapters-its-all-the-same/),
  [Hexagonal architecture (Wikipedia)](https://en.wikipedia.org/wiki/Hexagonal_architecture_(software));
  earn-trust / anti-nitpick / false-positive discipline —
  [Augment Code: high-quality AI code review](https://www.augmentcode.com/blog/how-we-built-high-quality-ai-code-review-agent),
  [Graphite: AI review false positives](https://graphite.com/guides/ai-code-review-false-positives).
- **plan-verifier** — Requirements Traceability Matrix —
  [Perforce: how to create a traceability matrix](https://www.perforce.com/blog/alm/how-create-traceability-matrix);
  partial credit + verify actual state over self-report —
  [Anthropic: demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents);
  Acceptance Criteria vs Definition of Done —
  [Nulab](https://nulab.com/learn/software-development/definition-of-done-vs-acceptance-criteria/);
  gap analysis — [Qodo](https://www.qodo.ai/blog/gap-analysis-in-software-testing/).
- **doc-writer** — Diátaxis mode classification —
  [diataxis.fr](https://diataxis.fr/); ADR placement/format —
  [Fowler: Architecture Decision Record](https://martinfowler.com/bliki/ArchitectureDecisionRecord.html);
  code-grounded, hallucination-resistant doc generation —
  [DocAgent (arXiv:2504.08725)](https://arxiv.org/abs/2504.08725); Mermaid C4
  caveat — [Mermaid C4 syntax (experimental)](https://mermaid.js.org/syntax/c4.html).

## Creating a new agent

Mirror `researcher.md`'s format: block-scalar `description` written as a "Use
when…" trigger, comma-separated `tools`, a `model`, and a structured,
section-headed body. Only `name` + `description` are required; skill names in
`skills:` must match a directory in `.claude/skills/` exactly.
