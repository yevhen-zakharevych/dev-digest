# Development Plan — L04: Blast Radius `prior_prs` (prior PRs touching the same files)

## 1. Overview

Add a `prior_prs` field to the Blast Radius feature so `GET /pulls/:id/blast`
(and, through it, the `get_blast_radius` MCP tool and the `BlastRadiusCard` UI)
surfaces **other merged/landed PRs that previously touched at least one of the
current PR's changed files**. This is a genuinely NEW feature — `prior_prs`
exists nowhere today except an unwired sibling `PrHistoryItem` contract we
reuse. Work spans a dual-vendored contract edit, one new DB read, thin service
wiring, and a new card section; `mcp-server` needs **zero code change** (verified).

## 2. Requirements

- Reuse the existing unused `PrHistoryItem` contract shape (no new type) and add
  `prior_prs: z.array(PrHistoryItem)` to `BlastRadius` — snake_case, matching the
  rest of that contract. **[shared: two-file edit]** — both vendored copies.
- Reorder `PrHistoryItem`/`PrHistory` **above** `BlastRadius` in `brief.ts` (both
  copies) so the `z.array(PrHistoryItem)` reference is defined before use — today
  `BlastRadius` (line 39) precedes `PrHistoryItem` (line 65); referencing it as-is
  is a temporal-dead-zone `ReferenceError` at module eval.
- "Prior PR" match criterion = a **different** PR in the same workspace+repo whose
  `pr_files` set shares **≥1 file path** with the current PR's changed files
  (file-path overlap, NOT symbol-level). Exclude the current PR (self). Dedupe by
  PR. Compute `files_overlap` = the intersection of that PR's files with the
  current PR's changed files. Order by recency, cap the count.
- Resolve the **merge-state / timestamp gap** (see §3, §4): the DB stores **no**
  `merged_at` column. Decide and document the `merged_at` source and the
  merge-state filter rather than assuming a column exists.
- Decide and document what `PrHistoryItem.notes` carries (nothing computes it today).
- New repository read: given `workspaceId, repoId, currentPrId, changedFiles[]` →
  capped, ordered `PrHistoryItem[]` with file overlap. Placed in the reviews
  repository (`pull.repo.ts` + exposed on `ReviewRepository`).
- `BlastService.getBlastRadius` fetches prior PRs alongside the existing
  `repoIntel.getBlastRadius` call (`Promise.all`) and spreads them onto the mapped
  `BlastRadius`. `blast/contract.ts` stays **pure** (no DB) — it emits
  `prior_prs: []`; the service supplies the real data.
- Client: new "Prior PRs touching these files" section in `BlastRadiusCard.tsx`
  + i18n keys in `client/messages/en/blast.json`, following the house patterns
  (`getNodeText` single-text-node interpolation; `data-testid` + `within(...)`
  scoping; `MonoLink` + `githubPrUrl` for the clickable PR link).
- `mcp-server`: explicit "no code change" verification task (typecheck + tests
  green) — the field flows through `BlastRadius.shape` (outputSchema) + the
  `client.blast()` passthrough automatically.
- Tests: server integration (`.it.test.ts`) seeding multiple PRs with overlapping
  `pr_files`; client test for the new section.

## 3. Relevant Insights

- **Every `@devdigest/shared` contract is a two-file edit** — root `INSIGHTS.md:37-40`
  (+ `client/CLAUDE.md` gotcha). `server/src/vendor/shared/contracts/brief.ts` and
  `client/src/vendor/shared/contracts/brief.ts` are logically one source, physically
  two files; typecheck passes on each side independently but a one-sided edit makes
  Zod reject the wire payload at runtime. The `prior_prs` addition + the
  `PrHistoryItem` reorder MUST land byte-identically in both, in **one task**
  (verify with matching `git diff` blob hashes, `INSIGHTS.md:56`).
