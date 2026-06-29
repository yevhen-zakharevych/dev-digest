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

_No entries yet._

## Recurring Errors & Fixes

_No entries yet._

## Session Notes

### 2026-06-25 — Cost & Tokens Surfacing

**Vendored `shared` lives in TWO places — every contract edit is a two-file edit.**
`server/src/vendor/shared/contracts/*.ts` and `client/src/vendor/shared/contracts/*.ts` are logically the same source but physically separate files. `client/CLAUDE.md` calls this out, but it's easy to forget mid-edit and the symptoms are nasty: typecheck passes on each side independently, but at runtime Zod rejects the wire payload (server emits a field the client schema doesn't know, or vice versa). During this feature I had to mirror three changes in lockstep: `cost_usd` on `RunSummary` and `RunStats` (`trace.ts`), and `cost_usd_cycle` on `PrMeta` (`platform.ts`). The minor cosmetic differences between the two copies (slightly different docstrings) make `diff -u` noisy — verify diffs with `diff -u | grep -v '^[-+]\s*///\?'` or compare just the schema shapes.

Future cleanup question: can these two trees be replaced with a single source via path alias (the way `reviewer-core` is consumed)? Currently they aren't — it's a deliberate vendoring per the root `CLAUDE.md` ("NOT a workspace. Each package owns its `package.json` + lockfile").

## Open Questions

_No entries yet._
