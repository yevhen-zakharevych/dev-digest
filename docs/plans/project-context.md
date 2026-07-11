# Implementation Plan — Project Context

Plan for `SPEC-2026-07-10-project-context` ("Project Context").
Source spec: `specs/2026-07-10-project-context.md`. Status: approved.

## 1. Overview

Populate the already-wired but permanently-empty `## Project context` injection slot.
The reviewer-core slot (`ReviewInput.specs` → `PromptAssembly.specs`) and the run-trace UI
("Specs read" row + expandable "Project context" block) already exist; this feature adds the
**server** discovery/attach/edit machinery and the **client** Project Context page + agent/skill
Context tabs that feed it, then wires the run executor to read the union of attached document
paths from the clone and inject them. No reviewer-core change. 13 tasks in 3 waves. Modules
touched: `server/` (contracts, db, git adapter, agents, skills, reviews, new context module),
`client/` (page, editor tabs, hooks, run-trace row), plus the dual-vendored `@devdigest/shared`
contracts. The spec supplies AC-1…AC-35; these IDs are reused verbatim.

## 2. Requirements (as given)

All IDs are the spec's own `AC-N`. Source column cites the spec section.

| ID | Requirement (abbreviated — see spec for EARS text) | Source |
|----|-----|--------|
| AC-1 | Discovery returns every `.md` under a `specs`/`docs`/`insights` folder at any depth; nothing outside those buckets | `specs/2026-07-10-project-context.md:117` |
| AC-2 | Each discovered doc carries repo-relative path, bucket, estimated token count | `:122` |
| AC-3 | Bucket folder-name set is configurable, not hard-coded inline | `:125` |
| AC-4 | Multi-match path → assigned to the **outermost** matching bucket, deterministically | `:128` |
| AC-5 | Clone absent → empty set + explicit "clone not available" state, not a 5xx | `:132` |
| AC-6 | Token estimate uses the codebase tokenizer adapter (char/4 fallback), no model/network call | `:135` |
| AC-7 | Page footer shows file count + summed token estimate + last-refreshed; no chunk/index wording | `:140` |
| AC-8 | Agent Context tab: per-doc row (handle, toggle, filename, path, bucket badge, Preview) + "N of M attached" | `:148` |
| AC-9 | Attach/detach on agent persists an ordered list of **paths** (never text) | `:152` |
| AC-10 | Reorder persists; that order drives in-block order at run time | `:156` |
| AC-11 | Agent tab shows running token estimate of attached set + untrusted-block note | `:159` |
| AC-12 | Search filters by filename/path without changing attach state | `:163` |
| AC-13 | Preview renders markdown + bucket badge + token count + "Used by N agents" + toggle | `:167` |
| AC-14 | Attach/detach/reorder does NOT create an agent/skill version snapshot | `:170` |
| AC-15 | Skill Context tab: same rows + "N attached" + search + inheritance note | `:177` |
| AC-16 | Attach/detach on skill persists list of **paths** (never text) | `:181` |
| AC-17 | Skill tab shows "serializes as" preview (`## Project context` heading + contributed paths) | `:185` |
| AC-18 | Run injects union of agent paths + every **enabled/loaded** skill's paths; disabled skill contributes nothing | `:191` |
| AC-19 | Dedupe by repo-relative path → inject once | `:195` |
| AC-20 | Each whole doc placed in `## Project context` slot, wrapped untrusted with per-doc source label, before send; never chunked | `:198` |
| AC-21 | Deterministic order: agent order first, then skill-load order then skill's doc order; dedupe keeps first | `:204` |
| AC-22 | Missing/unreadable/absent path → skip, omit, record skipped, run completes (fail-soft) | `:209` |
| AC-23 | Zero attached (or all skipped) → no `## Project context` section, exactly as today | `:214` |
| AC-24 | Injection issues no LLM/embedding/network call beyond the existing review completion | `:217` |
| AC-25 | Trace Configuration lists actual paths read; server populates `specs_read` (was `[]`) | `:223` |
| AC-26 | Trace records skipped paths distinctly from read paths (new `specs_missing`) | `:228` |
| AC-27 | Trace Prompt-assembly block populated from `prompt_assembly.specs` (was `null`) | `:232` |
| AC-28 | Trace shows tokens in→out using existing figures | `:237` |
| AC-29 | Injected block untrusted-wrapped + `INJECTION_GUARD` remains appended | `:243` |
| AC-30 | Read **and** write operate only inside the clone working tree; traversal/symlink refused; write guard is new | `:248` |
| AC-31 | Preview→Edit shows the file's raw markdown in an editable region | `:258` |
| AC-32 | Save writes new text to the working-tree file (AC-30-guarded); no git commit/push/LLM | `:261` |
| AC-33 | Next run injecting the doc uses updated text (read fresh, never cached) | `:265` |
| AC-34 | Edit affordance warns that resync (`git reset --hard`) discards uncommitted edits to tracked files | `:268` |
| AC-35 | Attached invariant spec + violating PR → at least one grounded finding referencing the violation | `:275` |

## 3. Requirements Review

Audited against complete / consistent / unambiguous / testable. The spec is unusually well
grounded (it cites real `file:line` for every existing slot); most ACs are clean. Issues:

