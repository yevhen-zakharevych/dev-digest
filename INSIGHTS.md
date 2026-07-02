# Repo-wide INSIGHTS

Landmines, surprises, and engineering insights that span more than one module.
Module-specific insights live in `<module>/INSIGHTS.md`.

> Append-only. New entries go into the section that best fits. Each entry must
> be actionable cold and cite `file:line`. If it would be obvious to anyone
> reading the code, do not write it. The `engineering-insights` skill writes
> here.

## What Works

_No entries yet._

## What Doesn't Work

_No entries yet._

## Codebase Patterns

_No entries yet._

## Tool & Library Notes

**Attaching skills to a `.claude/agents/*.md` subagent: `skills:` preloads the body, `Skill` tool invokes on demand — they are different mechanisms.** To have a subagent load a skill's *full content* at startup, list it under the `skills:` frontmatter field (NOT by adding `Skill` to `tools`). A subagent can still invoke any other project/user skill dynamically at runtime as long as the `Skill` tool is in its `tools:` list. We use both deliberately: `planner.md:9` preloads only the two architecture skills (`onion-architecture`, `frontend-architecture`) via `skills:` so planning is grounded in real practice content, while `implementer.md` keeps `Skill` in `tools` and invokes the backend/UI skill set on demand (preloading every set would bloat context for an agent that does both UI and backend). `permissionMode: plan` (planner.md:8) makes an agent runtime-read-only — stronger than merely omitting Write/Edit from `tools`.

**Parallel implementer agents share the working tree — collision safety is by file ownership, not isolation.** `implementer.md` intentionally omits `isolation: worktree`; multiple implementers run in the same branch/checkout. The only thing preventing overwrites is the planner decomposing tasks so no two own the same file (`planner.md` task table + "Files owned" column). If you re-enable parallelism, keep task file-sets disjoint or add `isolation: worktree` back.

## Recurring Errors & Fixes

_No entries yet._

## Session Notes

### 2026-06-25 — Cost & Tokens Surfacing

**Vendored `shared` lives in TWO places — every contract edit is a two-file edit.**
`server/src/vendor/shared/contracts/*.ts` and `client/src/vendor/shared/contracts/*.ts` are logically the same source but physically separate files. `client/CLAUDE.md` calls this out, but it's easy to forget mid-edit and the symptoms are nasty: typecheck passes on each side independently, but at runtime Zod rejects the wire payload (server emits a field the client schema doesn't know, or vice versa). During this feature I had to mirror three changes in lockstep: `cost_usd` on `RunSummary` and `RunStats` (`trace.ts`), and `cost_usd_cycle` on `PrMeta` (`platform.ts`). The minor cosmetic differences between the two copies (slightly different docstrings) make `diff -u` noisy — verify diffs with `diff -u | grep -v '^[-+]\s*///\?'` or compare just the schema shapes.

Future cleanup question: can these two trees be replaced with a single source via path alias (the way `reviewer-core` is consumed)? Currently they aren't — it's a deliberate vendoring per the root `CLAUDE.md` ("NOT a workspace. Each package owns its `package.json` + lockfile").

## Open Questions

_No entries yet._