- **The DB `pull_requests.status` column holds GitHub merge state (`open`/`closed`/`merged`
  via `mapStatus`, `server/src/adapters/github/octokit.ts:19-23`) but the seed writes
  the freshness value `needs_review` directly (`server/src/db/seed.ts:117`), and
  there is NO stored merge timestamp** — GitHub's `pr.merged_at` is consumed only to
  compute the boolean and then discarded (`octokit.ts:60,102`); the row keeps only
  `openedAt`/`updatedAt` (`server/src/db/schema/pulls.ts:27-28`). So
  `PrHistoryItem.merged_at` (`brief.ts:68`) cannot be populated from a real merge
  time, and a strict `status === 'merged'` filter would return **nothing** on seed/dev
  data. This dictates the §4 decision.
- **Blast's pure mapper vs DB-aware service split is deliberate** — `server/INSIGHTS.md`
  (2026-07-07 Blast entries) + `blast/contract.ts:1-13`: `blastResultToContract` is a
  pure `BlastResult → BlastRadius` function (no DB, no `this`) shared by both surfaces;
  PR/history awareness is not something `repoIntel`/`BlastResult` can produce. Prior-PR
  assembly therefore belongs in `BlastService` (which has `container.reviewRepo`), NOT
  in the mapper — "mapper = compute-shape, service = compute-data".
- Bonus (client): **`getNodeText`/`getByText` only match an element's DIRECT text-node
  children**, and **reusing one i18n key at two nesting levels makes queries ambiguous
  — scope via `data-testid` + `within`** — `client/INSIGHTS.md` (2026-07-07 correction
  entries, `BlastRadiusCard.tsx:216-224`). Interpolate `{count}{label}` as ONE
  template-string child; tag the prior-PR section wrapper with a `data-testid`.

## 4. Architecture Changes

### 4.1 Shared contract — `brief.ts` (both vendored copies) **[two-file edit]**

- **Move** the `// ---- PR History ----` block (`PrHistoryItem` + `PrHistory`,
  `brief.ts:64-78`) to **above** the `// ---- Blast radius ----` block (before line 16),
  so `PrHistoryItem` is defined before `BlastRadius` references it. Keep the block
  byte-identical between the two files.
- **Add** `prior_prs: z.array(PrHistoryItem)` to `BlastRadius` (`brief.ts:39-44`),
  placed after `summary`. Type re-inference (`export type BlastRadius = z.infer<…>`)
  is unchanged in form.
- **Type reuse decision (explicit):** keep `PrHistoryItem` as the single reused type,
  referenced from BOTH `PrBrief.history` (`brief.ts:120`, still unwired) and
  `BlastRadius.prior_prs`. Do NOT fork a blast-local type — the shape
  (`{ pr_number, title, merged_at, author, files_overlap, notes }`) is exactly what
  prior-PR rows need; a fork would duplicate a contract for no gain.
- `prior_prs` is a **required** array (empty when none) — so every `BlastRadius`
  producer must emit it (see 4.2/4.3). Making it required (not `.optional()`) keeps
  the client type non-nullable and the Fastify serializer strict.

### 4.2 Blast mapper — `server/src/modules/blast/contract.ts` (stays pure)

- `emptyBlastRadius(summary)` (`contract.ts:16-22`): add `prior_prs: []` to the
  returned object (it must satisfy the now-required field; degraded/empty callers
  carry no history).
- `blastResultToContract(result)` (`contract.ts:98-102`): add `prior_prs: []` to the
  returned object. The mapper has no DB access and stays pure — the **service**
  overwrites this with the real array via spread. This is the minimal change that keeps
  the mapper typechecking against the new contract without teaching it about PRs.

### 4.3 New repository read — `server/src/modules/reviews/repository/pull.repo.ts` (+ `repository.ts`)

- New function `priorPrsTouchingFiles(db, workspaceId, repoId, currentPrId, changedFiles: string[]): Promise<PrHistoryItem[]>`,
  placed after `getPrFiles` (`pull.repo.ts:50-55`). Exposed on `ReviewRepository`
  after `getPrFiles` (`repository.ts:43-45`) so `BlastService`'s single dependency
  (`container.reviewRepo`) is unchanged.
