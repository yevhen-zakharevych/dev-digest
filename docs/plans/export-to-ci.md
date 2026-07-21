# Implementation Plan — Export to CI

**Spec (authoritative, read-only input):** `specs/2026-07-21-export-to-ci.md`
(SPEC-2026-07-21-export-to-ci, AC-1 … AC-49)
**Plan date:** 2026-07-21
**Fleet budget:** hard cap of 5 implementation agents. This plan uses **4 agent tasks**
and reserves the 5th slot for the review fix-loop. Six items are **orchestrator-inline**
and do not count.

---

## 1. Overview

The bridge between a tuned studio agent and a real repository's CI already has both ends
built: `agent-runner/` reads `.devdigest/**` and runs the review; the Zod contracts, the
`ci_installations`/`ci_runs` tables, `agents.ci_fail_on`, the `commitFiles`/`findOpenPr`
GitHub port methods, the `ExportWizardSteps` stepper and the whole `ci` message catalogue
are all pre-scaffolded. What is missing is the middle: `server/src/modules/ci/`, two GitHub
Actions port methods, `client/src/app/ci-runs/`, the export wizard, the agent CI tab, one
nav entry, one migration, one mirrored contract field, and an i18n cleanup.

Requirement ids are the spec's own `AC-N` — reused verbatim, never renumbered.

The decomposition follows root `INSIGHTS.md:142` (split by package side) modified by
`INSIGHTS.md:210`/`:216` (orchestrator does the shared-surface, collision-prone work
inline). The server side is cut once, at a real import boundary: a **pure generation core**
(no fs, no network) and everything that touches I/O. The client side is cut into two
disjoint route surfaces.

---

## 2. Requirements (as given)

Every row is restated from the spec; nothing here originates with this plan.

| ID | Requirement (abridged) | Source |
|----|------------------------|--------|
| AC-1 | "Add to CI" opens a 4-step modal wizard (Target → Preview → Configure → Install), starting on Target with GitHub Actions preselected | `specs/2026-07-21-export-to-ci.md:113` |
| AC-2 | CircleCI / Jenkins / Generic CLI render as disabled "coming soon" cards; cannot advance unless GitHub Actions is selected | `specs/2026-07-21-export-to-ci.md:118` |
| AC-3 | Target step carries a free-text `owner/name` repo field, pre-filled with the active workspace repo, editable | `specs/2026-07-21-export-to-ci.md:124` |
| AC-4 | Empty or non-`owner/name` value blocks Continue; server rejects with a validation error **before any GitHub call** | `specs/2026-07-21-export-to-ci.md:127` |
| AC-5 | Entering Preview obtains the full file list and performs **no write of any kind** to the target repo | `specs/2026-07-21-export-to-ci.md:135` |
| AC-6 | Bundle = exactly manifest + one md per enabled skill + empty `.devdigest/memory.jsonl` + workflow + **every file the runner build emitted**, each under `.devdigest/runner/` | `specs/2026-07-21-export-to-ci.md:139` |
| AC-6a | The runner ships as its build's COMPLETE file set, never the entrypoint alone — verified by execution: the entrypoint alone dies with a module-syntax error in any target repo that does not opt into ES modules | `specs/2026-07-21-export-to-ci.md:147` |
| AC-7 | Manifest carries name, provider, model, system prompt, enabled skill slugs, strategy, `ci_fail_on`; validates against the same contract the runner uses | `specs/2026-07-21-export-to-ci.md:146` |
| AC-8 | Missing runner bundle → whole operation fails naming the artifact + the build command; nothing committed, no PR, no installation | `specs/2026-07-21-export-to-ci.md:151` |
| AC-9 | Preview marks the workflow as the only editable file and does **not** transmit runner contents (payload < 1 MB) | `specs/2026-07-21-export-to-ci.md:157` |
| AC-10 | An edited workflow text is committed verbatim at the fixed generated workflow path | `specs/2026-07-21-export-to-ci.md:161` |
| AC-11 | Any client-supplied file path, or content other than the single workflow override → reject, commit nothing | `specs/2026-07-21-export-to-ci.md:164` |
| AC-12 | Workflow override > 64 KB → reject, commit nothing | `specs/2026-07-21-export-to-ci.md:168` |
| AC-13 | Byte-identical files for identical agent config + identical wizard input (incl. manifest key order) | `specs/2026-07-21-export-to-ci.md:172` |
| AC-14 | Only trigger is `pull_request`, restricted to the selected types; no `issue_comment`/`workflow_dispatch`/`push`/`schedule` | `specs/2026-07-21-export-to-ci.md:178` |
| AC-15 | No `paths`/`paths-ignore`/`branches`/`branches-ignore`/`tags`/`tags-ignore` filter on the trigger | `specs/2026-07-21-export-to-ci.md:182` |
| AC-16 | `pull_request_target` never appears | `specs/2026-07-21-export-to-ci.md:187` |
| AC-17 | Exactly two permissions: `contents: read`, `pull-requests: write` | `specs/2026-07-21-export-to-ci.md:190` |
| AC-18 | Fork head branch → review job skipped; the workflow run is still created | `specs/2026-07-21-export-to-ci.md:193` |
| AC-19 | Model credential referenced only as Actions secret `OPENROUTER_API_KEY`; no credential value in any generated file or log | `specs/2026-07-21-export-to-ci.md:197` |
| AC-20 | "Post results as" passed as an env var on the run step; **no** `post_as` field added to the manifest contract | `specs/2026-07-21-export-to-ci.md:203` |
| AC-21 | Workflow invokes `node .devdigest/runner/index.js`; only first-party `uses:` (checkout, setup-node, upload-artifact); no marketplace action | `specs/2026-07-21-export-to-ci.md:207` |
| AC-22 | Result file uploaded as a workflow artifact even when the review step exits non-zero | `specs/2026-07-21-export-to-ci.md:212` |
| AC-23 | Empty trigger selection → Continue blocked and server rejects | `specs/2026-07-21-export-to-ci.md:216` |
| AC-24 | Install writes every file as ONE commit on `devdigest/ci` from the chosen base, then opens a PR; base branch untouched | `specs/2026-07-21-export-to-ci.md:223` |
| AC-25 | An existing open PR from `devdigest/ci` is reused, not duplicated | `specs/2026-07-21-export-to-ci.md:228` |
| AC-26 | GitHub write rejection → error naming the repo + needed access, no installation, no partial success | `specs/2026-07-21-export-to-ci.md:232` |
| AC-27 | Exactly one installation per (agent, repository); re-export updates it | `specs/2026-07-21-export-to-ci.md:237` |
| AC-28 | Export response carries installation record + committed file list + PR URL | `specs/2026-07-21-export-to-ci.md:242` |
| AC-29 | Changing "Fail CI on" persists on the agent and writes nothing to any target repo | `specs/2026-07-21-export-to-ci.md:247` |
| AC-30 | "Update CI config" on one row commits regenerated manifest + skills to that repo's `devdigest/ci`, reusing the open PR, leaving workflow and runner untouched | `specs/2026-07-21-export-to-ci.md:252` |
| AC-31 | The update action addresses exactly one installation per activation | `specs/2026-07-21-export-to-ci.md:257` |
| AC-32 | Refresh queries Actions per installation in the caller's workspace, bounded to 20 most recent runs of the generated workflow; **no ingestion at any other time** | `specs/2026-07-21-export-to-ci.md:263` |
| AC-33 | Status derived deterministically from the artifact, never from the workflow run's conclusion | `specs/2026-07-21-export-to-ci.md:269` |
| AC-34 | Re-ingesting a run updates the existing record, keyed by (installation, workflow-run URL) | `specs/2026-07-21-export-to-ci.md:275` |
| AC-35 | Missing / unreadable / invalid artifact → `failed` with null findings, cost, duration; **no field from the invalid payload persisted** | `specs/2026-07-21-export-to-ci.md:280` |
| AC-36 | Read only the single expected entry from the archive, write nothing to disk, reject archives > 5 MB | `specs/2026-07-21-export-to-ci.md:285` |
| AC-37 | One installation's GitHub failure does not abort the rest; the response names the repos that failed | `specs/2026-07-21-export-to-ci.md:290` |
| AC-38 | CI Runs lists only runs reachable installation → agent → workspace; never create a run without an installation | `specs/2026-07-21-export-to-ci.md:295` |
| AC-39 | Empty state explaining runs appear after an agent is exported to CI | `specs/2026-07-21-export-to-ci.md:300` |
| AC-40 | Each row shows PR number, repository, agent name, status, findings count, cost, duration, Actions run link | `specs/2026-07-21-export-to-ci.md:303` |
| AC-41 | Sidebar carries a `GLOBAL` section with a `CI Runs` entry, highlighted while that page is open | `specs/2026-07-21-export-to-ci.md:311` |
| AC-42 | Agent editor offers a `CI` tab, reachable by click and by URL deep link | `specs/2026-07-21-export-to-ci.md:314` |
| AC-43 | CI tab lists one row per installed repo (repo, target type, latest ingested run status, how long ago) plus an "active in N repos" count; "no runs yet" for a repo with none | `specs/2026-07-21-export-to-ci.md:318` |
| AC-44 | Configure step presents expected secrets as static reference info; no "checked" indicator, no request on open | `specs/2026-07-21-export-to-ci.md:323` |
| AC-45 | Configure step explains blocking a merge = "Fail CI on" + a required check in branch protection, and that no GitHub App is needed | `specs/2026-07-21-export-to-ci.md:329` |
| AC-46 | Every CI operation scoped to the caller's workspace; another workspace's agent/installation/run resolves as **not found** | `specs/2026-07-21-export-to-ci.md:336` |
| AC-47 | Export ≤ 10 req/min, refresh ≤ 6 req/min, per workspace | `specs/2026-07-21-export-to-ci.md:341` |
| AC-48 | Bundle contains no option disabling the grounding gate or moving PR title/body/diff outside the untrusted fence | `specs/2026-07-21-export-to-ci.md:345` |
| AC-49 | Exactly one CI vocabulary; superseded strings **removed**, not left beside the new ones | `specs/2026-07-21-export-to-ci.md:349` |

---

## 3. Requirements Review

Audited against complete / consistent / unambiguous / testable. Overall: **the spec is
unusually implementation-ready** — every AC names a concrete observable, and the Non-goals
list is explicit enough that scope creep is easy to detect. Eight issues found, **none
blocking**; each maps to a numbered Open Question in §4.

**Complete.** Gaps found:

