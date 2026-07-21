# Handoff — Multi-Agent Review (L07)

**Branch:** `emdash/multi-agents-review-vqiie` · **Base:** `c61fa02` (main)
**Worktree:** `/Users/yevhen/emdash/worktrees/dev-digest/emdash/multi-agents-review-vqiie`
**Session:** `1f3ca111-81ae-4658-88b1-00e7df23ba95` (2026-07-21, 13:55–19:15 UTC)

> **Nothing is committed.** The entire feature lives in the working tree as
> modified + untracked files. `git stash`, `git checkout .` or a careless
> `git clean -fd` will destroy ~6 hours of fleet work. Commit before anything
> destructive.

---

## 1. State in one paragraph

The Multi-Agent Review feature is **implemented, reviewed, and green**. A spec was
written and revised four times, an implementation plan produced 4 tasks in 2 waves,
four `implementer` agents built it, and two read-only reviewers (`architecture-reviewer`,
`plan-verifier`) each found exactly one real defect — both fixed inline. All 27
acceptance criteria are discharged by code. What remains is **verification against
live data by the user, a commit, and a PR** — plus one deferred product question
(a repo-wide list of past multi-runs).

---

## 2. Resume checklist (do this first in a new session)

```bash
cd /Users/yevhen/emdash/worktrees/dev-digest/emdash/multi-agents-review-vqiie

# 1. Deps — a fresh worktree has NO node_modules anywhere.
cd server && pnpm install && cd ../client && pnpm install && cd ../reviewer-core && pnpm install
#    ^ reviewer-core matters: server/tsconfig pulls it in as TS SOURCE via a path
#      alias, so without its deps `cd server && pnpm typecheck` reports 6 PHANTOM
#      errors in reviewer-core/src/llm/*. They are not a regression. See §7.

# 2. Secrets — server/.env is gitignored, so `git worktree` did NOT copy it.
#    This worktree's copy was a template with EMPTY values; the two real keys
#    were filled from the main checkout on 2026-07-21. If they are empty again:
#      OPENROUTER_API_KEY / GITHUB_TOKEN  ←  /Users/yevhen/Code/ai-agentic-engineering/dev-digest/server/.env
#    Symptom when missing: every agent run fails instantly with
#    "OPENROUTER_API_KEY is not configured", 0 tokens.
#    The API reads .env at BOOT — restart after editing.

# 3. DB — migration 0017 is NOT applied on boot.
docker compose up -d          # NEVER `down -v` — wipes all imported repos + reviews
cd server && pnpm db:migrate

# 4. Run
./scripts/dev.sh
```

---

## 3. What the feature does

Pick N agents on a PR → one multi-run row groups their `agent_run`s → a results page
shows one live column per agent → a "Where agents disagree" block groups findings that
land on the same line of the same file and shows every completed agent's verdict,
including "did not flag".

Entry points:
- **PR page** — `Run agents` trigger opens a panel (checkboxes + per-agent time hint +
  summary estimate). A `Multi-agent results` button appears beside it once the PR has a run.
- **Sidebar → GLOBAL → Multi-Agent Review** — `/repos/:repoId/multi-agent`, the
  Configure-run page (pick PR → pick agents → run; links to existing results).
- **Results** — `/repos/:repoId/multi-agent/:number`.

---

## 4. File map

### Server (new)
| Path | Role |
|---|---|
| `server/src/modules/multi-agent/routes.ts` | transport only — `POST /pulls/:id/multi-agent-runs` (201, rate-limited 10/min), `GET /pulls/:id/multi-agent-runs/latest` |
| `server/src/modules/multi-agent/service.ts` | orchestration; resolves PR + agents **before** inserting the grouping row |
| `server/src/modules/multi-agent/repository.ts` | all Drizzle; row → `AgentColumn` mapping, defensive status/severity fallbacks |
| `server/src/modules/multi-agent/grouping.ts` | **pure** — exact `(file, start_line)` bucket, zero I/O imports |
| `server/src/modules/multi-agent/grouping.test.ts` | 15 unit tests incl. seeded-shuffle determinism |
| `server/src/modules/multi-agent/multi-agent.it.test.ts` | 15 integration tests |
| `server/src/modules/agents/estimates.it.test.ts` | 5 tests for the estimates read model |
| `server/src/db/migrations/0017_lazy_starjammers.sql` | `ADD COLUMN multi_agent_run_id` + FK + plain index |
| `server/src/vendor/shared/contracts/estimates.ts` | net-new contract (dual-vendored) |