- **Query:** if `changedFiles.length === 0` return `[]` (skip the query). Else
  `innerJoin` `pullRequests` ↔ `prFiles` on `prFiles.prId = pullRequests.id`, `where`
  `and(eq(workspaceId), eq(repoId), ne(pullRequests.id, currentPrId), inArray(prFiles.path, changedFiles))`.
  Select the PR columns + `prFiles.path`. Group the rows in JS by PR id (a PR can match
  multiple files — mirrors the pulls-list `inArray` + `Map` aggregation pattern,
  `server/INSIGHTS.md:22`): collect a distinct sorted `files_overlap` per PR, keep
  `number/title/author/updatedAt/openedAt`.
- **Merge-state / `merged_at` decision (resolves the §3 gap):** do NOT require
  `status === 'merged'` — the DB has no reliable merged flag or timestamp, and a strict
  filter yields an always-empty section on seed/dev data. Treat **every** non-self PR
  with file overlap as a "prior PR". Populate `merged_at` from the best available
  timestamp: `(row.updatedAt ?? row.openedAt)` as an ISO string, or `''` when both are
  null — documented as a **"last activity" proxy**, since no true merge time is stored.
  A future option (out of scope) is a schema migration adding a real `merged_at`
  column populated from `pr.merged_at` in the GitHub adapter.
- **`notes` decision:** set `notes: ''` (empty, reserved for future enrichment such as
  an LLM-derived "why this PR is relevant"). The UI guards on `notes && …` so an empty
  value renders nothing. Documented so the field isn't left unaddressed.
- **Order + cap:** sort by the source timestamp (`updatedAt ?? openedAt`) DESC, tie-break
  `pr_number` DESC; then cap to `MAX_PRIOR_PRS` (module-level `const MAX_PRIOR_PRS = 10`
  at the top of the function, doc-comment citing the `MAX_CALLERS_PER_SYMBOL` /
  `MAX_CALLERS_TOTAL` capping precedent, `repo-intel/constants.ts:37,47`).

### 4.4 Service wiring — `server/src/modules/blast/service.ts`

- In `getBlastRadius` (`service.ts:25-35`): after resolving `pull` + `changedFiles`,
  run the existing `repoIntel.getBlastRadius(pull.repoId, changedFiles)` **and** the new
  `reviewRepo.priorPrsTouchingFiles(workspaceId, pull.repoId, prId, changedFiles)` in
  `Promise.all` (both only need `pull`/`changedFiles`). Return
  `{ ...blastResultToContract(result), prior_prs }`. `contract.ts` stays untouched by
  this task — the spread supplies the real array over the mapper's `[]` default.

### 4.5 Client — `BlastRadiusCard.tsx` + `styles.ts` + `blast.json`

- New "Prior PRs touching these files" section in `BlastRadiusCard.tsx`, rendered
  **only when `blast.prior_prs.length > 0`** (keeps the compact card uncluttered when
  history is sparse), placed just before the `disclaimerFooter` (`BlastRadiusCard.tsx:287`).
  One row per prior PR: a `MonoLink` to the GitHub PR page
  (`href={repoFullName ? githubPrUrl(repoFullName, pr.pr_number) : undefined}` — reuses
  the existing `MonoLink` + `github-urls` house pattern already used for caller rows,
  `client/INSIGHTS.md` MonoLink note; `githubPrUrl` exists at
  `client/src/lib/github-urls.ts:16`) showing `#{pr_number} {title}`, plus a muted
  caption line `{author} · {N} shared file(s)`.
- No hook change: `useBlastRadius` (`client/src/lib/hooks/brief.ts:30`) returns
  `BlastRadius`, which auto-gains `prior_prs` from the vendored contract edit.
- `styles.ts`: add `priorPrs*` style objects (section wrapper, row, caption) mirroring
  the existing compact idioms.
