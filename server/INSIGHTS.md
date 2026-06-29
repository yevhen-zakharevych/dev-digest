# server — INSIGHTS

Landmines & engineering insights specific to the API. Repo-wide ones live in
`../INSIGHTS.md`.

> Append-only. New entries go into the section that best fits. Each entry must
> be actionable cold and cite `file:line`. If it would be obvious to anyone
> reading the code, do not write it. The `engineering-insights` skill writes
> here.

## What Works

_No entries yet._

## What Doesn't Work

_No entries yet._

## Codebase Patterns

**Pulls list response is a deliberate aggregation surface — extend it instead of adding per-PR endpoints.**
`server/src/modules/pulls/routes.ts` (the `GET /repos/:id/pulls` handler around line 114) already runs two IN-queries after fetching the PR rows: one for latest-review score, one for cycle cost. When the UI needs more per-PR aggregate fields (e.g. severity_counts for the FINDINGS column added 2026-06-27), the established pattern is to add another `inArray(t.reviews.prId, prIds)` query, build a `Map<prId, …>`, and merge in the return mapper — **not** to fan out per-row from the client. The list is bounded; the extra round-trip is cheaper than N client-side fetches. Mirror any new field in `PrMeta` (`server/src/vendor/shared/contracts/platform.ts:157` AND the client copy at `client/src/vendor/shared/contracts/platform.ts:157` — they must stay in sync, see CLAUDE.md gotcha).

## Tool & Library Notes

_No entries yet._

## Recurring Errors & Fixes

_No entries yet._

## Session Notes

### 2026-06-25 — Cost & Tokens Surfacing

**Seam-drop: costUsd was already computed, but executor destructure discarded it.**
OpenRouter provider returns `costUsd` from `completeStructured` (`reviewer-core/src/llm/openrouter.ts:107` — prefers OpenRouter `usage.cost`, falls back to the injected pricing table). `reviewPullRequest` aggregates per-chunk costs into `ReviewOutcome.costUsd` (`reviewer-core/src/review/run.ts:216`). The bug was in the consumer: `run-executor.ts:213` destructured only `{ tokensIn, tokensOut, grounding }` from `outcome`, so `costUsd` never reached `completeAgentRun` or `trace.stats` and never hit the DB. Whenever you add a new metric to `ReviewOutcome`, this destructure is the single chokepoint that must change in lockstep — `grep run-executor.ts` for the field name and verify it survives into both the persist call and the `trace.stats` literal a few lines down.

**`agent_runs` has `head_sha` (since 0010) — use it for any "current cycle" SQL aggregation.**
Before migration `0010_peaceful_punisher.sql`, runs had no link to the commit they ran against, so "cost in the latest review cycle" couldn't be expressed as a pure SQL aggregation — you'd have to JOIN through `pr_commits` and reason about timestamps. Now `agent_runs.head_sha` is populated in `createAgentRun` (`server/src/modules/reviews/repository/run.repo.ts:117`) from `pull.headSha`, and any per-cycle metric should filter `WHERE head_sha = pull_requests.head_sha` (see PR-list aggregation in `server/src/modules/pulls/routes.ts`). **Important: pre-migration `agent_runs` rows have `head_sha = NULL` and are excluded from cycle sums on purpose** — the UI renders `—` for them (no data), not `$0.00`.

**Drizzle migration rollback (before applying) — three files, not just the SQL.**
If `pnpm db:generate` produces a migration you want to amend (e.g. you forgot a column), do NOT hand-edit the SQL — the `meta/000X_snapshot.json` will be out of sync with the schema and the next generate will produce a broken diff. Correct rollback:
1. `rm src/db/migrations/000X_<slug>.sql`
2. `rm src/db/migrations/meta/000X_snapshot.json`
3. Edit `src/db/migrations/meta/_journal.json` and remove the entry with `"idx": X`.
4. Re-run `pnpm db:generate` — Drizzle picks the same slot fresh.

Done correctly this is invisible to anyone who pulls; the dropped migration never existed.

## Open Questions

_No entries yet._