- **AC-6 vs Non-functional performance — ambiguity (non-blocking).** AC-6 says the token
  estimate is "produced by the tokenizer adapter (`TiktokenTokenizer`) … falling back to a
  character/4 heuristic". `TiktokenTokenizer.count(text)` requires the **text**
  (`server/src/adapters/tokenizer/index.ts:16-18`), but Non-functional (`spec:323-325`) says
  discovery "reads **no file contents** … only paths + a **size-based** token estimate". These
  cannot both hold if discovery calls `count(text)`. Reconciled as OQ-1 with a stated
  assumption. **Testable** once resolved.
- **AC-35 — testability (non-blocking).** The headline "the reviewer catches it and cites the
  spec" depends on a live, non-deterministic LLM. The spec's own Cost section (`:342-346`)
  says tests must assert **injection** (`prompt_assembly.specs` contains the doc text,
  `specs_read` contains the path) and grounding survival, "never that the model produced an
  exact finding string." e2e runs with **no model key** (`TESTING.md:55-57`). So the
  automatable AC-35 core is an integration test with `MockLLMProvider` asserting the spec text
  is injected and a mock finding survives `groundFindings()`; the "model genuinely catches it"
  is a manual demo. Captured as OQ-2.
- **AC-34 — completeness (non-blocking).** "warns … for **tracked** files" presumes the client
  can tell tracked from untracked, which needs a git call the port does not expose today. See
  OQ-3.
- **AC-5 / AC-22 clone-path authority — consistency risk (not a spec defect, an implementation
  hazard).** Discovery walk, run-time reads, and the new edit-write all touch the clone working
  tree; the codebase has a known mismatch between `RepoRef`-derived clone roots and the
  DB-stored `repo.clonePath` (`server/INSIGHTS.md:74`). The spec is internally consistent
  (it points every operation at `clonePathFor`), but the plan must enforce one authority — see
  Risk R1.
- Everything else (AC-1–4, AC-7–33) is complete, consistent, unambiguous, and testable as
  written. The four spec `[ASSUMPTION]` items (`:510-520`) are carried forward as OQ-4…OQ-7.

## 4. Open Questions

All **[non-blocking]** — the plan proceeds on the stated assumption for each. None halts design.

1. **[non-blocking] Discovery token-estimate method (AC-6 vs perf).** *Assumption:* discovery
   estimates each doc's tokens from its **byte size via the char/4 heuristic** — which is
   exactly the tokenizer adapter's documented fallback (`tokenizer/index.ts:21-23`) — and does
   **not** read file contents, honoring the p95/2s "no content read" perf rule. Precise
   `tokenizer.count(text)` is used only where text is already loaded (it is not, during
   discovery). Estimates therefore match the tokenizer's fallback, not its tiktoken path.
2. **[non-blocking] AC-35 automation.** *Assumption:* AC-35 is discharged by a **server
   integration test** using `MockLLMProvider` (`src/adapters/mocks.ts`) that returns a finding
   quoting a real diff line: assert the attached spec's text is present in
   `prompt_assembly.specs`, its path in `specs_read`, and the finding survives
   `groundFindings()`. The "reviewer actually catches the violation" remains a manual demo
   (Recommendation 1).
3. **[non-blocking] AC-34 tracked-file detection.** *Assumption:* v1 shows the resync-clobber
   warning on **every** Edit action (a harmless superset), because per-file git-tracked
   detection needs a git call the `GitClient` port does not expose. Recommendation 2 proposes a
   later `isTracked` flag.
4. **[non-blocking] Skill storage field (spec ASSUMPTION, `:510`).** *Assumption:* add a
   **distinct** `attached_docs` field on the skill; do NOT overload `evidence_files`
   (`server/src/db/schema/skills.ts:19`), confirmed unrelated (set only by the Conventions
   Extractor at create time, no update path — `skills/service.ts:121`).
5. **[non-blocking] No token cap (spec ASSUMPTION, `:513`).** *Assumption:* no hard cap in v1;
   the running estimate (AC-11) and trace token sizes (AC-28) make volume visible.
6. **[non-blocking] "Used by N agents" semantics (spec ASSUMPTION, `:516`).** *Assumption:*
   the count includes direct agent attachments **and** transitive usage via an enabled linked
   skill (matching AC-18's effective set). May narrow to direct-only if the transitive query
   proves expensive (Recommendation 3).
7. **[non-blocking] Agent-tab running estimate scope (spec ASSUMPTION, `:518`).** *Assumption:*
   AC-11's estimate counts the full **de-duplicated effective set** (agent-own + enabled-skill
   inherited), so the number matches what is actually injected.

## 5. Recommendations

1. **Ship AC-35 as a demo fixture, not a CI gate.** Keep the CI assertion at injection+grounding
   (OQ-2). Cost: a short demo script/README note. Not assumed by the plan — the plan's AC-35
   task is the integration test only.
2. **Add `isTracked` to the discovery/doc-content response later.** Would make AC-34's warning
   precise (tracked-only). Cost: one extra `git ls-files`-style call per doc. Not assumed — v1
   warns on all edits (OQ-3).