- `blast.json`: add a `priorPrs` namespace — `title`, `overlap` (`"{count} shared file(s)"`),
  `by` (`"by {author}"`). Single-locale edit (`ls client/messages/` = only `en/`,
  `client/INSIGHTS.md` 2026-07-07 note).

### 4.6 mcp-server — no code change (verify only)

`mcp-server/src/tools/get-blast-radius.ts:24` uses `outputSchema: BlastRadius.shape`
and `mcp-server/src/schemas.ts:167` re-exports `BlastRadius` from `@devdigest/shared`,
which `mcp-server/tsconfig.json:22` aliases directly to `server/src/vendor/shared` (not
a third vendored copy). `client.blast()` (`mcp-server/src/http/client.ts:94`) returns
`Promise<BlastRadius>` and passes `structuredContent` verbatim. So `prior_prs` flows
through both the outputSchema and the payload automatically — the only work is
confirming typecheck + tests stay green.

## 5. Parallelizable Tasks

Package boundaries are disjoint (`server/**` vs `client/**` vs `mcp-server/**`); the one
cross-cutting hazard is the dual-vendored `brief.ts`, isolated into **T-CONTRACT** which
runs first and blocks everything.

| Task | Module | Files owned (`file:line` anchors) | Skills to apply | Acceptance criteria | Tests to run | Depends-on | Batch |
|------|--------|-----------------------------------|-----------------|---------------------|--------------|------------|-------|
| **T-CONTRACT** **[shared: two-file edit]** | shared | `server/src/vendor/shared/contracts/brief.ts:16-44,64-78` + `client/src/vendor/shared/contracts/brief.ts:16-44,64-78` | zod, typescript-expert | In BOTH files, byte-identically: (1) move the `PrHistoryItem`+`PrHistory` block (`:64-78`) to ABOVE the Blast-radius block (before `:16`) so `PrHistoryItem` is defined before use; (2) add `prior_prs: z.array(PrHistoryItem)` to `BlastRadius` (`:39-44`), after `summary`, as a REQUIRED (non-optional) field. No other contract touched. `PrHistoryItem` kept as the single reused type (still referenced by `PrBrief.history`). Verify both files stay identical (matching `git diff` blob hashes, `INSIGHTS.md:56`). `cd server && pnpm typecheck` fails ONLY where producers don't yet emit `prior_prs` (expected — fixed by T-MAPPER/T-SERVICE); `cd client && pnpm typecheck` clean. | `cd server && pnpm typecheck` (expect producer errors until T-MAPPER/T-SERVICE) · `cd client && pnpm typecheck` | — | — (shared; alone) |
| **T-REPO** | server (reviews) | `server/src/modules/reviews/repository/pull.repo.ts:50-55` (add `priorPrsTouchingFiles`) + `server/src/modules/reviews/repository.ts:43-45` (expose on `ReviewRepository`) | drizzle-orm-patterns, postgresql-table-design, onion-architecture, typescript-expert | Add `priorPrsTouchingFiles(db, workspaceId, repoId, currentPrId, changedFiles: string[]): Promise<PrHistoryItem[]>`. Returns `[]` when `changedFiles` is empty. Else `innerJoin` `pullRequests`↔`prFiles` where `workspaceId`+`repoId` match, `ne(pullRequests.id, currentPrId)`, `inArray(prFiles.path, changedFiles)`; group rows in JS by PR id, collecting a distinct sorted `files_overlap`. Map each PR → `PrHistoryItem`: `pr_number=number`, `title`, `author`, `merged_at = (updatedAt ?? openedAt)?.toISOString() ?? ''` (documented "last activity" proxy — NO strict `status==='merged'` filter, since no merge column exists, §4.3), `notes = ''` (reserved). Sort by `(updatedAt ?? openedAt)` DESC, tie-break `pr_number` DESC; cap to `const MAX_PRIOR_PRS = 10` (doc-comment cites `repo-intel/constants.ts:37,47` capping precedent). Exposed as `ReviewRepository.priorPrsTouchingFiles(...)`; no existing signature changed. | `cd server && pnpm typecheck` (grep own filenames; whole-project may show T-SERVICE errors until it lands) · `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | T-CONTRACT | SRV-CORE |
| **T-MAPPER** | server (blast) | `server/src/modules/blast/contract.ts:16-22` (`emptyBlastRadius`), `:98-102` (`blastResultToContract` return) | typescript-expert, onion-architecture | Add `prior_prs: []` to the object returned by BOTH `emptyBlastRadius` and `blastResultToContract` so each satisfies the now-required `BlastRadius.prior_prs`. Mapper stays PURE — no DB, no `this`, no PR awareness; the `[]` is a placeholder the service overwrites. No other logic changed; existing per-symbol cap / endpoint attribution untouched. | `cd server && pnpm typecheck` (grep own filename) | T-CONTRACT | SRV-CORE |
| **T-SERVICE** | server (blast) | `server/src/modules/blast/service.ts:25-35` | onion-architecture, typescript-expert | In `getBlastRadius`, after resolving `pull` + `changedFiles`, fetch `repoIntel.getBlastRadius(pull.repoId, changedFiles)` and `reviewRepo.priorPrsTouchingFiles(workspaceId, pull.repoId, prId, changedFiles)` via `Promise.all`; return `{ ...blastResultToContract(result), prior_prs }`. Empty `changedFiles` yields `prior_prs: []` (repo returns `[]`). Does NOT edit `contract.ts` (spread supplies real data over the `[]` default). Cross-workspace 404 behavior via the existing `getPull` guard is preserved. `cd server && pnpm typecheck` fully clean once this + T-REPO + T-MAPPER coexist. | `cd server && pnpm typecheck` · `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` | T-CONTRACT, T-REPO, T-MAPPER | — |
| **T-SERVER-IT** | server (test) | `server/test/blast.it.test.ts` | drizzle-orm-patterns, typescript-expert | Extend the existing suite. Seed one repo + a "current" PR with `pr_files` and 2-3 OTHER PRs (via the existing `setupRepoAndPr` helper / direct inserts) with varying `pr_files` overlap + distinct `updatedAt`. Assert `GET /pulls/:id/blast` `prior_prs`: (a) includes exactly the other PRs sharing ≥1 file, EXCLUDES the current PR (self) and PRs with zero overlap; (b) each entry's `files_overlap` = the intersection with the current PR's files; (c) ordered by recency (`updatedAt` DESC); (d) `merged_at` populated from the seeded timestamp (or `''` when null); (e) capped at 10 when >10 overlapping PRs are seeded; (f) `prior_prs: []` when the PR has no `pr_files`. DB-backed ⇒ filename stays `.it.test.ts`. Mutation-worthy: the self-exclusion `ne(...)`, the overlap `inArray`, the cap. | `cd server && pnpm exec vitest run .it.test` (Docker) | T-SERVICE | — |
| **T-CLIENT-CARD** | client | `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.tsx:287` (new section before `disclaimerFooter`), `.../BlastRadiusCard/styles.ts` (add `priorPrs*` styles) | react-best-practices, frontend-architecture, next-best-practices | Render a "Prior PRs touching these files" section ONLY when `blast.prior_prs.length > 0`, wrapped with `data-testid="blast-prior-prs"` (so tests scope via `within`, avoiding ambiguous queries — `client/INSIGHTS.md` 2026-07-07). One row per prior PR: `MonoLink href={repoFullName ? githubPrUrl(repoFullName, p.pr_number) : undefined}` (import `githubPrUrl` from `@/lib/github-urls`) rendering `#{pr_number} {title}` as ONE template-string child; a muted caption rendering `{`${p.author} · ${t("priorPrs.overlap", { count: p.files_overlap.length })}`}` as ONE text node (single-text-node rule, `client/INSIGHTS.md`); render `p.notes` only when truthy. Header via `SectionLabel`/label using `t("priorPrs.title")`. No hook change. | `cd client && pnpm typecheck` | T-CONTRACT | CLIENT |
| **T-CLIENT-I18N** | client | `client/messages/en/blast.json:47` (add `priorPrs` namespace) | typescript-expert | Add a `priorPrs` object: `title` ("Prior PRs touching these files"), `overlap` ("{count} shared file(s)"), and any label the card references (`by` if used). Single-locale edit (only `en/` exists). Keys must exactly match the `t("priorPrs.*")` calls in T-CLIENT-CARD. Valid JSON. | `cd client && pnpm typecheck` | T-CONTRACT | CLIENT |
| **T-CLIENT-TEST** | client | `client/src/app/repos/[repoId]/pulls/[number]/_components/BlastRadiusCard/BlastRadiusCard.test.tsx` | react-testing-library, react-best-practices | Extend the existing suite (mocks `useBlastRadius`/`useRepoIntelStatus`). Add a fixture with a non-empty `prior_prs` (e.g. one entry `{ pr_number: 482, title, author, merged_at, files_overlap: ['src/config.ts'], notes: '' }`); assert the section renders, the PR link has the right `href` (`getByRole("link", { name })` → `githubPrUrl`), the overlap caption text renders (scope via `within(screen.getByTestId("blast-prior-prs"))` to avoid collisions with other `X file(s)`/count strings), and that a fixture with `prior_prs: []` renders NO prior-PRs section. Use `fireEvent` (not `user-event`, not installed). | `cd client && pnpm test` | T-CLIENT-CARD, T-CLIENT-I18N | — |
| **T-MCP-VERIFY** | mcp-server | (no files owned — verification only) refs: `mcp-server/src/tools/get-blast-radius.ts:24,51`, `mcp-server/src/schemas.ts:167`, `mcp-server/src/http/client.ts:94` | typescript-expert | Confirm NO code edit is needed: `prior_prs` flows through `outputSchema: BlastRadius.shape` and the `client.blast()` passthrough because `mcp-server` aliases `@devdigest/shared` to `server/src/vendor/shared` (`tsconfig.json:22`). Acceptance = `cd mcp-server && pnpm typecheck` clean AND `cd mcp-server && pnpm test` green with ZERO changes to any `mcp-server/**` file (confirm via `git status mcp-server`). | `cd mcp-server && pnpm typecheck && pnpm test` | T-CONTRACT | — |