- **AC-40 vs the catalogue.** AC-40 requires eight per-row values. The pre-scaffolded
  `runs.table` block (`client/messages/en/ci.json:16-23`) declares six, and three of AC-40's
  eight (repository, agent name, duration) have no key at all. Not a spec defect — a
  catalogue gap AC-49 forces us to close anyway. → **OQ-5**.
- **AC-43 has no response contract.** The CI tab needs, per installed repo, the latest
  ingested run's status and recency. `CiInstallation`
  (`server/src/vendor/shared/contracts/eval-ci.ts:415-422`) carries none of that, and the
  spec states this feature needs *exactly one* mirrored contract edit
  (`specs/2026-07-21-export-to-ci.md:548-550`). The plan composes two already-vendored
  schemas at the route rather than adding a second mirrored symbol — the same reasoning the
  spec applies to Preview. Named in §7 so the fleet does not invent a shape.
- **AC-37's response shape** is unspecified beyond "reports which repositories could not be
  refreshed". Named in §7.
- **AC-30's endpoint carries no rate limit** although it writes to GitHub, while AC-47
  limits export and refresh. → **OQ-7**.

**Consistent.** One contradiction and two frictions with existing artefacts:

- `runs.autoRefresh: "auto-refresh on"` (`client/messages/en/ci.json:7`) asserts a behaviour
  AC-32 explicitly forbids ("leaving the page open for an hour issues none"). → **OQ-4**.
- `CiExportInput.action` already admits `'files'`
  (`server/src/vendor/shared/contracts/eval-ci.ts:405`), which the spec cuts as a Non-goal
  (`:48-50`). The contract is wider than the spec. → **OQ-2**.
- AC-7 requires the manifest to carry the agent's stored `provider`, but the runner never
  reads it — `agent-runner/src/index.ts:39` constructs an OpenRouter provider
  unconditionally, consistent with AC-19's single `OPENROUTER_API_KEY`. An `openai` or
  `anthropic` agent therefore silently runs on OpenRouter in CI. → **OQ-3**.
- AC-15 is *corroborated* by an existing landmine (root `INSIGHTS.md:25`), not contradicted.
  Good sign — the spec author already internalised it.

**Unambiguous.** One measurement ambiguity:

- AC-12's "64 KB" does not say bytes or characters. For non-ASCII workflow text the two
  differ. → **OQ-6**.

**Testable.** Every AC states a pass/fail observable. Three carry a caveat the plan must
absorb rather than push back on:

- AC-18, AC-22 and the "check reports success to branch protection" clause are observable
  only in a real GitHub Actions run. They are testable **as properties of the generated
  text** (job-level `if:` on the fork condition, `if: always()` on the upload step), which
  is what §10 pins. The spec itself cuts a browser fixture (`:70`), so no e2e lane applies.
- AC-9's "payload stays under 1 MB" is testable as "the runner entry's `contents` is empty",
  which is the mechanism; the byte assertion is a consequence.
- AC-19's "the studio's logs of the export contain none either" is testable only as a
  negative — the feature never reads a model key at all, so there is nothing to leak. The
  task card states this as a structural property (no `SecretsProvider` call on the CI path).

No issues found with AC-1, AC-3, AC-5, AC-6, AC-8, AC-10, AC-11, AC-13, AC-14, AC-16,
AC-17, AC-20, AC-21, AC-23, AC-24, AC-25, AC-26, AC-27, AC-28, AC-29, AC-31, AC-33, AC-34,
AC-35, AC-36, AC-38, AC-39, AC-41, AC-42, AC-44, AC-45, AC-46, AC-47, AC-48.

---

## 4. Open Questions

All **non-blocking**. Each names the assumption the plan proceeds on.

**OQ-1 [non-blocking] — Are the two new GitHub port methods mirrored to the client copy of
`adapters.ts`?**
Root `INSIGHTS.md:108` says a new port method is a two-file edit. But the client copy
(`client/src/vendor/shared/adapters.ts:122-138`) *already* omits `commitFiles` and
`findOpenPr`, which the server copy has at `:161`/`:163` — the client never runs GitHub
write ops. The new Actions methods belong to that same server-only cluster, and the spec
states this feature needs exactly one mirrored edit (`:548-550`).
**Assumption:** do **not** mirror. Add both methods to the server copy only, with an
explicit comment naming the asymmetry as deliberate — modelled on the existing note at
`client/src/vendor/shared/contracts/eval-ci.ts:447`. This is named here because root
`INSIGHTS.md:289` records that a fleet will invent a convention if the plan does not.

**OQ-2 [non-blocking] — What does the server do with `action: 'files'`?**
The contract admits it; the spec cuts the zip path to a disabled "coming soon" card.
**Assumption:** the service rejects `action !== 'open_pr'` with a 400 (same class as AC-2's
non-GHA target rejection); the Target step renders the card disabled. No contract narrowing
(that would be a second mirrored edit).

**OQ-3 [non-blocking] — Should the wizard warn when the agent's provider is not
`openrouter`?**
The manifest carries `provider` per AC-7, the runner ignores it and always calls OpenRouter
per AC-19.
**Assumption:** emit the stored provider verbatim (AC-7 as written); build no warning. The
divergence is recorded here so it is a known limitation rather than a bug report later.

**OQ-4 [non-blocking] — Is `runs.autoRefresh` in scope for AC-49's deletion?**
AC-49 names `publishDialog`, the older `ciTab` wording and the GitHub-App claim. It does not
name `autoRefresh`, but rendering it would assert behaviour AC-32 forbids.
**Assumption:** delete it under AC-49's "exactly one vocabulary" clause. The spec's Open
questions explicitly keep the unused `runs.filters.*` strings, so this plan keeps those.

**OQ-5 [non-blocking] — Which column vocabulary wins for the CI Runs table?**
AC-40 lists eight values; the scaffold declares six, three of AC-40's absent.
**Assumption:** AC-40 is authoritative. Add `runs.table.repository`, `runs.table.agent`,
`runs.table.duration`; keep the existing `timestamp` and `source` keys (harmless, and
`timestamp` renders the "ran at" value AC-43 also needs).

**OQ-6 [non-blocking] — Is AC-12's 64 KB a byte limit or a character limit?**
**Assumption:** bytes. Enforced as `Buffer.byteLength(workflow, 'utf8') > 65536` in the
service, with a contract-level `.max(65536)` as a cheap first gate. A 63 KB ASCII override
is accepted and a 65 KB one rejected either way, so the AC's own observable passes under
both readings.

**OQ-7 [non-blocking] — Should "Update CI config" be rate limited?**
AC-47 names only export and refresh, but AC-30 writes to GitHub.
**Assumption:** apply the export limit (10/min per workspace) to the update endpoint too.
This cannot violate AC-47, which sets ceilings rather than floors.

**OQ-8 [non-blocking] — Should `ci_runs.ci_installation_id` become NOT NULL to enforce
AC-38 in the schema?**
The column is nullable (`server/src/db/schema/ci.ts:16-18`), the contract declares it
nullable (`eval-ci.ts:438`), and the Rollout section authorises only additive columns.
**Assumption:** keep it nullable; enforce non-null in the ingest path and pin it with an
it-test assertion ("every row in storage has a non-null installation reference", AC-38's own
observable). See Recommendation R3.

---

## 5. Recommendations

Advisory. **None of these is assumed by the plan in §8** unless explicitly stated.

**R1 — `commitFiles` must create blobs, not inline content in the tree.**
*What:* `OctokitGitHubClient.commitFiles` (`server/src/adapters/github/octokit.ts:264-327`)
passes every file's full text as inline `content` inside a single `git.createTree` call
(`:290-297`), even though the port's own doc comment promises "blobs → tree → commit → ref"
(`server/src/vendor/shared/adapters.ts:157`). The runner bundle is a multi-megabyte `ncc`
output, so the first real export sends a multi-MB JSON body to `createTree`.
*Why better:* the spec's own Assumption speaks of "GitHub's **blob-creation** limits"
(`:91-93`), i.e. it presumes the blob path. `commitFiles`/`findOpenPr` have **zero callers
today** (verified by grep across `server/`, `client/`, `mcp-server/`), so the regression
surface is nil.
*Cost:* ~40 lines in one adapter method, plus a mock update.
*Adopted?* **Partly, and deliberately.** The plan does not treat this as new scope: AC-24
requires the commit to succeed with the real bundle, so A2's acceptance criteria state that
outcome and name blob-first as the expected mechanism. Flagged here because a human may
prefer to ship as-is and observe the failure instead.

**R2 — Add a unique index on `ci_runs (ci_installation_id, github_url)` and use
`onConflictDoUpdate` for AC-34.**
*Why better:* AC-34's "keyed by (installation, workflow-run URL)" is enforced in application
code under this plan, so two concurrent refreshes can both miss and both insert.
*Cost:* one index in migration 0017; note `server/INSIGHTS.md:34` only bites on *partial*
indexes built with `eq()`, which this is not.
*Adopted?* **No** — the spec's Rollout section authorises additive nullable columns only.
Mitigated by AC-47's 6/min refresh limit.

**R3 — Make `ci_runs.ci_installation_id` NOT NULL.**
*Why better:* turns AC-38's "never create a run record that is not attached to an
installation" into a database invariant instead of a code convention.
*Cost:* a non-additive migration plus a mirrored contract narrowing (`CiRun.ci_installation_id`
is `.nullable()` in both copies) — i.e. a second two-file edit the spec says is not needed.
*Adopted?* **No.** See OQ-8.

**R4 — Build the runner bundle in `scripts/dev.sh`.**
*Why better:* `agent-runner/dist/` does not exist in this worktree and is not in git
(verified: `ls agent-runner/dist` fails, `git ls-files agent-runner/dist` is empty), even
though root `.gitignore:3-6` force-includes it with the comment "its bundled dist/ MUST be
committed". So **AC-8's failure path is today's default developer experience**, and a
first-time user of the wizard hits an error rather than the feature.
*Cost:* one line in `scripts/dev.sh`, plus ~2 s of `ncc` on boot.
*Adopted?* **No** — `scripts/` is outside the spec's declared module list (`:499-502`). Raised
because the dev loop otherwise looks broken.

**R5 — A smaller first slice.**
*What:* land AC-1 … AC-31 (wizard, generation, install, update) first, and AC-32 … AC-40
(refresh + CI Runs page) as a second change.
*Why better:* refresh is the half that depends on two brand-new GitHub port methods and on
hostile-archive handling; the export half is self-contained and delivers S1–S5 alone.
*Cost:* two review cycles instead of one; the CI Runs page ships its empty state either way,
so nothing looks broken in between.
*Adopted?* **No** — the plan implements the whole spec as specified.