3. **Cache/denormalize "Used by N agents" if the transitive walk is slow.** For a workspace with
   many agents/skills the per-doc effective-set count is O(docs × agents). Cost: a small
   denormalized counter or a single batched query. Not assumed — v1 computes it live (OQ-6).
4. **Make the two new contract fields tolerant (`.default([])`).** Adding `attached_docs`
   (agent/skill) and `specs_missing` (trace) as arrays with a `[]` default shrinks the fixture
   fallout (Risk R2) by letting schema-parsed fixtures pass without edits. The plan **assumes
   this** for the contract shapes (it materially reduces T8/T13 scope) and flags it here for
   human sign-off; typed-literal fixtures still need the fallout tasks.

Empty of anything that changes *what* is built — all four are delivery/quality refinements.

## 6. Relevant Insights (top-3, verified against code)

1. **Clone root is resolved from `RepoRef` (owner/name), NOT the DB `repo.clonePath`**
   — `server/INSIGHTS.md:74` (the CORRECTION entry), with `:54,:58,:60`. `clonePathFor`
   (`server/src/adapters/git/simple-git.ts:37-39`) and `readFileSafe`/`safeResolve`
   (`:140-168`) both derive the root as `join(cloneDir, owner, name)`. This exact mismatch once
   silently broke `conventions.it.test.ts`. Discovery, run-time reads, and the **new** write must
   all use the same `RepoRef`-based resolution. → Risk R1.
2. **Dual-vendored contracts are a two-file edit; a required-field addition breaks fixtures**
   — root `INSIGHTS.md:50,:68,:146` (mirror rule) and `:112` + `client/INSIGHTS.md:151`
   (fixture fallout). `@devdigest/shared` lives at `server/src/vendor/shared/**` mirrored to
   `client/src/vendor/shared/**`; the Agent/Skill `attached_docs` field and the trace
   `specs_missing` field must be added byte-for-byte in both, and every hard-coded
   Agent/Skill/RunTrace literal must be updated. → T1 (single owner of both copies), Risk R2.
3. **Pre-scaffolding: grep before designing; the embedding scaffold is out of scope**
   — root `INSIGHTS.md:72,:78,:96` (features arrived ~80% pre-built) and `:102` (per-package
   split beat fine-grained waves). Verified: the reviewer-core slot + client trace UI already
   exist (do not rebuild); and the orphaned embedding scaffold — `server/src/db/schema/context.ts`,
   client `context.json` i18n, `useContextFiles`/`useReindexContext` (`client/src/lib/hooks/core.ts:123-137`),
   `SpecFile`/`IndexStatus` (`.../vendor/shared/contracts/platform.ts:254-268`) — is unwired and
   **must not be touched or repurposed** (queryKey `["context", …]` and `/repos/:id/context`
   collide). → Risk R3; drives the per-package task cut.

## 7. Architecture Changes

### reviewer-core — NO CHANGE
Confirmed fully wired: `ReviewInput.specs?: string[]` (`reviewer-core/src/review/run.ts:44,59-60`),
passed into `assemblePrompt` (`run.ts:143`), each entry wrapped by `wrapUntrusted`
(`prompt.ts:30-34`) under `## Project context` (`prompt.ts:125-128,148`), recorded as
`PromptAssembly.specs` (`prompt.ts:174`); `INJECTION_GUARD` at `prompt.ts:16-28`. The feature
only **populates** the slot. Do not edit this package (AC-20/AC-23/AC-29 are satisfied by it).

### @devdigest/shared (dual-vendored) — T1
- `contracts/knowledge.ts`: add `attached_docs: z.array(z.string()).default([])` to **Agent**
  (server `:286-303`, client `:280-297`) and to **Skill** (`:121-138` both). Do **not** add to
  `AgentVersionConfig` (`knowledge.ts:318-328`) — attach must never enter a version snapshot
  (AC-14).
- `contracts/trace.ts`: add `specs_missing: z.array(z.string()).default([])` to **RunTrace**
  immediately after `specs_read` (server `:90`, client `:89`). `prompt_assembly.specs`
  (`:43`) and `specs_read` already exist — no shape change, only population downstream.
- New `contracts/project-context.ts`: `DiscoveredDocument { path; bucket: 'specs'|'docs'|'insights';
  estimatedTokens: int; usedByAgents?: int }`, `DiscoverySummary { documentCount; totalEstimatedTokens;
  refreshedAt }`, `DocumentContent` read `{ path; text }` / save `{ path; text }`. Export from the
  vendored `index.ts`. Names deliberately avoid the orphaned `SpecFile`/`IndexStatus`.
- `adapters.ts` GitClient **port** (`server/src/vendor/shared/adapters.ts:205-238`): add
  `writeFileSafe(repo, relPath, text): Promise<boolean>` and a guarded markdown lister
  `listMarkdownFilesSafe(repo): Promise<{ path: string; bytes: number }[]>`. Mirror to the client
  copy if `client/src/vendor/shared/adapters.ts` exists (byte-for-byte).

### server/db — T2
- `db/schema/agents.ts`: add `attachedDocs: jsonb('attached_docs').$type<string[]>()` on the
  `agents` table (mirror the `evidenceFiles` jsonb pattern, `skills.ts:19`).