**Batch notes.** `SRV-CORE` = {T-REPO, T-MAPPER}: same package, disjoint files (reviews
repo vs blast mapper), both depend only on T-CONTRACT, no interdep, no shared-contract
edit → one implementer spawn. `CLIENT` = {T-CLIENT-CARD, T-CLIENT-I18N}: same package,
disjoint files (`.tsx`/`styles.ts` vs `blast.json`), both depend only on T-CONTRACT →
one spawn. T-CONTRACT (shared), T-SERVICE (depends on SRV-CORE), T-SERVER-IT (depends on
T-SERVICE), T-CLIENT-TEST (depends on CLIENT), T-MCP-VERIFY run alone.

**Wave ordering:** Wave 0 = {T-CONTRACT} → Wave 1 = {SRV-CORE, CLIENT, T-MCP-VERIFY} →
Wave 2 = {T-SERVICE, T-CLIENT-TEST} → Wave 3 = {T-SERVER-IT}.

## 6. Testing Strategy (per-module commands)

- **Server unit** (mapper/repo typecheck; no LLM): `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`.
- **Server integration** (testcontainers Postgres; the new prior-PR read + updated
  `GET /pulls/:id/blast`, warranted because it exercises the multi-PR `pr_files` join
  across a real DB): `cd server && pnpm exec vitest run .it.test` (Docker required) —
  covers T-SERVER-IT (`blast.it.test.ts`). No `groundFindings()` / diff-hunk landmine
  here — this is a pure DB read, not a review run.