### Server (modified)
`db/schema/runs.ts` · `modules/index.ts` · `modules/reviews/{service,routes,repository}.ts` ·
`modules/reviews/repository/run.repo.ts` · `modules/agents/{repository,service,routes}.ts` ·
`vendor/shared/contracts/observability.ts` · `vendor/shared/index.ts`

### Client (new)
| Path | Role |
|---|---|
| `client/src/app/repos/[repoId]/multi-agent/page.tsx` + `_components/{PrPicker,AgentSelection}/` | Configure-run page |
| `client/src/app/repos/[repoId]/multi-agent/[number]/` | results page + `AgentColumns`, `AgentColumnCard`, `FindingDetailPanel`, `DisagreementBlock`, `_lib/` |
| `client/src/app/repos/[repoId]/pulls/[number]/_components/MultiAgentPicker/` | PR-page trigger + panel |
| `client/src/features/multi-agent/` | `components/AgentPickList`, `helpers.ts`, `hooks/useAgentSelection.ts` |
| `client/src/features/reviews/components/FindingCard/` | **moved** here from the PR route (see §6) |
| `client/src/lib/hooks/multi-agent.ts`, `multi-agent-runs.ts` (+ tests) | data layer |
| `client/messages/en/multiAgent.json` | new i18n namespace |

### Client (modified)
`vendor/ui/nav.ts` (+ test) · `vendor/shared/{contracts/observability.ts,index.ts}` ·
`messages/en/runs.json` (append-only) · `pulls/[number]/page.tsx` ·
`_components/{PrDetailHeader,FindingsPanel}/`

### Deleted
`_components/RunReviewDropdown/` (4 files). `useRunReview` and `POST /pulls/:id/review`
**stay** — the MCP `run_agent_on_pr` tool depends on them (it calls over HTTP).

---

## 5. Decisions — and why (all recorded in the spec's `## Revision log`)

| # | Decision | Why |
|---|---|---|
| 1 | Grouping is an exact `(file, start_line)` key, **not** range overlap | Overlap is not transitive (10–15 ~ 14–20 ~ 19–25, but 10–15 ≁ 19–25) so grouping by it is order-dependent and cannot satisfy AC-20's determinism. Also no reusable primitive exists: `rangeIntersects` is `Set<number>`-shaped, `rangesOverlap` is unexported. Accepted cost: lines 41 and 42 land in different groups. |
| 2 | One display mode (Columns), no Tabs, no toggle | The mockup's second mode is presentational over identical data and re-implements a detail view `FindingCard` already renders. Removed ~1 implementer task. **Deferred, not cancelled.** |
| 3 | Finding detail reuses `FindingCard` via a **client-side join** on finding `id` against `GET /pulls/:id/reviews` | Avoids widening the dual-vendored `AgentColumnFinding`. Works cleanly because `useFindingAction` already invalidates `["reviews", prId]` — the exact key the join reads. |
| 4 | AC-14 copy: scaffolded "fan-out via p-queue", **not** "via worktrees" | The mockup wording advertises isolation this feature does not implement; the spec's own Design-gaps section already flagged it. Bonus: one fewer i18n edit. |
| 5 | AC-16 does not mandate SSE | `useRunEvents` returns only `{events, running}` — no status/score/cost/terminal signal, so it *cannot* drive a column header. Uses the repo's own precedent: a self-clearing poll. |
| 6 | AC-19 cannot forbid passing a handler | `FindingCard` has ONE unified `onAction`, and AC-18 requires accept/dismiss wired. The handler no-ops for everything else. |
| 7 | AC-1 is a trigger + panel, not an inline list | The first build rendered the list inline; with 6 real agents it consumed the whole PR header. The shared `Dropdown` kit is unusable here — it calls `onClose()` on every item click. |
| 8 | Index on `agent_runs.multi_agent_run_id` adopted (plan R1) | `agent_runs` had zero indexes; both new read models scan it. **Plain** index only — `drizzle-kit` emits an unbound `$1` for a partial predicate built with `eq()`. |
| 9 | Nav entry lives in a new `GLOBAL` section | User's design. Memory / Agent Performance / CI Runs from that mockup were **not** added — those routes do not exist and a nav entry to a missing route is a dangling link. |