- `db/schema/skills.ts`: add `attachedDocs: jsonb('attached_docs').$type<string[]>()` on `skills`.
- New migration `0013_<slug>.sql` + `meta/0013_snapshot.json` + `_journal.json` entry via
  `pnpm db:generate` (convention: 4-digit sequence, current head `0012_late_doctor_octopus.sql`).
  Migrations are **not** applied on boot — `pnpm db:migrate` is run before integration tests.

### server/adapters/git — T3
- `simple-git.ts`: implement `writeFileSafe` reusing the existing `safeResolve` guard
  (`:156-168`) for the write path (AC-30 write), and `listMarkdownFilesSafe` walking the
  `clonePathFor(repo)` tree, returning repo-relative `.md` paths + byte sizes, never following
  out-of-tree symlinks. Both `RepoRef`-rooted (Risk R1). No `git add/commit/push` (AC-32).

### server/modules/agents — T4 & server/modules/skills — T5
- Add dedicated repository methods `setAttachedDocs(id, paths[])` that **do not** call
  `snapshotVersion` and **do not** bump `version` — mirror the `agent_skills` link methods which
  already bypass `isConfigChange`/`update()` (`agents/repository.ts:229-281`). AC-14.
- Surface `attached_docs` in the agent/skill DTO (`service.ts` `toDto`).
- Add attach/detach/reorder route(s) beside the existing skills sub-resource
  (`agents/routes.ts:162-208`): e.g. `PUT /agents/:id/docs` (set full ordered list) and the
  skill analog. Workspace-scoped (out-of-workspace → not-found).

### server/modules/context (NEW) — T7
- `service.ts`: discovery (call `listMarkdownFilesSafe`, filter to configured bucket dirs,
  assign **outermost** bucket AC-4, estimate tokens by byte/4 OQ-1, compute `usedByAgents`
  OQ-6), guarded doc read (`readFileSafe`), guarded doc save (`writeFileSafe`),
  `DiscoverySummary`. Clone-absent → empty + not-available (AC-5). Bucket set from
  `constants.ts` (`DEFAULT_BUCKET_DIRS = ['specs','docs','insights']`), injectable for AC-3.
- `routes.ts`: `GET /repos/:repoId/project-context` (discovery+summary),
  `GET /repos/:repoId/project-context/doc?path=…` (read), `PUT /repos/:repoId/project-context/doc`
  (save). **Per-route rate limit ≤ 120/min** (Non-functional). Workspace-scoped. Register plugin
  in `modules/index.ts`. Route names avoid `/context` (orphaned scaffold collision, Risk R3).

### server/modules/reviews — T6
- New helper `reviews/project-context.ts`: pure resolver taking the agent's `attachedDocs`, the
  ordered enabled-skill `attachedDocs` lists, and a reader → returns `{ texts[], read[], missing[] }`
  applying union + dedupe-first (AC-19) + deterministic order (AC-21) + fail-soft skip (AC-22).
- `run-executor.ts`: inside `runOneAgent` (`:158-361`) call the resolver (uses
  `this.container.git.readFileSafe`, precedent `intent.service.ts:275`; skills already loaded at
  `:211-214`), spread `specs: texts` into the `reviewPullRequest` input (`:228-257`, beside the
  existing `skills` conditional), set `specs_read` (`:327`) and the new `specs_missing` on the
  success trace, and set both on the failure/cancel trace (`:472,:476`). `prompt_assembly.specs`
  is populated automatically on success via `outcome.assembly` (already dynamic at `:318`).

### client — T9 (hooks), T10 (page), T11 (agent tab), T12 (skill tab), T13 (trace row + fixtures)
- No new API plumbing: hooks call the shared `api` object (`client/src/lib/api.ts:65-74`).
- Project Context page is **new** (`app/repos/[repoId]/context/page.tsx` + `_components/*`) — no
  repo-detail route exists today. Discovery list, footer (AC-7), Preview/Edit toggle (AC-31–34).
- Agent/Skill Context tabs extend the `TABS` constant + editor switch (agent
  `AgentEditor/constants.ts:11-14` + `AgentEditor.tsx:24`; skill `SkillEditor/constants.ts:16-21`
  + `SkillEditor.tsx:66-70`), mirroring the existing `SkillsTab` attach/detach pattern.
- Run-trace: the "Specs read" row and "Project context" block already render (`TraceBody.tsx:39-51,74-92`)
  — client change is only a **new** `specs_missing` row (AC-26).

## 8. Parallelizable Tasks

Decomposed by disjoint file ownership; no two tasks edit the same file. The dual-vendored
contract + port change is isolated to a single task (T1). Skills are drawn only from the
approved palette.