- **Server typecheck** each task: `cd server && pnpm typecheck` (whole-project; grep your
  own filename during Waves 1-2, `server/INSIGHTS.md:44`).
- **Client**: `cd client && pnpm test` (+ `cd client && pnpm typecheck`) — covers
  T-CLIENT-CARD/I18N (typecheck) and T-CLIENT-TEST.
- **mcp-server**: `cd mcp-server && pnpm typecheck && pnpm test` (T-MCP-VERIFY) — expect
  green with zero `mcp-server/**` edits.
- **reviewer-core / e2e**: not touched (no files in either).

## 7. Risks & Mitigations

- **Contract field reordering breaks module eval** — *Medium*. Referencing
  `PrHistoryItem` before it's defined is a TDZ `ReferenceError` at import time (not just
  a typecheck error). Mitigation: T-CONTRACT explicitly moves the `PrHistoryItem`/`PrHistory`
  block above `BlastRadius`; verified by `pnpm typecheck` + the it-test actually importing
  and serializing the contract.
- **One-sided vendored edit** — *High if missed*. A `prior_prs` field on only one copy
  makes Zod reject the payload at runtime (server emits it, client schema rejects, or the
  serializer fails). Mitigation: single T-CONTRACT task edits both; blob-hash equality
  check (`INSIGHTS.md:56`).