**R6 — Run the cross-model plan review before the fleet spends a wave.**
Root `INSIGHTS.md:279` records that a skeptical non-Anthropic pass over a finished plan
returned four findings and **all four were real**, on a feature of comparable size. This plan
has 49 ACs, two registries with no build-time guard, and a dual-vendored edit. *Adopted?*
Not a code change — an orchestration suggestion.

---

## 6. Relevant Insights

Top three, chosen for how directly they change this plan's decomposition:

1. **`INSIGHTS.md:25` — "A required GitHub check must NOT carry a `paths:` filter on `on:` —
   a non-matching PR then sits on 'Expected' forever and can never merge."** This repo already
   paid for that lesson in its own `.github/workflows/evals.yml`, and the entry names the exact
   workaround the generated workflow must use: unconditional `pull_request`, filtering moved
   into a job-level `if:`, because "a *skipped* job counts as SUCCESS for branch protection,
   whereas a workflow that never triggered counts as pending." AC-15 and AC-18 are the same rule
   applied to a workflow we generate for someone else's repo — and AC-18's job-skip mechanism
   *depends* on AC-15's no-filter rule to keep the check reportable. Task **A1** owns both, and
   must not "optimise" the trigger with a path filter.

2. **`INSIGHTS.md:37` + `:186` — the two vendored `eval-ci.ts` copies ship already drifted,
   `AgentManifest` is deliberately server-only, and a whole-file `diff -r` is red on a clean
   tree today.** The mirrored edit in **I1** must therefore be verified by diffing only the
   **added** lines (`git diff <file> | grep '^+'` on each side), never by comparing the files.
   The entry also warns that the obvious repair — copying one file over the other — hands the
   client a schema it has no business importing. `AgentManifest` stays server-only; AC-20's
   `post_as` travels as a workflow env var precisely so this stays true.

3. **`INSIGHTS.md:210` and `:216` — the orchestrator does the dual-vendored contract edit, the
   DB migration, the adapter port change and all fixture fallout INLINE, then fans out only the
   disjoint module work.** Confirmed twice on cross-module features of this size. `:291` adds
   the cost rule ("a ~30-line mechanical edit does not need an agent"), and `:142` adds the
   shape ("split by PACKAGE SIDE … `server/**` and `client/**` are fully disjoint file sets").
   §8 is built on exactly this: six inline items, then four agents on disjoint trees.

Secondary landmines each task card must carry:

- `server/INSIGHTS.md:267` — the tree-boundary path guards constrain *where* but not *which*
  file; a caller-supplied path reaching a file helper is an RCE sink. AC-11's answer is that no
  client-supplied path is ever accepted at all — **A2** enforces this server-side, not just in
  the wizard.
- `client/INSIGHTS.md:165` and `:167` — two client registries with no auto-sync and no build-time
  guard: the agent editor's `TABS` (`.../AgentEditor/constants.ts:12-17`, with `VALID_TABS`
  derived via `TABS.map` at `agents/[id]/page.tsx:18`, so only `TABS` needs the entry) and the
  sidebar data registry `client/src/vendor/ui/nav.ts:21-39`. `activeKeyFor`
  (`client/src/components/app-shell/helpers.ts:41`) **already** maps `/ci-runs`, and
  `client/messages/en/shell.json:28` already has the label — only the `NAV` entry is missing.
  A "new files only" task list would mention neither: **A3** and **A4** name them.
- Root `INSIGHTS.md:27` — the live prompt-injection hole where PR title/author land outside the
  `wrapUntrusted` fence. AC-48 forbids reproducing it on the CI path; the runner already fences
  correctly, so **A1**'s obligation is negative: emit no manifest key and no workflow input that
  could weaken grounding or fencing.
- Root `INSIGHTS.md:75` — a family of `.it.test.ts` files flakes together under load. A2 adds two
  new it-test files, increasing that load. A2 must isolate a failure (re-run the single file)
  before attributing it to its own diff.
- `server/INSIGHTS.md:126` — a hand-written migration is invisible unless `meta/_journal.json`
  gets a hand-appended entry. `server/INSIGHTS.md:36` — `drizzle-kit generate` cannot be driven
  by piping. **I2** hand-writes both.
- `server/INSIGHTS.md:56` — `pnpm typecheck` is whole-project, so a sibling agent's in-progress
  errors appear in your output. Each server task greps tsc output for its own filenames; §10
  names who runs the authoritative final typecheck.
- `server/INSIGHTS.md:64` — a cross-workspace 404 it-test cannot be driven by a request header;
  `LocalNoAuthProvider.currentWorkspace()` always resolves the seeded default workspace. The
  working pattern is to insert a second workspace row and create the agent under it
  (`server/test/agents-versions.it.test.ts:154-177`). **A2** needs this for AC-46.
- Root `CLAUDE.md` — never `docker compose down -v`; it wipes `devdigest_pgdata`.

---

## 7. Architecture Changes

### 7.1 `@devdigest/shared` (dual-vendored) — one mirrored edit only

`CiExportInput` gains **one** optional field:

- `server/src/vendor/shared/contracts/eval-ci.ts:401-410`
- `client/src/vendor/shared/contracts/eval-ci.ts:370-379`

`workflow: z.string().max(65536).optional()` — the user-edited workflow **text**, applied at
the server-chosen path. The docstring must state that no client-supplied path is ever
accepted (AC-11) and that the byte-accurate size check lives in the service (AC-12, OQ-6).

Nothing else in `contracts/` changes. Preview reuses `CiFile` (`:364-369`, present in both
copies). `AgentManifest` (`:379-396`) stays server-only. `CiRun.agent` and `CiRun.duration_s`
(`:446-447`) already exist in both copies — the gap is in the **table**, not the contract.
Both barrels already re-export `eval-ci.js` (`server/src/vendor/shared/index.ts:25`,
`client/src/vendor/shared/index.ts:25`), so no barrel edit.

### 7.2 Ports — `server/src/vendor/shared/adapters.ts` (server copy only, see OQ-1)

Two methods appended to `GitHubClient` after `:163`:

- `listWorkflowRuns(repo, workflowFile, limit)` → `CiWorkflowRunRef[]`, where
  `CiWorkflowRunRef = { id: number; htmlUrl: string; status: string; conclusion: string | null; prNumber: number | null; createdAt: string }`.
  Backed by `GET /repos/{o}/{r}/actions/workflows/{file}/runs?per_page=<limit>` (AC-32's
  bound is a parameter, not a client concern).
- `downloadRunResultArtifact(repo, runId, artifactName, entryName)` → `string | null` — the
  single entry's text, or `null` when the artifact is absent, oversized or unreadable
  (AC-35, AC-36). Returning `null` rather than throwing is what makes AC-35's "treat as
  absent" the default.

A comment records that these — like `commitFiles`/`findOpenPr` — are deliberately not
mirrored to `client/src/vendor/shared/adapters.ts:122-138`.

### 7.3 `server/src/db/schema/ci.ts` + migration `0017`

`ci_runs` (`server/src/db/schema/ci.ts:14-26`) gains two nullable columns matching the
contract fields that already exist:

- `agent: text('agent')`
- `durationS: doublePrecision('duration_s')`

`ci_installations` is unchanged. Migration `0017_ci_runs_agent_duration.sql` is hand-written
(two `ALTER TABLE … ADD COLUMN`) with a hand-appended `meta/_journal.json` entry
(`server/INSIGHTS.md:126`). No index (R2). Next free index is 17 — `0016` is the highest
existing migration.

### 7.4 `server/src/modules/ci/` (new module, onion layering)