| Task | Module | Files owned (with `file:line` anchors) | Skills to apply | Acceptance criteria | Tests to run | Depends-on | Batch |
|------|--------|----------------------------------------|-----------------|---------------------|--------------|------------|-------|
| **T1 — Contracts + GitClient port [shared: two-file edit]** | shared (server+client vendored) | `server/src/vendor/shared/contracts/knowledge.ts:286-303,318-328,121-138`; `.../contracts/trace.ts:43,90`; NEW `.../contracts/project-context.ts`; `.../adapters.ts:205-238`; `.../index.ts` — **AND the byte-identical client mirrors** `client/src/vendor/shared/contracts/knowledge.ts:280-297,121-138`, `.../trace.ts:89`, NEW `.../contracts/project-context.ts`, `.../adapters.ts`, `.../index.ts` | `zod`, `typescript-expert` | Agent+Skill gain `attached_docs: z.array(z.string()).default([])`; NOT added to `AgentVersionConfig` (AC-14). RunTrace gains `specs_missing: z.array(z.string()).default([])` next to `specs_read` (AC-26). New `DiscoveredDocument`/`DiscoverySummary`/`DocumentContent` per §Contracts of spec (AC-2,AC-7, DocumentContent for AC-31/32). GitClient port gains `writeFileSafe` (AC-30 write) + `listMarkdownFilesSafe` (AC-1). Server and client copies byte-identical (Risk R2). Names avoid orphaned `SpecFile`/`IndexStatus` (Risk R3). | server unit: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`; client: `cd client && pnpm test && pnpm typecheck` | — | — |
| **T2 — DB schema + migration** | server/db | `server/src/db/schema/agents.ts:8-36`; `server/src/db/schema/skills.ts:5-21`; NEW `server/src/db/migrations/0013_*.sql` + `migrations/meta/0013_snapshot.json` + `migrations/meta/_journal.json` | `drizzle-orm-patterns`, `postgresql-table-design` | `agents` + `skills` get `attachedDocs jsonb('attached_docs').$type<string[]>()` mirroring `evidenceFiles` (`skills.ts:19`). Migration generated via `pnpm db:generate`, follows 4-digit convention after `0012`. Backing storage for AC-9/AC-16. Migration applies cleanly under `pnpm db:migrate`. | server integration: `cd server && pnpm exec vitest run .it.test` (spins Postgres, migrates) | — | — |
| **T3 — Git adapter: guarded write + markdown lister** | server/adapters/git | `server/src/adapters/git/simple-git.ts:37-39,77-88,140-168` (add methods) | `onion-architecture`, `security`, `typescript-expert` | `writeFileSafe(repo, rel, text)` reuses `safeResolve` — refuses `..`/absolute/NUL/out-of-tree-symlink for **writes** (AC-30 write); no `git add/commit/push` (AC-32). `listMarkdownFilesSafe(repo)` walks `clonePathFor(repo)` returning repo-relative `.md` paths + byte sizes, guarded to the tree (AC-1), does not follow out-of-tree symlinks. Both `RepoRef`-rooted, consistent with `readFileSafe` (Risk R1). No file **contents** read by the lister (AC-6/perf). | server unit: `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (adapter unit incl. traversal/symlink refusal) | T1 | — |
| **T4 — Agent attach-docs (repo/service/routes)** | server/modules/agents | `server/src/modules/agents/repository.ts:125-163,229-281`; `.../service.ts:94-112`; `.../routes.ts:119-128,162-208`; `.../helpers.ts:62-87` | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security` | `setAttachedDocs(id, paths[])` persists ordered **paths** only (AC-9), does NOT bump `version` or snapshot (AC-14) — mirror the version-bypassing skills-link methods; verify `isConfigChange` excludes `attachedDocs`. DTO surfaces `attached_docs`. New attach/detach/reorder route (e.g. `PUT /agents/:id/docs`), workspace-scoped, out-of-workspace → not-found (Non-functional security). Reorder persists (AC-10 persistence half). | server integration: `cd server && pnpm exec vitest run .it.test` | T1, T2 | — |
| **T5 — Skill attach-docs (repo/service/routes)** | server/modules/skills | `server/src/modules/skills/repository.ts`; `.../service.ts:127-142`; `.../routes.ts:69-78` (+ new docs route) | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security` | New **distinct** `attached_docs` field persisted as paths only (AC-16); do NOT overload `evidence_files` (OQ-4). No version snapshot (AC-14). DTO surfaces it. Attach/detach route, workspace-scoped → not-found out-of-workspace. | server integration: `cd server && pnpm exec vitest run .it.test` | T1, T2 | — |
| **T6 — Run-time injection + trace population** | server/modules/reviews | NEW `server/src/modules/reviews/project-context.ts` (resolver); `server/src/modules/reviews/run-executor.ts:158-257,318,327,472,476` | `onion-architecture`, `typescript-expert`, `security` | Resolver computes union(agent `attachedDocs`, enabled-skill `attachedDocs`) — disabled skills contribute nothing (AC-18); dedupe by repo-relative path keeping first (AC-19); order = agent order, then skill-load order then skill doc order (AC-21); reads each via `readFileSafe` **fresh** every run (AC-33), skipping null/missing/unsafe (AC-22). Spread `specs: texts` into `reviewPullRequest` (AC-20) only when non-empty (AC-23). No LLM/embedding/network call added (AC-24). Populate `specs_read` (AC-25) and new `specs_missing` (AC-26) on success (`:327`) and failure (`:476`) traces; `prompt_assembly.specs` populated via `outcome.assembly` (AC-27); `stats.tokens_in/out` unchanged (AC-28). Untrusted wrap + guard preserved by reviewer-core (AC-29 — assert in test). **AC-35:** integration test w/ `MockLLMProvider` returning a diff-quoting finding — assert attached spec text in `prompt_assembly.specs`, path in `specs_read`, finding survives `groundFindings()` (OQ-2). Run-time reads reuse existing `readFileSafe` guard (AC-30 read). | server integration: `cd server && pnpm exec vitest run .it.test`; reviewer-core (unchanged, regression): `cd reviewer-core && npm test` | T1, T2 | — |
| **T7 — Discovery + doc read/write module (NEW)** | server/modules/context | NEW `server/src/modules/context/service.ts`, `.../routes.ts`, `.../constants.ts`; `server/src/modules/index.ts` (register plugin) | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security` | Discovery returns every `.md` under a configured bucket dir at any depth, nothing outside (AC-1); carries path+bucket+estimatedTokens (AC-2). Bucket set from `constants.ts`, injectable (AC-3). Outermost bucket wins deterministically (AC-4). Clone absent → empty + not-available, HTTP not 5xx (AC-5). Token estimate = byte/4 heuristic, no content read / no model call (AC-6, OQ-1). `DiscoverySummary` = count + summed tokens + refreshedAt (AC-7). `usedByAgents` = direct + transitive-via-enabled-skill count (AC-13, OQ-6). Doc read (`readFileSafe`) and doc save (`writeFileSafe`) guarded (AC-30 read+write); save issues no git/LLM (AC-32), missing/refused path → handled error not 5xx. Routes workspace-scoped → not-found out-of-workspace; discovery + write routes carry per-route rate limit ≤120/min (Non-functional). Full doc bodies not logged wholesale. | server integration: `cd server && pnpm exec vitest run .it.test` (fixture clone w/ in/out-of-bucket files, traversal refusal, save round-trip); server unit for pure bucket/estimate logic: `pnpm exec vitest run --exclude '**/*.it.test.ts'` | T1, T2, T3 | — |
| **T8 — Server fixture/builder fallout** | server (tests) | server test builders/fixtures/seed referencing Agent/Skill/RunTrace literals (implementer greps `attached_docs`/`specs_missing` targets; e.g. `server/src/adapters/mocks.ts`, `*.it.test.ts` seed helpers, agent/skill/trace fixture factories) | `typescript-expert` | Every hard-coded Agent/Skill/RunTrace literal compiles + parses after the T1 field additions (Risk R2, `INSIGHTS.md:112`). Owns only **shared** fixtures/builders/seed — feature tasks add their own new test files. `.default([])` (Rec 4) keeps schema-parsed fixtures green; typed literals updated here. | server unit + integration: `cd server && pnpm test` | T1 | — |
| **T9 — Client discovery/doc hooks** | client/lib | NEW `client/src/lib/hooks/project-context.ts` | `frontend-architecture`, `react-best-practices`, `typescript-expert` | Query/mutation hooks (mirror `lib/hooks/agents.ts:8-21,61-70,83-92` via `api` object): `useProjectContextDocs(repoId)` (discovery + summary), `useDocumentContent(repoId, path)` (read, AC-31), `useSaveDocument()` (save + invalidate, AC-32). New `queryKey` prefix (NOT `["context", …]` — collides with orphaned `useContextFiles`, `core.ts:123`). No direct `fetch`. | client: `cd client && pnpm test && pnpm typecheck` | T1 | — |
| **T10 — Project Context page** | client/app | NEW `client/src/app/repos/[repoId]/context/page.tsx` + `client/src/app/repos/[repoId]/context/_components/**`; NEW `client/messages/en/projectContext.json` | `frontend-architecture`, `next-best-practices`, `react-best-practices`, `react-testing-library` | Page lists discovered docs with bucket badge (colour + text label, a11y) + token estimate (AC-1/AC-2 surfaced). Footer: file count + summed tokens + refreshed time, **no** chunk/index wording (AC-7). Preview/Edit toggle: Preview renders markdown; Edit shows raw text in a keyboard-operable editable region (AC-31); Save calls `useSaveDocument`, reports save errors, no silent drop (AC-32, spec `:318`). Edit surfaces resync-clobber warning (AC-34, warn-on-all-edits per OQ-3). Clone-absent → not-available state, no crash (AC-5 client). All strings via i18n (Non-functional i18n); **must not** use `context.json` (orphaned, Risk R3). WCAG 2.1 AA. Tests use `fireEvent` (no `user-event`, `client/INSIGHTS.md:99`). | client: `cd client && pnpm test && pnpm typecheck` | T1, T9 | — |
| **T11 — Agent Context tab (+agent doc hooks)** | client/app + client/lib | `client/src/app/agents/[id]/_components/AgentEditor/constants.ts:11-14`; `.../AgentEditor.tsx:24`; NEW `.../AgentEditor/_components/ContextTab/**`; `client/src/lib/hooks/agents.ts` (add doc-attach hooks); `client/messages/en/agents.json:46-51` (tab label + tab strings) | `frontend-architecture`, `react-best-practices`, `react-testing-library` | New "context" entry in `TABS` + editor switch, mirroring `SkillsTab`. Rows: order/drag handle (keyboard-operable alt, a11y), attach/detach toggle, filename, folder path, bucket badge (colour+label), Preview affordance, "N of M attached" header (AC-8). Attach/detach/reorder call new hooks → persist paths, no version bump surfaced (AC-9/AC-10 client). Running token estimate of de-duplicated effective set + untrusted-block note (AC-11, OQ-7). Search filters by name/path without changing attach state (AC-12). Preview drawer: markdown + bucket badge + token count + "Used by N agents" + toggle reflecting state (AC-13). i18n only. | client: `cd client && pnpm test && pnpm typecheck` | T1, T9 | — |
| **T12 — Skill Context tab (+skill doc hooks)** | client/app + client/lib | `client/src/app/skills/_components/SkillEditor/constants.ts:16-21`; `.../SkillEditor.tsx:66-70`; NEW `.../SkillEditor/_components/ContextTab/**`; `client/src/lib/hooks/skills.ts` (add doc-attach hooks); `client/messages/en/skills.json:61-66` | `frontend-architecture`, `react-best-practices`, `react-testing-library` | New "context" tab mirroring the agent tab. Rows + "N attached" header + search + inheritance note "Any agent using this skill inherits these documents." (AC-15). Attach/detach persist paths, no version bump (AC-16). "Serializes as" preview: `## Project context` heading + contributed paths (AC-17). i18n only; not `context.json`. | client: `cd client && pnpm test && pnpm typecheck` | T1, T9 | — |
| **T13 — Trace `specs_missing` row + client fixture fallout** | client/app + client (tests) | `client/src/app/repos/[repoId]/pulls/[number]/_components/RunTraceDrawer/_components/TraceBody/TraceBody.tsx:39-51`; `.../RunTraceDrawer.test.tsx`; `client/messages/en/runs.json:35`; client mocks/fixtures referencing Agent/Skill/RunTrace literals | `react-testing-library`, `react-best-practices`, `typescript-expert` | New Configuration row rendering `trace.specs_missing` distinct from the existing "Specs read" row (AC-26 client display); empty-safe. New i18n key `trace.config.specsMissing`. Existing "Specs read" row (AC-25) and Prompt-assembly block (AC-27) unchanged — verify still render populated data. All client Agent/Skill/RunTrace fixture literals compile+parse after T1 additions (Risk R2, `client/INSIGHTS.md:151`). | client: `cd client && pnpm test && pnpm typecheck` | T1 | — |

Batches: every task sits in its own module/onboarding set (per-package cut, `INSIGHTS.md:102`);
none share a module, a `Depends-on` edge is present on most cross-package pairs, and T1 is a
shared-contract two-file edit — so no fusion is safe. All Batch cells left blank (each task
spawns alone). This is deliberate, not an oversight.

Wave structure (from `Depends-on`):
- **Wave 1:** T1, T2 (no deps; parallel, disjoint files).
- **Wave 2:** T3, T4, T5, T6, T8, T9 (depend only on T1/T2; all parallel).
- **Wave 3:** T7 (needs T3), T10, T11, T12 (need T9), T13 (needs T1 — may also start in Wave 2).

## 9. AC-N → Task coverage

| AC | Task(s) | AC | Task(s) |
|----|---------|----|---------|
| AC-1 | T3, T7 | AC-19 | T6 |
| AC-2 | T1, T7 | AC-20 | T6 (reviewer-core existing) |
| AC-3 | T7 | AC-21 | T6 |
| AC-4 | T7 | AC-22 | T6 |
| AC-5 | T7, T10 | AC-23 | T6 |
| AC-6 | T7 | AC-24 | T6, T7 |
| AC-7 | T1, T7, T10 | AC-25 | T6 |
| AC-8 | T1, T11 | AC-26 | T1, T6, T13 |
| AC-9 | T1, T2, T4 | AC-27 | T6 |
| AC-10 | T4, T6 | AC-28 | T6 (existing figures) |
| AC-11 | T11 | AC-29 | T6 (reviewer-core existing) |
| AC-12 | T11 | AC-30 | T3, T6, T7 |
| AC-13 | T7, T11 | AC-31 | T1, T10 |
| AC-14 | T4, T5 | AC-32 | T3, T7, T10 |
| AC-15 | T12 | AC-33 | T6 |
| AC-16 | T1, T2, T5 | AC-34 | T10 |
| AC-17 | T12 | AC-35 | T6 |
| AC-18 | T6 | | |

Every AC maps to ≥1 task; every task (T1–T13) traces to ≥1 AC (T8 traces to AC-9/AC-16/AC-26 as
the fixture-integrity guard that keeps their suites green — the fallout of adding those fields).

## 10. Testing Strategy

Canonical per-module commands: `TESTING.md:63-74` (do not restate; each task's **Tests to run**
cell carries the exact command). Judgement lanes:

- **Schema/migration + persistence + routes (T2, T4, T5, T7)** ⇒ **server integration**
  (`pnpm exec vitest run .it.test`) — these need a real Postgres (testcontainers), migrate, and
  drive routes end-to-end (`TESTING.md:46-50`). A DB-backed test file must end `*.it.test.ts`.
- **Pure adapter/resolver logic (T3 traversal+symlink refusal; T6 union/dedupe/order/skip; T7
  bucket-assignment + estimate)** ⇒ **server unit** (`--exclude '**/*.it.test.ts'`), hermetic,
  using `src/adapters/mocks.ts` (`MockLLMProvider`, `MockGitClient`).