---

## 6. Review findings and how they were closed

Both reviewers ran read-only against the finished diff, told the suites were green and
forbidden from re-running them.

**`architecture-reviewer` — 1 CRITICAL, 3 suggestions. All closed.**
- **CRITICAL:** `FindingDetailPanel` relative-imported `FindingCard` across a route
  boundary. Two `client/CLAUDE.md` rules broken at once. → moved to
  `client/src/features/reviews/components/FindingCard/`; both import sites now use
  `@/features/...`. *Notable: T3 hit the same "one component, two consumers" problem and
  solved it correctly by lifting; T4 solved it wrongly. Same diff, opposite answers.*
- Duplicated picker state in two route-local files → extracted `useAgentSelection`.
- `Logger` type imported from `reviews/run-executor.ts` (the server's only cross-module
  reach into that file) → switched to `platform/run-logger.ts`'s `PinoLike`, which is
  **byte-identical** and already existed. Better than either option the reviewer proposed.
- `runReview(…, logger?, multiAgentRunId?)` two trailing positional optionals → options
  bag `RunReviewOptions`. *The reviewer said 3 call sites; there are 2 — the MCP tool
  goes over HTTP.*

**`plan-verifier` — 26 of 27 ACs PASS, 1 PARTIAL. Closed.**
- **AC-13:** nothing invalidated `latestMultiRunKey` after creating a multi-run. With
  `staleTime: 30_000`, `refetchOnWindowFocus: false`, and a poll that stops once no column
  is `running`, the results page served the **previous** multi-run (or a cached `null`
  empty state) with nothing to self-correct it. The same diff had also *deleted* the old
  flow's counterpart invalidation. → `onSuccess` invalidation + regression test,
  **mutation-verified** (removing the fix turns the test red).
- Two accepted non-defects: the 429 itself is unprovable (rate limiting is off under
  `NODE_ENV=test`), and "Configure agents" is a `<button>` not an `<a href>`.

**Found later by the user, after the reviewers:** the results route was a **dead end** —
nothing in the app linked to `/repos/:repoId/multi-agent/:number`, so navigating away
stranded it. Neither reviewer caught it because every individual AC passes: AC-3/AC-6 only
require navigating *after a run*. No AC asked "how do I come back?". → links added on both
the PR page and the Configure page.

---

## 7. Verification — exact commands and expected numbers

Last measured 2026-07-21 ~19:12.

| Suite | Command | Expected |
|---|---|---|
| client | `cd client && pnpm test` | **272 passed / 52 files** |
| client types | `cd client && pnpm typecheck` | clean |
| server unit | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | **297 passed / 33 files** |
| server integration | `cd server && pnpm exec vitest run .it.test` | **142 passed / 24 files** |
| server types | `cd server && pnpm typecheck` | clean *(only with `reviewer-core` deps installed)* |

Two traps that make a green run meaningless:
- **A skipped integration suite looks identical to a passing one.** `dockerAvailable()`
  (`server/test/helpers/pg.ts:23`) turns every `.it.test.ts` into `describe.skip` when the
  Docker **daemon** is down (the CLI still exists, so a `which docker` check passes).
  **Check the test COUNT, never the exit code.**
- **`pnpm test` and `pnpm typecheck` are two different gates.** `noUncheckedIndexedAccess`
  plus mock-signature inference means a test file can pass at runtime and fail `tsc`.
  This happened twice this session. Always run both.

---

## 8. Open items

1. **Commit + PR.** Nothing is committed. Suggested commit boundary: one commit for the
   feature, or split server/client. Spec, plan, retro and INSIGHTS edits are part of it.
2. **Repo-wide list of past multi-runs** — the user asked, then said "what's there is
   enough". Genuinely deferred. Would need a new server endpoint (list multi-runs per
   repo), a dual-vendored contract addition, a hook and UI — roughly one implementer task.
   Distinct from the spec's deferred non-goal (browsing *older* runs of one PR).
3. **Redundant merged-PR warning.** It now renders both in the picker panel (per the
   mockup) and in the pre-existing page banner under the PR header. Offered to drop the
   page banner; no answer yet.
4. **`Clear` button placement.** AC-1 requires the action; the mockup's footer has no
   room, so it sits in the panel header and appears only when something is selected.
   Flagged to the user; no objection recorded.
