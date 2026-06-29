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

### 2026-06-29 — Skills CRUD + per-link toggle (L02)

**`setSkills` is delete-then-insert, so it must read prior `agent_skills.enabled` into a map before deleting — otherwise drag-reorder silently re-enables disabled skills.**
The Skills tab in the Agent Editor reorders via `POST /agents/:id/skills` with `skill_ids[]`. The repository implements that as `DELETE … WHERE agent_id` followed by a bulk `INSERT`. Reorder is supposed to be additive to the link's local state; if you don't preserve `enabled`, every reorder flips disabled skills back on. Fix lives at `server/src/modules/agents/repository.ts:230` — build `prevEnabled = new Map(existing.map(l => [l.skill.id, l.enabled]))` BEFORE the delete, then `enabled: prevEnabled.get(skillId) ?? true` in the insert values. Any future link-table that grows a per-link flag (e.g. weight, role) needs the same pattern in any "replace the set" operation.

**Multipart upload routes can't use `withTypeProvider<ZodTypeProvider>()` for the body — `req.file()` is added by `@fastify/multipart`'s module augmentation and bypasses the type provider entirely.**
`POST /skills/import` accepts a .md / .zip upload. The route is registered on the base `appBase`, NOT on `app = appBase.withTypeProvider<ZodTypeProvider>()`, and it uses `await req.file()` with no `schema.body`. If you put it on the ZodTypeProvider instance, `req.file` types out as not-on-the-request even though it works at runtime (the augmentation is global). Validation of the parsed preview happens at the NEXT step — `POST /skills/import/save` IS Zod-validated against `ImportPreviewBody`. Pattern: **multipart routes are validation-light at the boundary, the strict Zod schema enforces the shape one hop later when the preview is confirmed.** See `server/src/modules/skills/routes.ts:79` and the multipart plugin registration in `server/src/app.ts:96` (2MB / 1-file ceiling, the only multipart route in the app).

**Skill body changes bump `version`; renames/description/enabled-toggle do NOT — `skill_versions` snapshots are body-only and the contract assumes that.**
`server/src/modules/skills/repository.ts:79` only writes a `skillVersions` row when `patch.body !== undefined && patch.body !== existing.body`. The UI (`ConfigTab`) shows the version chip in the header and relies on this asymmetry — toggling `enabled` shouldn't pollute the snapshot table. If you later want renames to bump too, do it in this one place; don't add a second condition in the route.

**Hand-written migration without `pnpm db:generate` — add the entry to `_journal.json` by hand too, or the migrator skips it.**
Migration `0011_agent_skills_enabled.sql` was created without `db:generate` (single-column `ADD COLUMN`, schema edit was trivial). The migrator reads `meta/_journal.json`, not the directory listing, so the SQL file alone is invisible. Append `{ "idx": 11, "version": "7", "when": <ms>, "tag": "0011_agent_skills_enabled", "breakpoints": true }` to the entries array — `version: "7"` and `breakpoints: true` match what `db:generate` would emit. Skip a `meta/0011_snapshot.json` since the next `db:generate` will regenerate the latest snapshot from current schema; only an interim generate would notice the gap.

### 2026-06-29 — Conventions Extractor + API Contract Reviewer (L02)

**`FEATURE_MODELS` default provider is the silent culprit when `OPENAI_API_KEY is not configured` for a specific feature.**
`resolveFeatureModel` (`server/src/modules/settings/feature-models.ts:56`) falls back to `DEFAULTS[id]` when no workspace override exists. `DEFAULTS` is built from `FEATURE_MODELS` at module load (`platform.ts:43`). If the default provider for a feature is `'openai'` and the user only has `OPENROUTER_API_KEY`, the error is thrown at `container.ts:176` — deep inside the job handler, making the root cause non-obvious. The fix is `defaultProvider: 'openrouter'` in `FEATURE_MODELS` for the feature, mirrored in all three copies: `server/src/vendor/shared/contracts/platform.ts`, `client/src/vendor/shared/contracts/platform.ts`, `client/src/lib/constants/feature-models.constants.ts`. **Watch out:** if a workspace previously saved a DB override for that feature with `provider: 'openai'`, the override wins over the new default — it must be cleared through Settings UI or a direct DB update.

## Open Questions

_No entries yet._