- **Run-time injection + headline (T6)** ⇒ **server integration** with `MockLLMProvider`; assert
  injection (`prompt_assembly.specs` text, `specs_read` path) + grounding survival, never an
  exact model string (spec Cost `:342-346`, OQ-2). reviewer-core regression: `npm test`.
- **Client (T9–T13)** ⇒ `cd client && pnpm test && pnpm typecheck`; RTL with **`fireEvent`**
  (no `@testing-library/user-event`, `client/INSIGHTS.md:99`); tests colocated `*.test.tsx`.
- **Contracts (T1)** ⇒ compiles+parses in both server unit and client typecheck (dual-vendored).
- The implementer runs these; the planner does not (Hard rule 1).

## 11. Risks & Mitigations

| # | Risk | Mit. | Sev |
|---|------|------|-----|
| R1 | **Clone-path authority split.** Discovery walk, run-time reads, and the new write could each resolve the clone root differently (`RepoRef` vs DB `repo.clonePath`), silently reading/writing the wrong tree — the exact class of bug that broke `conventions.it.test.ts` (`server/INSIGHTS.md:74`). | Single authoritative decision: **all** three operations resolve via `clonePathFor(RepoRef{owner,name})`, identical to the existing `readFileSafe` (`simple-git.ts:37-39,140-168`). T3/T6/T7 acceptance each state `RepoRef`-rooting. Integration tests exercise discovery→edit→run against one fixture clone. | High |
| R2 | **Dual-vendored + required-field fallout.** Adding `attached_docs`/`specs_missing` can drift the two vendored copies and break every hard-coded Agent/Skill/RunTrace literal (`INSIGHTS.md:112`, `client/INSIGHTS.md:151`). | All vendored edits isolated to T1 (both copies, byte-identical). Fields use `.default([])` (Rec 4) to spare schema-parsed fixtures. Explicit fallout tasks T8 (server) + T13 (client) update typed literals. | High |
| R3 | **Orphaned embedding scaffold collision.** Reusing `context.json` i18n, `useContextFiles`/`useReindexContext`, `SpecFile`/`IndexStatus`, `/repos/:id/context`, or `queryKey ["context",…]` would entangle this feature with the out-of-scope semantic-indexing feature (`db/schema/context.ts`, `hooks/core.ts:123-137`, `platform.ts:254-268`). | New names throughout: `contracts/project-context.ts`, `modules/context` routes under `/repos/:id/project-context`, `messages/en/projectContext.json`, distinct query keys. T9/T10/T12 acceptance forbid touching the scaffold. Note: server dir is named `modules/context` but exposes only project-context routes — acceptable (no orphaned server `context` module exists). | Med |
| R4 | **AC-6 estimate vs perf contradiction** → wrong reading yields either slow discovery (reads all files) or an estimate that fails the "matches tokenizer" observable. | OQ-1 fixes byte/4 (== tokenizer fallback); T7 acceptance + a unit test pin it. | Med |
| R5 | **Version-bump leak.** Attach/detach routed through `agents.update()` would bump `version`/snapshot, violating AC-14. | T4/T5 use dedicated setters bypassing `isConfigChange` (`agents/helpers.ts:62-87`), mirroring `agent_skills` methods; integration test asserts `version` unchanged. | Med |
| R6 | **AC-35 non-determinism** mistaken for a flaky CI gate. | OQ-2: CI asserts injection+grounding with a mock; "model catches it" is a manual demo (Rec 1). | Low |