5. **Deferred by the spec, untouched:** the Tabs+detail display mode, range-based or
   semantic grouping, multi-run history per PR, the Agent Performance page.

---

## 9. Landmines discovered this session

All written to the INSIGHTS files (append-only) — this is an index, not a copy.

**Root `INSIGHTS.md`** — phantom `reviewer-core/src/llm/*` typecheck errors in a fresh
worktree · a literal NUL in a `.ts` file silences `grep` (and `grep -q $'\x00'` is itself
a false-positive trap — the shell truncates it to an empty pattern) · two implementers
answering the same placement question opposite ways · a fleet cannot converge on a
convention it was not given · a spec AC that names a *mechanism* must be grepped against
the API before it is written.

**`server/INSIGHTS.md`** — the silent `describe.skip` above · seeded shuffle for a
determinism test · `reviews.runId` resolving to several rows and why "newest first" picks
the wrong one · the free-text→Zod-enum 500 has a second host (`findings.severity`) ·
resolve before inserting a parent row.

**`client/INSIGHTS.md`** — `next-intl` ICU-formats a number arg, so line 1041 renders
`1,041` (fixtures under 1000 never catch it) · an exported query key whose comment says
"so callers can invalidate it" with zero callers is a reliable defect smell · make the
*element* conditional for "blank when null, never 0" · why the client-side join beat a
contract edit · `ConfidenceNum` renders `0.9` as `"90% conf"` · mock `AppShell` when
testing a page · the shared `Dropdown` closes on every item click.

---

## 10. Artifacts

| Document | Path |
|---|---|
| Specification (27 ACs + Revision log) | `specs/2026-07-21-multi-agent-review.md` |
| Implementation plan (4 tasks, AC→task matrix) | `docs/plans/multi-agent-review.md` |
| Orchestration retro (agents, tokens, waves) | `docs/retros/2026-07-21-multi-agent-review.md` |
| Cross-run trend ledger | `docs/retros/ledger.md` |
| This handoff | `docs/handoff/2026-07-21-multi-agent-review.md` |

**Fleet, for transcript archaeology** (`~/.claude/projects/-Users-yevhen-emdash-worktrees-dev-digest-emdash-multi-agents-review-vqiie/`):

| Agent | Type | Model | Output | Cache-read |
|---|---|---|---|---|
| `a717459697adc7088` | implementation-planner (+3 nested researchers) | opus | 67.2k | 1.7M |
| `a83bb9fdf52ad5c36` | implementer T1 — persistence, read model, grouping | opus | 36.6k | 21.2M |
| `abda8e0ab1d3eebbe` | implementer T2 — estimates | sonnet | 20.5k | 9.2M |
| `ad26a6f7249d394f7` | implementer T3 — picker, configure page, nav | sonnet | 65.9k | 20.9M |
| `ada74a452dc04f79f` | implementer T4 — results page, disagreement block | opus | 37.9k | 13.4M |
| `a7740bef5caa77f69` | architecture-reviewer | opus | 17.5k | 3.6M |
| `aa18fb45d6146b826` | plan-verifier | opus | 23.8k | 10.6M |

Do **not** `cat`/`Read` those `.jsonl` transcripts — they are multi-megabyte and will
overflow a context window. Use `.claude/skills/workflow-retro/scripts/collect.sh`.

---

## 11. If you change one thing, know this

- **Contracts are dual-vendored.** `server/src/vendor/shared/` and
  `client/src/vendor/shared/` are physically separate files. Every edit is a two-file
  edit, and one-sided edits typecheck fine on each side and then fail at runtime when Zod
  rejects the wire payload. `observability.ts`, `estimates.ts`, `findings.ts`,
  `review-api.ts` and `index.ts` are currently byte-identical across the two trees;
  four *other* contract files are already legitimately drifted, so verify a mirrored edit
  by diffing **added lines only**, never whole-file equality.
- **`client/messages/en/runs.json` is a shared namespace** with live consumers
  (`RunTraceDrawer` and its subtree). Append/extend only; never remove or rename a key.
- **`grouping.ts` must stay pure.** Its only import is type-only. Determinism is asserted
  by a seeded shuffle; if you touch it, that test is the contract.
- **Never `docker compose down -v`.** It wipes `devdigest_pgdata` — every imported repo
  and review.
