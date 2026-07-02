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

## Skill wiring (hybrid)

Both new agents use the repo's `.claude/skills/`, loaded two different ways:

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

## Creating a new agent

Mirror `researcher.md`'s format: block-scalar `description` written as a "Use
when…" trigger, comma-separated `tools`, a `model`, and a structured,
section-headed body. Only `name` + `description` are required; skill names in
`skills:` must match a directory in `.claude/skills/` exactly.