- **`merged_at` semantics** — *Medium*. No stored merge timestamp; a strict merged filter
  would make the feature dead-on-arrival on seed/dev data. Mitigation: documented decision
  to include all overlapping non-self PRs and populate `merged_at` from `updatedAt`/`openedAt`
  ("last activity" proxy); future migration flagged, not required now.
- **Required field forces all producers to emit it** — *Low*. `emptyBlastRadius` +
  `blastResultToContract` + the service must all set `prior_prs`. Mitigation: T-MAPPER
  covers the two mapper producers with `[]`; T-SERVICE supplies real data; typecheck
  catches any missed producer (it's required, not optional).
- **Ambiguous client test queries** — *Low*. Overlap-count strings can collide with other
  `{count} …` text. Mitigation: `data-testid="blast-prior-prs"` + `within(...)` scoping
  (`client/INSIGHTS.md` 2026-07-07).
- **mcp-server drift** — *Low*. Mitigation: T-MCP-VERIFY asserts green typecheck+tests
  with zero edits, catching any accidental need for change.

## 8. Success Criteria

- [ ] `BlastRadius` carries a required `prior_prs: PrHistoryItem[]` in BOTH vendored
      `brief.ts` copies (byte-identical; `PrHistoryItem` reused, not forked; block reordered
      above `BlastRadius`).
- [ ] `git diff` shows the two `vendor/shared/contracts/brief.ts` copies changed identically
      (matching blob hashes).
- [ ] `priorPrsTouchingFiles` returns other-PR file-overlap history: self excluded, deduped,
      `files_overlap` = intersection, ordered by recency, capped at 10, `[]` on no changed
      files; `merged_at` from last-activity proxy; `notes = ''`.
- [ ] `GET /pulls/:id/blast` response includes populated `prior_prs`; `blast/contract.ts`
      remains pure (service supplies the data).
- [ ] `BlastRadiusCard` renders a "Prior PRs touching these files" section (only when
      non-empty) with clickable `githubPrUrl` links; new `blast.json` keys present.
- [ ] `cd server && pnpm typecheck` clean; `cd client && pnpm typecheck` clean;
      `cd mcp-server && pnpm typecheck` clean.
- [ ] `cd server && pnpm exec vitest run .it.test` green incl. the new prior-PRs assertions
      (mutation-verified: self-exclusion, overlap filter, cap).
- [ ] `cd client && pnpm test` green incl. the new prior-PRs section test.
- [ ] `cd mcp-server && pnpm test` green with ZERO `mcp-server/**` edits (`git status`
      confirms).