| File | Layer | Responsibility |
|---|---|---|
| `constants.ts` | domain-adjacent, pure | Every fixed path and name the runner and the workflow must agree on: `.devdigest/agents/`, `.devdigest/skills/`, `.devdigest/memory.jsonl`, `.devdigest/runner/index.js`, `.github/workflows/devdigest-review.yml`, the workflow file basename, the artifact name, `devdigest-result.json`, `devdigest/ci`, the PR title, the allowed trigger set, the 5 MB / 64 KB / 20-run bounds. **Named by `agent-runner/src/index.ts:5`, which already points at this file.** |
| `manifest.ts` | pure | `renderManifest(agent, skillSlugs)` → deterministic YAML (AC-7, AC-13) |
| `workflow.ts` | pure | `renderWorkflow(input)` → the Actions YAML (AC-14 … AC-22) |
| `bundle.ts` | pure | `buildBundle(agent, skills, runnerSource, input)` → ordered `CiFile[]` (AC-6, AC-9's `editable` flags); `toPreview(files)` blanks the runner entry's contents (AC-9) |
| `runner-bundle.ts` | infrastructure | Reads the prebuilt bundle **directory** (`config.ciRunnerDir`, default `../agent-runner/dist`) and returns EVERY file in it as `{ name, contents }[]`; throws a `ConfigError` naming the artifact and `cd agent-runner && pnpm build` when the directory is absent or empty (AC-8). **Never allowlist file names** — ncc's chunk names are not stable across dependency changes, so a hardcoded list silently ships a broken runner after a future build (AC-6a). Injected via the container so tests can stub it — no `fs` in the service |
| `repository.ts` | application | Drizzle reads/writes for `ci_installations` and `ci_runs`, always workspace-scoped through the `agents` join. **Returns `undefined`/outcome objects — never imports `platform/errors`** (matching every other repository in this codebase; root `INSIGHTS.md:289`) |
| `service.ts` | application | Validation (AC-4, AC-11, AC-12, AC-23, OQ-2), preview (AC-5), export/install (AC-24 … AC-28), update-config (AC-30, AC-31), tenancy (AC-46) |
| `ingest.ts` | application | Refresh: per-installation listing, artifact download, status derivation, upsert, partial-failure collection (AC-32 … AC-38) |
| `routes.ts` | infrastructure | Zod-typed Fastify plugin; per-route `config.rateLimit` (AC-47); zero business logic |

Registered with one import + one entry in `server/src/modules/index.ts:31-47` (the file's own
comment at `:22-29` documents this), auto-registered by `server/src/app.ts:172-174`.
Dependencies come from `app.container` (decorated at `server/src/app.ts:68-69`), following
`server/src/modules/agents/routes.ts:81-83`.

**Routes** (named here so the fleet does not invent them):

| Method + path | Response | Rate limit | ACs |
|---|---|---|---|
| `POST /agents/:id/ci/preview` | `CiFile[]` | default | AC-5, AC-6, AC-8, AC-9, AC-13 |
| `POST /agents/:id/export-ci` | `CiExport` | 10/min | AC-10 … AC-12, AC-24 … AC-28 |
| `GET /agents/:id/ci/installations` | `Array<CiInstallation & { last_run: CiRun \| null }>` | default | AC-43 |
| `POST /ci/installations/:id/update-config` | `{ pr_url: string \| null; files: CiFile[] }` | 10/min (OQ-7) | AC-30, AC-31 |
| `GET /ci/runs` | `CiRun[]` | default | AC-38, AC-39, AC-40 |
| `POST /ci/runs/refresh` | `{ runs: CiRun[]; failed: Array<{ repo: string; message: string }> }` | 6/min | AC-32 … AC-37 |

`POST /agents/:id/export-ci` is the path the contract's own docstring already names
(`eval-ci.ts:400`). The two composed response shapes (`installations`, `refresh`) are
assembled from already-vendored schemas at the route — the same "no new contract for a
strictly-smaller need" reasoning the spec applies to Preview (`:552-555`).

### 7.5 DI + config

- `server/src/platform/config.ts` — `EnvSchema` (`:15-40`) gains optional
  `DEVDIGEST_CI_RUNNER_DIR`, resolved exactly like `cloneDir` (`:69-71`:
  `isAbsolute(x) ? x : resolve(process.cwd(), x)`), defaulting to
  `../agent-runner/dist` (a DIRECTORY — every file in it ships, AC-6a). No secret goes here — `config.ts:9-13` is explicit that
  secrets belong to `SecretsProvider`, and **this feature reads no model key at all** (AC-19).
- `server/src/platform/container.ts` — a lazy `ciRepo` getter beside the existing
  `agentsRepo`/`reviewRepo` pattern (`:95-101`), and a `runnerBundle` reader registered like
  `auth` (`:84`) so `ContainerOverrides` (`:40-54`) can stub it. The GitHub client already
  arrives through `container.github()` (`:153-160`).

### 7.6 `client/` surfaces

| File | Change |
|---|---|
| `client/src/vendor/ui/nav.ts:21-39` | New third `NavGroup` `{ section: "GLOBAL", items: [{ key: "ci-runs", label: "CI Runs", icon: <IconName>, href: "/ci-runs" }] }`. Section headings render as literals (`vendor/ui/shell/Sidebar.tsx:56`), matching `"WORKSPACE"`/`"SKILLS LAB"`; the i18n label already exists at `client/messages/en/shell.json:28`; `activeKeyFor` already maps the path (`components/app-shell/helpers.ts:41`) |
| `client/src/vendor/ui/nav.test.ts` | AC-41 assertion, mirroring the existing AC-19 test |
| `client/src/app/ci-runs/` | New route: thin `page.tsx` + `_components/CiRunsTable/` + `_lib/columns.ts` |
| `client/src/lib/hooks/ci-runs.ts` | `useCiRuns()` (key `["ci-runs"]`), `useRefreshCiRuns()` (invalidates `["ci-runs"]`). **No `refetchInterval`** — AC-32 forbids ingestion at any other time |
| `client/src/lib/hooks/ci-export.ts` | `useCiPreview()`, `useExportToCi()`, `useCiInstallations(agentId)` (key `["ci-installations", agentId]`), `useUpdateCiConfig()` |
| `.../AgentEditor/constants.ts:12-17` | `TABS` gains `{ key: "ci", labelKey: "editor.tabs.ci", icon: … }` **after** `evals` (AC-42). `VALID_TABS` derives automatically (`agents/[id]/page.tsx:18`), so deep-linking `?tab=ci` works for free. `client/messages/en/agents.json:52` already has the label |
| `.../AgentEditor/AgentEditor.tsx:26-34` | One more branch in the tab dispatch chain |
| `.../AgentEditor/_components/CiTab/` | New: header (heading, "Add to CI", "Fail CI on"), installation rows, `ExportWizard/` with four step components |
| `client/src/features/ci/components/CiRunStatusPill.tsx` | New shared presentational pill — **two** consumers (CI Runs table, CI tab rows), so it is lifted per the co-location rule. Renders a text label from `ci.runs.status.*`, never colour alone (accessibility NFR) |
| `client/messages/en/ci.json` | AC-49 rewrite — see I5 |

`ci_fail_on` needs **no new client plumbing**: `UpdateAgentBody`
(`server/src/modules/agents/routes.ts:64`) and `UpdateAgentInput`
(`client/src/lib/hooks/agents.ts:53`) both already carry it, so AC-29 is a call to the
existing `useUpdateAgent` mutation.

### 7.7 Explicitly unchanged

`agent-runner/`, `reviewer-core/`, `e2e/`, the reviews/multi-run services, the PR feed,
`server/src/db/seed.ts`, and every `specs/**` file. The spec's Non-goals list (`:44-70`) is
the checklist; nothing in §8 crosses it.

---

## 8. Parallelizable Tasks

**Owner column:** `inline` = orchestrator does it, does **not** count against the fleet cap.
`agent` = an `implementer` spawn, counts. Total agents: **4** (cap 5; the spare slot is
reserved for the review fix-loop).

### 8.1 Orchestrator-inline (6 items, 0 agents)

| Task | Module | Files owned | Skills to apply | Acceptance criteria | Tests to run | Depends-on | Batch |
|---|---|---|---|---|---|---|---|
| **I1** — workflow-override contract field **[shared: two-file edit]** | shared | `server/src/vendor/shared/contracts/eval-ci.ts:401-410`; `client/src/vendor/shared/contracts/eval-ci.ts:370-379` | `zod`, `typescript-expert`, `security` | `CiExportInput` gains `workflow: z.string().max(65536).optional()` in **both** copies, with identical added lines and a docstring stating "text only; the path is server-chosen; no client-supplied path is ever accepted" (AC-10, AC-11) and pointing at the byte-accurate check in the service (AC-12). `AgentManifest` is **not** added to the client copy. Verified per root `INSIGHTS.md:186` by comparing only the **added** lines on each side — never a whole-file `diff` | `cd server && pnpm typecheck`; `cd client && pnpm typecheck` | — | — |
| **I2** — `ci_runs` columns + migration `0017` | server | `server/src/db/schema/ci.ts:14-26`; new `server/src/db/migrations/0017_ci_runs_agent_duration.sql`; `server/src/db/migrations/meta/_journal.json` | `drizzle-orm-patterns`, `postgresql-table-design` | Two nullable columns added (`agent text`, `duration_s double precision`); `ci_installations` untouched; migration hand-written (**do not** run `drizzle-kit generate` — `server/INSIGHTS.md:36`) with a hand-appended journal entry `{ "idx": 17, "version": "7", "when": <ms>, "tag": "0017_ci_runs_agent_duration", "breakpoints": true }` (`server/INSIGHTS.md:126`); no index (R2); `pnpm db:migrate` applies cleanly on a DB already at 0016 | `cd server && pnpm db:migrate`; `cd server && pnpm typecheck` | — | — |
| **I3** — GitHub Actions port: interface, octokit impl, mocks | server | `server/src/vendor/shared/adapters.ts` (append after `:163`); `server/src/adapters/github/octokit.ts`; `server/src/adapters/mocks.ts:131-235` | `onion-architecture`, `typescript-expert` | `listWorkflowRuns` and `downloadRunResultArtifact` declared on `GitHubClient` with the shapes in §7.2, plus a comment naming the server-only asymmetry as deliberate (OQ-1) — modelled on `client/src/vendor/shared/contracts/eval-ci.ts:447`. `client/src/vendor/shared/adapters.ts` is **not** edited. `MockGitHubClient` implements both against public, test-settable arrays (`workflowRuns`, `artifacts`) so A2's it-tests can drive them. **Whole tree still typechecks after this edit** — this is the fixture-fallout step. **I3 owns `server/src/adapters/mocks.ts` outright and leaves it FINISHED — no later task edits it.** The mocks must therefore be complete enough to drive every branch A2's it-tests need, not placeholder stubs: settable `workflowRuns` / `artifacts` arrays, a per-call write log so AC-5 and AC-11 can assert *zero* writes, an artifact entry that can be made absent / oversized / corrupt (AC-35, AC-36), and a `commitFiles` recorder that captures the committed path list (AC-24, AC-30) and the REST-call shape (A2 #10). Cross-model review flagged the original split ownership of this file; it is resolved here by scope, not by sequencing. **`octokit.ts` moved into I3 for the same reason PLUS an ordering defect the plan originally carried: declaring the two methods on `GitHubClient` while leaving the implementation to A2 would have left the whole server tree failing `tsc` for the entire first wave, contradicting this task's own "whole tree still typechecks" criterion. I3 therefore implements `listWorkflowRuns` + `downloadRunResultArtifact` (size ceiling + read-one-entry-in-memory, AC-36) and lands the blob-first `commitFiles` change (R1) here** | `cd server && pnpm typecheck`; `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | — | — |
| **I4** — add `yaml` to server deps | server | `server/package.json` (dependencies); `server/pnpm-lock.yaml` | — | `cd server && pnpm add yaml` (the version family `agent-runner` already depends on, so the studio emits YAML with the same library the runner parses with — the cheapest guarantee for AC-7 and AC-13). No other dependency added; `adm-zip@^0.5.16` + `@types/adm-zip` are **already** present (`server/package.json:26,47`) so AC-36 needs no new package | `cd server && pnpm typecheck` | — | — |
| **I5** — CI message catalogue (AC-49) + shared status pill | client | `client/messages/en/ci.json` (whole file); new `client/src/features/ci/components/CiRunStatusPill.tsx` + `CiRunStatusPill.test.tsx` | `frontend-architecture`, `react-testing-library` | **Delete:** the whole `publishDialog` block (`:87-102`); `exportWizard.blockMergeDesc` (`:71`, the "Requires a GitHub App" claim, AC-45+AC-49); `ciTab.publish` (`:81`) and the "Publish to CI" wording inside `ciTab.empty` (`:84`); `runs.autoRefresh` (`:7`, OQ-4). **Keep:** `runs.filters.*` unused, per the spec's own Open questions (`:692-693`). **Add:** `runs.table.{repository,agent,duration}` (AC-40 needs 8 values, the scaffold declares 6 — OQ-5); `ciTab.{addToCi,updateConfig,activeInRepos,noRunsYet,failOnLabel}` + `ciTab.failOn.{never,critical,warning,any}` (AC-1, AC-29, AC-30, AC-43); `exportWizard.{comingSoon,repoInvalid,triggersRequired,runnerMissing,runnerPlaceholder,baseLabel,viewPr}`, `exportWizard.triggers.{opened,synchronize,reopened}`, a `exportWizard.secrets.*` block (AC-44: model key = user-supplied, `GITHUB_TOKEN` = provided by Actions, **no** status pill wording) and a `exportWizard.blocking.*` callout (AC-45: "Fail CI on" + a required check in branch protection; must **not** mention a GitHub App). No literal user-visible string is left for a component to hardcode (i18n NFR). The pill renders a **text** label from `ci.runs.status.*` (never colour alone) and handles the `null`/"no runs yet" case. Only `en` exists (`client/INSIGHTS.md:123`), so this is a single-file catalogue edit | `cd client && pnpm test`; `cd client && pnpm typecheck` | — | — |
| **I6** — dev-loop precondition (no code change) | — | — | — | Before any manual smoke test of preview/export, run `cd agent-runner && pnpm install && pnpm build` to populate `agent-runner/dist/` (measured 2026-07-21: `index.js` ~1.5 MB, `package.json` declaring the module type, and a ~6 kB lazy chunk — all three ship, AC-6a). It did **not** exist in this worktree and is not in git, so AC-8's failure path is the current default (R4). Automated tests must **not** depend on it — they inject a fake runner-bundle reader through `ContainerOverrides` | — | — | — |

**I1 … I5 must all land before the fan-out.** They are the shared, collision-prone surface;
no agent may edit any file listed above.

### 8.2 Agent tasks (4 of 5 slots used)

| Task | Module | Files owned (with anchors) | Skills to apply | Acceptance criteria | Tests to run | Depends-on | Batch |
|---|---|---|---|---|---|---|---|
| **A1** — CI generation core (pure) · **agent · sonnet** — the output is exactly specified by nine ACs with literal, byte-level observables, so a bad output is caught by its own unit tests rather than compounding silently | server | **NEW** `server/src/modules/ci/constants.ts`, `manifest.ts`, `workflow.ts`, `bundle.ts`, `ci-generate.test.ts` (colocated unit test — `server/vitest.config.ts:14` includes `src/**/*.test.ts`) | `onion-architecture`, `zod`, `security`, `typescript-expert` | See §8.3 | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (`TESTING.md:67`); `cd server && pnpm typecheck` (grep the output for **your own filenames only** — `server/INSIGHTS.md:56`) | I4 | — |
| **A2** — CI service, ingest, routes, adapters, wiring · **agent · opus** — cross-cutting tenancy, rate limiting, hostile-archive handling, idempotency and an external API seam; a defect here compounds into every export and every ingested row | server | **NEW** `server/src/modules/ci/repository.ts`, `service.ts`, `ingest.ts`, `runner-bundle.ts`, `routes.ts`; **NEW** `server/test/ci-export.it.test.ts`, `server/test/ci-ingest.it.test.ts`; **`server/src/adapters/github/octokit.ts` and `server/src/adapters/mocks.ts` are NOT yours — I3 leaves BOTH finished (the two Actions methods are implemented, and `commitFiles` is already blob-first). If either lacks a hook your test needs, report that rather than editing it**; **EDIT** `server/src/platform/container.ts` (lazy `ciRepo` getter beside `:95-101`; runner-bundle reader beside `:84`, overridable via `ContainerOverrides` `:40-54`); **EDIT** `server/src/platform/config.ts` (`DEVDIGEST_CI_RUNNER_DIR` in `EnvSchema` `:15-40`, resolved like `cloneDir` `:69-71`; it names a DIRECTORY, and `runner-bundle.ts` returns every file in it — AC-6a); **EDIT** `server/src/modules/index.ts:31-47` (one import + one entry) | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security`, `typescript-expert` | See §8.3 | `cd server && pnpm exec vitest run .it.test` (`TESTING.md:68`, needs Docker) **and** the unit lane **and** `cd server && pnpm typecheck` — A2 runs the **authoritative final server typecheck** | **A1** (imports `constants.ts`, `manifest.ts`, `workflow.ts`, `bundle.ts`), I1, I2, I3, I4 | — |
| **A3** — CI Runs page + sidebar nav · **agent · sonnet** — table rendering and one registry entry against an already-fixed contract | client | **NEW** `client/src/app/ci-runs/page.tsx`, `client/src/app/ci-runs/_components/CiRunsTable/CiRunsTable.tsx` + `.test.tsx`, `client/src/app/ci-runs/_lib/columns.ts`; **NEW** `client/src/lib/hooks/ci-runs.ts`; **EDIT** `client/src/vendor/ui/nav.ts:21-39`; **EDIT** `client/src/vendor/ui/nav.test.ts` | `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `typescript-expert` | See §8.3 | `cd client && pnpm test` (`TESTING.md:63`); `cd client && pnpm typecheck` | I5 | — |
| **A4** — Export wizard + agent CI tab · **agent · sonnet** — the largest UI surface, but every step's content is enumerated by an AC and the primitives (`Modal`, `ExportWizardSteps`) already exist | client | **NEW** `client/src/app/agents/[id]/_components/AgentEditor/_components/CiTab/CiTab.tsx` + `.test.tsx`, `.../CiTab/InstallationRow.tsx`, `.../CiTab/ExportWizard/ExportWizard.tsx` + `.test.tsx`, `.../ExportWizard/{TargetStep,PreviewStep,ConfigureStep,InstallStep}.tsx`, `.../ExportWizard/wizard.helpers.ts`; **NEW** `client/src/lib/hooks/ci-export.ts`; **EDIT** `client/src/app/agents/[id]/_components/AgentEditor/constants.ts:12-17`; **EDIT** `client/src/app/agents/[id]/_components/AgentEditor/AgentEditor.tsx:26-34` | `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library`, `security`, `typescript-expert` | See §8.3 | `cd client && pnpm test`; `cd client && pnpm typecheck` | I5 | — |

**Batches.** All four cells are blank, deliberately. A1→A2 is a hard import edge, so they
cannot fuse. A3 and A4 share a module but their combined scope is large (a full route plus a
four-step wizard), which fails the "small combined scope" test for fusion; they run as two
parallel spawns instead.

**Wave shape.** Wave 0 = I1 … I5 inline. Wave 1 = **A1 ‖ A3 ‖ A4** (three disjoint trees).
Wave 2 = **A2** alone. Then the read-only review wave (`plan-verifier` +
`architecture-reviewer`), whose fix-loop may use the reserved 5th slot.

**Dependency edges re-derived from actual imports, not narrative order** (root
`INSIGHTS.md:279`):

- `A2 → A1`: `service.ts`/`ingest.ts` import `constants.ts` (paths, bounds, workflow file
  name), `bundle.ts` (`buildBundle`, `toPreview`), `manifest.ts`, `workflow.ts`. **Real.**
- `A2 → I3`: `octokit.ts` implements interface members declared in `adapters.ts`. **Real.**
- `A2 → I1`: `service.ts` reads `input.workflow`. **Real.**
- `A2 → I2`: `repository.ts` writes `ciRuns.agent`/`ciRuns.durationS`. **Real.**
- `A1 → I4`: `manifest.ts` imports `stringify` from `yaml`. **Real.**
- `A3 → I5`, `A4 → I5`: both import `CiRunStatusPill` and read `ci.*` message keys. **Real.**
- `A3 → A2` and `A4 → A2`: **none.** Both consume already-vendored contract types via
  `api.get`/`api.post`; no client file imports a server file. The client can be built and
  tested against mocked `fetch` (`client/CLAUDE.md`: "fetch mocked, no API needed") before
  the server exists.
- `A4 → A3`: **none**, after `CiRunStatusPill` was moved to I5. Had the pill stayed with A3
  this edge would have serialised the whole client side — the reason it is inline.
- `A1 → I1/I2/I3`: **none.** A1 imports `AgentManifest` and `CiFile`, which already exist
  unchanged; it touches no DB and no port.

### 8.3 Task acceptance criteria (self-contained cards)

Every requirement from §2 that touches a task's files appears here, not only in §9.

**A1 — CI generation core**

1. **AC-6 / AC-6a** — `buildBundle` returns exactly, in a stable order:
   `.devdigest/agents/<agent-slug>.yaml`, one `.devdigest/skills/<skill-slug>.md` per
   **enabled** linked skill, an **empty** `.devdigest/memory.jsonl`,
   `.github/workflows/devdigest-review.yml`, and **one entry per file the runner build
   emitted**, each at `.devdigest/runner/<name>`. No other path. An agent with two enabled
   skills and a three-file runner build yields 7 files; an agent with zero enabled skills
   yields 5 (spec edge case, `:358`).

   The runner arrives as a `{ name, contents }[]` **parameter** — `bundle.ts` stays pure and
   reads no filesystem. **Do not allowlist runner file names**: the build emits a
   `package.json` declaring the module type (without which the entrypoint dies with
   `SyntaxError: Cannot use import statement outside a module` in any target repo that does
   not opt into ES modules — verified by execution) plus at least one lazily-loaded chunk the
   entrypoint references only at runtime, and those chunk names change with dependencies.
   Assert against the runner entry COUNT you were handed, never a magic number. Skill file bodies are the **raw** skill text with no frontmatter — the runner
   reads the whole file as the body (`agent-runner/src/skills.ts:12-27`).
2. **AC-7** — the manifest carries `name`, `provider`, `model`, `system_prompt`, `skills`
   (enabled slugs, in link order), `strategy`, `ci_fail_on` from the stored agent, and
   `AgentManifest.parse()` (`server/src/vendor/shared/contracts/eval-ci.ts:379-396`) accepts
   the emitted YAML after a round-trip through the same `yaml` parser the runner uses
   (`agent-runner/src/manifest.ts:3,69`). A unit test performs that round-trip.
   `provider` is emitted verbatim even though the runner ignores it (OQ-3).
3. **AC-13** — two calls with identical inputs return byte-identical contents, **including
   manifest key order**. Achieved by building an explicitly ordered plain object and calling
   `yaml.stringify` — never by serialising a spread or a `Map` with incidental ordering. A
   unit test asserts `render(x) === render(x)` and pins the exact key sequence.
4. **AC-9** — `CiFile.editable` is `true` **only** on the workflow entry. Note the contract
   defaults it to `true` (`eval-ci.ts:367`), so every other entry must set it explicitly to
   `false`; forgetting one silently makes the runner bundle editable. `toPreview(files)`
   returns the same list with the runner entry's `contents` replaced by `''`.
5. **AC-14** — the workflow's only trigger is `pull_request`, with `types:` exactly the
   selected list. The generated text contains no `issue_comment`, `workflow_dispatch`,
   `push` or `schedule`.
6. **AC-15** — the generated text contains **none** of `paths`, `paths-ignore`, `branches`,
   `branches-ignore`, `tags`, `tags-ignore`. This is load-bearing, not stylistic: root
   `INSIGHTS.md:25` records that a required check with a `paths:` filter strands a
   non-matching PR on "Expected" forever. Do not add one as an optimisation.
7. **AC-16** — the string `pull_request_target` does not occur anywhere in the output.
8. **AC-17** — the `permissions:` block lists precisely `contents: read` and
   `pull-requests: write`, and nothing else.
9. **AC-18** — the review job carries a job-level `if:` comparing the PR head repo's full
   name to the workflow's repository, so a fork PR skips the job while the run is still
   created. Together with AC-15 this is what lets the check be marked required.
10. **AC-19** — the model credential appears only as a reference to the Actions secret named
    `OPENROUTER_API_KEY`. No generated file contains a key-shaped literal. This module
    reads no secret and calls no `SecretsProvider`.
11. **AC-20** — the "Post results as" choice is emitted as `DEVDIGEST_POST_AS` on the run
    step, with one of exactly `github_review` | `pr_comment` | `none`
    (`agent-runner/src/index.ts:25-28`). The manifest YAML has **no** `post_as` key, and
    `AgentManifest` is not extended.
12. **AC-21** — the run step executes `node .devdigest/runner/index.js`. The only `uses:`
    entries are first-party GitHub actions for checkout, Node setup and artifact upload. The
    string `devdigest/review-action` does not occur.
13. **AC-22** — the artifact-upload step carries `if: always()`, so the result file is
    uploaded even when the review step exits non-zero (the gate-triggered case).
14. **AC-48** — the manifest emits only keys `AgentManifest` defines, none of which affect
    grounding or fencing; the workflow passes no input that could disable the grounding gate
    or move PR title/body/diff outside the untrusted fence. Root `INSIGHTS.md:27` documents
    the studio-side hole this must not reproduce.
15. `constants.ts` is the single source for every fixed path, name and bound. No path literal
    is repeated in `manifest.ts`, `workflow.ts` or `bundle.ts`. `agent-runner/src/index.ts:5`
    already names this file — keep the name.
16. Layering: these four files import **only** `@devdigest/shared`, `yaml` and each other.
    No `fs`, no `process.env`, no Drizzle, no Fastify, no octokit. Runner bytes arrive as a
    parameter.
17. One unit test **per** workflow AC (AC-14 … AC-22), each asserting the literal observable
    the AC names — not a single snapshot test. A snapshot would go green on a regression that
    reintroduces `paths:`.

**A2 — CI service, ingest, routes, adapters, wiring**

1. **AC-4** — `repo` is validated to `owner/name` **before any GitHub call**, for both preview
   and export. `acme`, `acme/`, `https://github.com/acme/x` return a 4xx and produce no
   branch, no commit, no PR.
2. **AC-5** — the preview path performs no write of any kind: no `commitFiles`, no
   `openPullRequest`, no installation row. After a preview the target repo has no
   `devdigest/ci` branch. An it-test asserts the mock GitHub client recorded zero writes.
3. **AC-8** — `runner-bundle.ts` throws when the bundle is absent, with a message naming both
   `agent-runner/dist` and `cd agent-runner && pnpm build`. Preview **and** export
   both fail; nothing is committed, no PR opened, no installation persisted. The reader is
   injected via `ContainerOverrides` so tests drive both branches — it is absent in this
   worktree today, so the failing branch is the default and the happy path **must** stub it.
4. **AC-10** — when `input.workflow` is present it is committed **verbatim** at the fixed
   generated workflow path from `constants.ts`. The path never comes from the request.
5. **AC-11** — any request carrying a file path, or any content other than the single
   workflow override, is rejected with a 4xx and commits nothing. Enforced **server-side**,
   not only in the wizard: the request shape admits no path field, and the service builds
   every path from `constants.ts`. `server/INSIGHTS.md:267` records that the tree-boundary
   guards constrain where a path lands but not which file it names — the answer here is that
   no caller-supplied path is accepted at all. A test posts `.git/config` and `../../x`
   entries and asserts a 4xx plus zero mock writes.
6. **AC-12** — `Buffer.byteLength(workflow, 'utf8') > 65536` → 4xx, commit nothing. 63 KB
   accepted, 65 KB rejected (OQ-6).
7. **AC-23** — an empty `triggers` array is rejected with a 4xx; so is any value outside
   `opened` | `synchronize` | `reopened`. The contract types it as `z.array(z.string())`
   (`eval-ci.ts:407`), so this validation lives in the service — do **not** narrow the
   contract, which would be a second mirrored edit.
8. **OQ-2** — `action !== 'open_pr'` and `target !== 'gha'` are rejected with a 4xx before any
   GitHub call.
9. **AC-24** — install writes every generated file as **one** `commitFiles` call onto
   `devdigest/ci`, forked from the requested base, then opens a PR titled
   "Add DevDigest CI review". The base branch gains no commit.
10. **AC-24, mechanism — `commitFiles` creates a blob per file and references it by SHA.**
    Today it inlines every file's full text into a single `git.createTree` call
    (`server/src/adapters/github/octokit.ts:290-297`) despite its own port docstring promising
    "blobs → tree → commit → ref" (`server/src/vendor/shared/adapters.ts:157`). Align the
    implementation with that documented contract. It has **zero other callers** (verified
    across `server/`, `client/`, `mcp-server/`), so this changes no existing behaviour. See R1.

    **Assert the call shape, not the outcome.** The testable observable is: for an N-file
    payload the mock records N `createBlob` calls, and the subsequent `createTree` entries
    carry `sha` references with **no** `content` field. Do **not** write an acceptance test
    phrased as "the commit succeeds with a multi-megabyte bundle" — every test in this lane
    runs against `MockGitHubClient`, which accepts any size, so such a test asserts nothing
    while appearing to cover the risk. Surviving GitHub's real request limits is the *inferred
    benefit* of the blob path, verifiable only in a live export, not a CI assertion.
    (Cross-model review, finding 3.)
11. **AC-25** — an existing open PR whose head is `devdigest/ci` is reused via `findOpenPr`
    (`octokit.ts:332`); exporting twice yields one open PR with two commits and the same PR
    URL in both responses.
12. **AC-26** — a GitHub rejection (repo not found, or the credential cannot push) fails with
    a message naming the repository and the access it needs; no installation row is written
    and no partial success is reported.
13. **AC-27** — exactly one `ci_installations` row per (agent, repository); a re-export
    updates it rather than inserting a second.
14. **AC-28** — the export response carries the installation record, the committed file list
    and the PR URL.
15. **AC-30** — update-config commits **only** regenerated manifest and skill files onto that
    installation's `devdigest/ci`, reusing the open PR where one exists. The workflow file and
    the runner bundle are **not** in the payload, so their blobs are absent from the diff. A
    test asserts the committed path list is entirely under `.devdigest/agents/` and
    `.devdigest/skills/`.
16. **AC-31** — the endpoint addresses exactly one installation, identified by its own id. No
    fan-out and no multi-installation variant exists.
17. **AC-32** — refresh issues **one** bounded listing per installation in the caller's
    workspace, capped at 20 runs of the generated workflow file, and ingestion happens
    **nowhere else** — no timer, no hook, no read-path side effect.
18. **AC-33** — status is derived as: artifact present with ≥ 1 finding → `succeeded`;
    artifact present with 0 findings → `no_findings`; run completed with no readable artifact
    → `failed`; run not completed → `running`. **Never** from the workflow run's own
    conclusion. A test pins the gate-triggered case (conclusion `failure` + artifact with
    findings → `succeeded`) — that is the case the whole AC exists for.
19. **AC-34** — re-ingesting is an update keyed by (installation, workflow-run URL).
    Refreshing three times leaves the row count unchanged with the newest values in place.
20. **AC-35** — a missing, unreadable or non-validating artifact records `failed` with null
    findings, cost and duration, and **no field from the invalid payload is persisted**. Parse
    with `CiResultArtifact.safeParse` (`eval-ci.ts:455-465`) and on failure write nothing from
    it — not even `agent`. `duration_s` is derived from the artifact's `duration_ms`
    (`agent-runner/src/artifact.ts:32-54`); the contract field is seconds
    (`eval-ci.ts:447`), so convert, and leave it null when `duration_ms` is absent.
21. **AC-36** — the downloaded archive is rejected outright above 5 MB; below it, exactly one
    entry (`devdigest-result.json`) is read **in memory** via the already-present `adm-zip`
    (`server/package.json:26`); nothing is written to disk and no other entry is read. A test
    feeds an archive padded with a large extra entry and asserts rejection plus a `failed`
    ingest.
22. **AC-37** — one installation's GitHub failure does not abort the rest; the response's
    `failed` array names each repository that could not be refreshed, and the other
    installations' runs still appear.
23. **AC-38** — `GET /ci/runs` returns only runs reachable installation → agent → workspace;
    another workspace's run is absent and its id resolves as not found. Ingest **always**
    resolves an installation before writing, so no row is created with a null installation
    reference — asserted directly against storage in an it-test (the column is nullable, see
    OQ-8).
24. **AC-46** — every CI route resolves the workspace through `getContext`
    (`server/src/modules/_shared/context.ts:14-23`) and ANDs `workspaceId` into the query, the
    idiom at `server/src/modules/agents/repository.ts:111-117`. Another workspace's agent,
    installation or run returns **404, not 403 and not data**. Drive the test by inserting a
    second workspace row and creating the agent under it — a request header cannot do this
    (`server/INSIGHTS.md:64`, working pattern at
    `server/test/agents-versions.it.test.ts:154-177`).
25. **AC-47** — `config: { rateLimit: { max: 10, timeWindow: '1 minute' } }` on export (and on
    update-config, OQ-7) and `{ max: 6, … }` on refresh, following
    `server/src/modules/conventions/routes.ts:56`. Note the global limiter is disabled under
    `NODE_ENV=test` (`server/src/app.ts:99-101`), so assert the route **config** rather than
    trying to trip the limiter in a test. Concretely: a **unit** test (not an it-test) builds
    the app and reads back the registered route options, asserting the `max` / `timeWindow`
    on each CI route. Trying to exercise the limit in the integration lane cannot work — the
    limiter is off there. (Cross-model review, finding 4.)
26. **Layering** — `routes.ts` maps HTTP ↔ service with zero business logic; `service.ts` and
    `ingest.ts` hold the rules; `repository.ts` returns `undefined`/outcome objects and
    **never** imports `platform/errors` (no repository in this codebase does — root
    `INSIGHTS.md:289` records that a fleet inventing this convention produced two opposite
    answers in one feature). Services throw `NotFoundError` / `BadRequestError` /
    `ExternalServiceError` from `server/src/platform/errors.ts:19-41`; routes never catch.
    Every external dependency arrives through the container.
27. New it-test files are named `*.it.test.ts` — the CI unit/integration split keys off the
    filename (root `CLAUDE.md`, `TESTING.md:79-82`). Before attributing a failure in the
    existing `.it.test` family to this diff, re-measure the same file at HEAD under the same
    load, n ≥ 3 (root `INSIGHTS.md:75`).
28. Never run `docker compose down -v` (root `CLAUDE.md`) — it wipes the dev database.

**A3 — CI Runs page + sidebar nav**

1. **AC-41** — `NAV` (`client/src/vendor/ui/nav.ts:21-39`) gains a third group
   `section: "GLOBAL"` containing `{ key: "ci-runs", label: "CI Runs", icon, href: "/ci-runs" }`.
   Section headings render as literal strings (`vendor/ui/shell/Sidebar.tsx:56`), matching the
   existing `"WORKSPACE"`/`"SKILLS LAB"` entries. **Nothing else discovers this registry and
   no build step catches an omission** (`client/INSIGHTS.md:167`). `activeKeyFor` already maps
   `/ci-runs` (`client/src/components/app-shell/helpers.ts:41`) and the i18n label already
   exists (`client/messages/en/shell.json:28`) — do not duplicate either. Add a test to
   `client/src/vendor/ui/nav.test.ts` mirroring the existing AC-19 test.
2. **AC-39** — with no ingested run the page renders the empty state from `ci.runs.empty*`,
   not a blank table and not a spinner.
3. **AC-40** — each row shows all eight values: PR number, repository, agent name, status,
   findings count, cost, duration, and a link to the GitHub Actions run. Numeric and time
   fields are nullable in the contract (`eval-ci.ts:436-449`) — a `failed` run renders empty
   metric cells, never `NaN`, `null` or `undefined`. Status renders through the shared
   `CiRunStatusPill` from I5 (text label, not colour alone).
4. **AC-35 (render half)** — the artifact's `agent` string is third-party content from someone
   else's CI. Render it as **text**, never as markup, and never through
   `dangerouslySetInnerHTML`.
5. **AC-32 (client half)** — the runs query has **no** `refetchInterval` and no
   `refetchOnWindowFocus: true`. Refresh happens only when the user presses Refresh; leaving
   the page open issues no request. This deliberately differs from the `usePulls` analogue
   (`client/src/lib/hooks/core.ts:102-112`), which does poll — copy its shape, not its
   polling.
6. **AC-37 (render half)** — the refresh response's `failed` array is surfaced by repository
   name; a partial failure does not blank the table.
7. Layering — `page.tsx` is thin and assembles feature components (`client/CLAUDE.md`); all
   data goes through `lib/hooks/ci-runs.ts` → `lib/api.ts`; **no `fetch()` in a component**.
   Types come from `@devdigest/shared` inferences, never redefined locally. Named exports
   only, except the Next.js `page.tsx` default. No `index.ts` barrel.
8. Every user-visible string comes from `ci.json` (I5). If a key is missing, **report it — do
   not edit `client/messages/en/ci.json`**, which another owner holds. **How you will notice:**
   `next-intl` throws `MISSING_MESSAGE` at render time, so a wrong key surfaces as a red RTL
   test, not a silent blank. Treat that error as "coordinate with the I5 owner", never as
   "patch the catalogue". There is no build-time guard for this (`client/CLAUDE.md` describes
   a build-time error for a missing key *across locales*, and only `en` exists — see
   `client/INSIGHTS.md:123`), so the test run is the only signal you get.
9. RTL test colocated as `CiRunsTable.test.tsx`, following the local `renderWithIntl` pattern
   at `.../AgentEditor/EvalsTab/EvalsTab.test.tsx:126-133` (`NextIntlClientProvider` + the real
   namespace JSON + `QueryClientProvider`). Cover the empty state, a fully-populated row, and
   a `failed` row with null metrics.

**A4 — Export wizard + agent CI tab**

1. **AC-42** — `TABS` (`.../AgentEditor/constants.ts:12-17`) gains a `ci` entry **after**
   `evals`, and `AgentEditor.tsx:26-34` gains the matching dispatch branch. `VALID_TABS`
   derives from `TABS.map` (`agents/[id]/page.tsx:18`) so the deep link `?tab=ci` works with no
   second edit — but **`TABS` itself has no automatic discovery** (`client/INSIGHTS.md:165`).
   The label key `editor.tabs.ci` already exists (`client/messages/en/agents.json:52`).
2. **AC-1** — "Add to CI" opens a modal wizard with a four-step stepper (Target, Preview,
   Configure, Install), starting on Target with the GitHub Actions card selected. Reuse the
   existing primitives: `client/src/vendor/ui/kit/Modal.tsx:4-69` (already
   `role="dialog" aria-modal="true"`) and `client/src/vendor/ui/ExportWizardSteps.tsx:6-55`,
   whose demo call at `components/showcase/Showcase.tsx:241` already uses these four labels.
3. **AC-2** — CircleCI, Jenkins and Generic CLI render as **disabled** cards labelled "coming
   soon"; clicking one leaves the selection on GitHub Actions and the step unchanged.
   Continue advances only with GitHub Actions selected. The "copy files as a zip" card is
   likewise disabled (spec Non-goal `:48-50`, OQ-2).
4. **AC-3** — a free-text `owner/name` field, pre-filled with the active workspace repository
   and editable to any other value; the entered value is what the Install step's summary
   names.
5. **AC-4 (client half)** — Continue stays inert for empty, `acme`, `acme/`,
   `https://github.com/acme/x`. The server rejects independently (A2) — the UI guard is not
   the security boundary.
6. **AC-9 (UI half)** — only the workflow entry shows the "editable" affordance; selecting the
   runner entry shows a placeholder note instead of code (its `contents` arrives empty).
7. **AC-10** — an edit made in Preview is sent as the `workflow` field on export (I1) and
   appears verbatim in the opened PR.
8. **AC-23 (client half)** — deselecting all three trigger chips leaves Continue inert.
9. **AC-44** — the Configure step's secrets block is **static reference text**: the model key
   as one the user must add themselves, the GitHub token as one Actions provides. **No**
   "ready"/"not set" status pill, and **no request is made when the step opens** — the block
   renders identically regardless of the chosen repository.
10. **AC-45** — the Configure step explains that blocking a merge requires setting "Fail CI on"
    **plus** marking the check required in branch protection, and that **no GitHub App is
    needed**. The superseded "Requires a GitHub App" string is deleted by I5 — do not
    reintroduce that claim in a component literal.
11. **AC-8 (UI half)** — the runner-bundle failure surfaces the server's message, which names
    the build command; the wizard shows no success state.
12. **AC-28 (UI half)** — the Install step renders a **working link** to the opened PR.
13. **AC-29** — the "Fail CI on" selector persists via the existing `useUpdateAgent`
    (`client/src/lib/hooks/agents.ts:61-70`); `ci_fail_on` is already in both
    `UpdateAgentBody` (`server/src/modules/agents/routes.ts:64`) and `UpdateAgentInput`
    (`client/src/lib/hooks/agents.ts:53`), so **no new plumbing and no edit to
    `hooks/agents.ts`**. The value survives a reload and writes nothing to any target
    repository.
14. **AC-43** — with installations, the CI tab lists one row per installed repository showing
    the repository, the target type, the most recent ingested run's status and how long ago it
    ran, plus an "Active in N repos" count derived from the row count. A repository with no
    ingested run shows a neutral "no runs yet" state, **never** a stale status. Consume
    `Array<CiInstallation & { last_run: CiRun | null }>` from
    `GET /agents/:id/ci/installations`; declare the composed row type in the feature's own
    `types.ts` from the two vendored contract types — do **not** redefine either contract
    (`client/AGENTS.md:78`).
15. **AC-30 / AC-31 (UI half)** — one "Update CI config" control **per installation row**.
    There is no header-level control that updates several repositories at once (spec Non-goal
    `:61-65`).
16. **Accessibility (NFR `:417-419`)** — the modal traps and restores focus, every step is
    completable by keyboard alone, the stepper's current step is exposed to assistive
    technology, and status pills carry a text label rather than colour alone.
17. Layering — route-local components under `_components/` (`client/CLAUDE.md`); all data
    through `lib/hooks/ci-export.ts` → `lib/api.ts`; no `fetch()` in a component; named
    exports; no `index.ts` barrel; no literal user-visible strings.
18. Every user-visible string comes from `ci.json` (I5). If a key is missing, **report it — do
    not edit `client/messages/en/ci.json`**. **How you will notice:** `next-intl` throws
    `MISSING_MESSAGE` at render time, so a wrong key surfaces as a red RTL test rather than a
    silent blank. That error means "coordinate with the I5 owner", never "patch the
    catalogue". No build-time guard covers this (only the `en` locale exists —
    `client/INSIGHTS.md:123`), so the test run is the only signal you get.
19. RTL tests colocated for `CiTab` and `ExportWizard`, following the `renderWithIntl` pattern
    at `.../EvalsTab/EvalsTab.test.tsx:126-133`. Cover: the 4-step stepper on open (AC-1), a
    disabled non-GitHub card not changing the selection (AC-2), Continue inert on a malformed
    repo (AC-4) and on zero triggers (AC-23), the runner entry showing a placeholder (AC-9),
    the "no runs yet" row state (AC-43), and the absence of any secret-status indicator
    (AC-44).

---

## 9. `AC-N` → Task coverage

Every AC is covered by at least one task; every task traces to at least one AC.

| AC | Tasks |
|---|---|
| AC-1 | A4 |
| AC-2 | A4, A2 (server rejects non-`gha`) |
| AC-3 | A4 |
| AC-4 | A4 (block), A2 (reject before any GitHub call) |
| AC-5 | A2 |
| AC-6 | A1 |
| AC-6a | A1 (ships every entry it is handed), A2 (`runner-bundle.ts` reads the whole directory, no name allowlist) |
| AC-7 | A1 |
| AC-8 | A2, A4 (renders the message) |
| AC-9 | A1 (`editable` flags + `toPreview`), A2 (preview route), A4 (placeholder UI) |
| AC-10 | I1, A2, A4 |
| AC-11 | I1, A2 |
| AC-12 | I1, A2 |
| AC-13 | A1 |
| AC-14 | A1 |
| AC-15 | A1 |
| AC-16 | A1 |
| AC-17 | A1 |
| AC-18 | A1 |
| AC-19 | A1 |
| AC-20 | A1 |
| AC-21 | A1 |
| AC-22 | A1 |
| AC-23 | A4 (block), A2 (reject) |
| AC-24 | A2 |
| AC-25 | A2 |
| AC-26 | A2 |
| AC-27 | A2 |
| AC-28 | A2, A4 (PR link) |
| AC-29 | A4 |
| AC-30 | A2, A4 (control) |
| AC-31 | A2, A4 |
| AC-32 | A2, A3 (no polling client-side) |
| AC-33 | A2 |
| AC-34 | A2 |
| AC-35 | A2 (persistence), A3 (render as text) |
| AC-36 | I3 (port shape), A2 |
| AC-37 | A2, A3 (surface failed repos) |
| AC-38 | A2, A3 |
| AC-39 | A3 |
| AC-40 | I5 (keys), A3 (renders all eight values). I2 adds the two columns this row reads, but satisfies **no observable part** of AC-40 on its own — do not write an I2 test against it |
| AC-41 | A3 |
| AC-42 | A4 |
| AC-43 | A2 (endpoint), A4 |
| AC-44 | I5 (strings), A4 |
| AC-45 | I5 (deletes the GitHub-App claim), A4 |
| AC-46 | A2 |
| AC-47 | A2 |
| AC-48 | A1 |
| AC-49 | I5, A3 + A4 (consume no removed key) |

**Reverse trace.** I1 → AC-10, AC-11, AC-12. I2 → AC-43 (schema support for AC-40, not an
observable of it). I3 → AC-32, AC-33, AC-35,
AC-36. I4 → AC-7, AC-13. I5 → AC-40, AC-44, AC-45, AC-49. A1 → 14 ACs. A2 → 26 ACs. A3 →
7 ACs. A4 → 15 ACs. No orphan task.

---

## 10. Testing Strategy

Canonical per-module commands live at `TESTING.md:63-74`; each task's exact command is in its
**Tests to run** cell. This plan runs none of them.

**Which lanes judge this change, and why:**

- **Server unit lane** (`TESTING.md:67`) is the primary judge of **A1**. Generation is pure
  string production with byte-exact observables, so unit tests are both sufficient and
  stronger than an integration test would be. One assertion **per** workflow AC — a single
  snapshot test would go green on a regression that reintroduces a `paths:` filter, which is
  exactly the failure root `INSIGHTS.md:25` describes.
- **Server integration lane** (`TESTING.md:68`, testcontainers Postgres) is mandatory for
  **A2**: it writes two tables, resolves tenancy through a real `agents` join (AC-46), and
  upserts by a composite key (AC-34, AC-27). A schema-touching, tenancy-scoped change cannot
  be judged by unit tests. New files **must** end in `*.it.test.ts` — the CI unit/integration
  split keys off the filename (root `CLAUDE.md`, `TESTING.md:79-82`). Bootstrap via
  `server/test/helpers/pg.ts` (`dockerAvailable()` at `:23`, `startPg()` at `:35-40`).
- **Client lane** (`TESTING.md:63`, Vitest + jsdom, `fetch` mocked) judges **A3** and **A4**.
  No client test needs a live API, so the client side is fully testable before A2 lands.
- **No e2e lane.** The spec explicitly cuts a browser flow fixture for this iteration
  (`:70`), and `e2e/` is declared untouched (`:502`).
- **`reviewer-core` and `agent-runner` are not exercised** — neither is modified.

**What is not directly testable, and how it is pinned instead.** AC-18 (fork job skipped),
AC-22 (artifact uploaded on failure) and the branch-protection behaviour are observable only
in a live Actions run. They are pinned as **properties of the generated text** (a job-level
`if:` on the fork condition; `if: always()` on the upload step), which is the strongest check
available without a real repository. State this in A1's test file so a later reader does not
mistake it for weak coverage.

**Authoritative typechecks.** `pnpm typecheck` is whole-project on the server, so a parallel
task's in-progress errors appear in your output (`server/INSIGHTS.md:56`). Each agent greps
tsc output for **its own filenames**. The authoritative final server typecheck is run by
**A2** (last server task); the authoritative final client typecheck is run by the
**orchestrator** after both A3 and A4 report, since neither is strictly last.

**Flake protocol.** A2 adds two files to the `.it.test` family that flakes together under
load (root `INSIGHTS.md:75`). Before attributing a failure to its own diff, re-measure the
same file at HEAD, in the same session, under the same load, n ≥ 3.

---

## 11. Risks & Mitigations

| # | Risk | Sev | Mitigation |
|---|---|---|---|
| 1 | **`commitFiles` inlines multi-MB content into one `createTree` call**, contradicting its own docstring (`adapters.ts:157`); the runner bundle is the first real payload, so AC-24 likely fails on first use | **High** | A2 acceptance criterion #10: align the implementation with the documented blob-first contract. Zero other callers, so no regression surface. See R1 |
| 2 | **`agent-runner/dist/` is not in git**, so AC-8's failure is today's default; a happy-path test that reads the real filesystem can never pass | **High** | The runner-bundle reader is injected through `ContainerOverrides` — tests stub both branches and never touch the real path. I6 records the dev-loop precondition; R4 proposes the permanent fix |
| 3 | **One-sided dual-vendored edit** in I1 — a one-sided Zod change fails only at runtime; a one-sided `adapters.ts` change fails only on a client typecheck that nothing currently triggers (root `INSIGHTS.md:37`, `:108`) | **Medium** | I1 is a single inline task owning both files. Verify by comparing only the **added** lines on each side — a whole-file `diff` is red on a clean tree (root `INSIGHTS.md:186`). OQ-1 records the deliberate non-mirroring of the port methods |
| 4 | **Two client registries with no auto-sync and no build-time guard** — `TABS` and `NAV` (`client/INSIGHTS.md:165`, `:167`); a "new files only" task list would silently omit both | **Medium** | Named explicitly in A3 #1 and A4 #1, each with a registry test |
| 5 | **Migration invisible to the migrator** — a hand-written SQL file without a `_journal.json` entry is skipped silently (`server/INSIGHTS.md:126`) | **Medium** | I2 acceptance criteria require the journal entry and a clean `pnpm db:migrate` on a DB already at 0016 |
| 6 | **`.it.test` family flakes under load** (root `INSIGHTS.md:75`); A2 adds two files and increases that load, inviting a wrong-cause bisect | **Medium** | A2 #27: re-measure at HEAD, same session, same load, n ≥ 3, before blaming the diff |
| 7 | **Hostile result artifact from a third-party CI** — oversized archive, corrupt payload, hostile `agent` string (AC-35, AC-36) | **Medium** | Size cap before read; single entry read in memory via the already-present `adm-zip`; `safeParse` with nothing persisted on failure; rendered as text on the client (A3 #4) |
| 8 | **AC-13 determinism regresses** through incidental object key ordering, making preview untrustworthy and every generation test brittle | **Medium** | A1 #3: an explicitly ordered plain object into `yaml.stringify`, plus a test pinning the exact key sequence |
| 9 | **`CiFile.editable` defaults to `true`** (`eval-ci.ts:367`), so an entry that forgets to set it becomes editable — including the runner bundle | **Medium** | A1 #4 states the default explicitly and requires `false` on all four non-workflow entries, with a test |
| 10 | **Cross-workspace 404 test written against a request header**, which silently cannot work (`server/INSIGHTS.md:64`) | **Low** | A2 #24 names the working pattern and its reference test |
| 11 | **Whole-project typecheck shows sibling agents' errors** (`server/INSIGHTS.md:56`), blocking an agent on someone else's work | **Low** | Each agent greps tsc output for its own filenames; §10 names the authoritative final runs |
| 12 | **Scope creep back from the Non-goals** — filters on the CI Runs page, background polling, a multi-repo update control, workflow versioning | **Low** | The spec's Non-goals (`:44-70`) are quoted into A3 #5 and A4 #15; the unused `runs.filters.*` keys stay unused by explicit decision (I5) |
| 13 | **`docker compose down -v` wipes `devdigest_pgdata`** (root `CLAUDE.md`) | **Low** | Stated in A2 #28 |

---

## 12. Success Criteria

- [ ] All 49 `AC-N` from §2 are implemented and each is traceable to a task in §9.
- [ ] Exactly **one** dual-vendored contract edit landed (`CiExportInput.workflow`), verified
      by comparing only the added lines in each copy. `AgentManifest` remains absent from the
      client copy.
- [ ] `client/src/vendor/shared/adapters.ts` is **unchanged**, and the server copy carries a
      comment recording that asymmetry as deliberate (OQ-1).
- [ ] Migration `0017` applies cleanly on a database already at `0016`, and
      `meta/_journal.json` carries its entry.
- [ ] `server/src/modules/ci/` contains `constants.ts` and `workflow.ts` under exactly those
      names — `agent-runner/src/index.ts:5` already points at them.
- [ ] The generated workflow satisfies every text-level assertion in AC-14 … AC-22, each
      pinned by its own test rather than one snapshot.
- [ ] Two consecutive previews of the same agent return byte-identical contents (AC-13).
- [ ] Preview leaves the target repository with no `devdigest/ci` branch, no commit, no PR and
      no installation row (AC-5).
- [ ] A cross-workspace agent id returns 404 on every CI route (AC-46), driven by a second
      inserted workspace rather than a request header.
- [ ] Every stored `ci_runs` row has a non-null `ci_installation_id` (AC-38), asserted against
      storage.
- [ ] `client/messages/en/ci.json` no longer contains `publishDialog`, the superseded `ciTab`
      wording, the "Requires a GitHub App" string, or `runs.autoRefresh`; no rendered surface
      reads a removed key (AC-49).
- [ ] `NAV` carries a `GLOBAL` section with `CI Runs`, and `TABS` carries `ci` after `evals`;
      both pinned by a test.
- [ ] Server unit lane, server integration lane and the client lane are green; server and
      client typechecks are clean.
- [ ] No file under `agent-runner/`, `reviewer-core/`, `e2e/` or `specs/` was modified.
- [ ] Agent spawns used: **4** (cap 5). Any fifth spawn is the review fix-loop and is recorded
      as such.