## 12. Success Criteria

- [ ] Discovery returns exactly the in-bucket `.md` set with path+bucket+token estimate, outermost
      bucket wins, configurable bucket set, clone-absent → empty+not-available, no content reads
      (AC-1–7).
- [ ] Agent + skill Context tabs attach/detach/reorder **paths** only, no version bump, with
      search, running estimate, untrusted note, Preview metadata, inheritance note, "serializes
      as" (AC-8–17).
- [ ] A run injects the de-duplicated, deterministically-ordered union of agent + enabled-skill
      docs into `## Project context`, fresh each run, fail-soft on missing paths, no extra
      LLM/network call, zero docs → no section (AC-18–24, AC-33).
- [ ] Trace shows `specs_read`, the new `specs_missing` row, the populated Prompt-assembly block,
      and tokens in→out (AC-25–28).
- [ ] Each doc wrapped untrusted with `INJECTION_GUARD` intact; read **and** write refuse
      traversal/out-of-tree symlinks; write is the only new guard (AC-29–30).
- [ ] Preview/Edit toggle edits raw markdown, saves to the working tree with no git/LLM call,
      reports save errors, warns about resync clobber; next run reflects the edit (AC-31–34).
- [ ] AC-35 integration test: attached invariant spec is injected and a mock finding survives
      `groundFindings()` (OQ-2).
- [ ] Both vendored contract copies byte-identical; server + client suites and typechecks green;
      `pnpm db:migrate` applies `0013`; the orphaned embedding scaffold is untouched.
