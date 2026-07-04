# Development Plan — Smart Diff

> Status: **PLANNED (2026-07-04, `lesson-03`).** Ready to hand to the implementer fleet.
> Lesson: L03 (companion to the Intent Layer). Planned via researcher + planner subagents.
>
> **Key finding that shapes everything below:** the entire wire contract already
> exists and is byte-identical in both vendored copies (`SmartDiff`,
> `SmartDiffGroup`, `SmartDiffFile`, `ProposedSplit`, `SmartDiffResponse`) — so
> **there is NO shared-contract two-file edit in this feature.** We compose
> already-computed data into that frozen shape; we do not touch it. This is the
> same "the lesson was pre-scaffolded" pattern as Intent Layer (`INSIGHTS.md:60`).

## 1. Overview

Smart Diff lays a PR's changed files out by **risk role** — `core` (business
logic) first, `wiring` (configs/index files) next, `boilerplate`
(lockfiles/dist/snapshots) last and collapsed — so a reviewer's attention lands
on logic, not lockfiles. It is **fully deterministic: no LLM call at this step.**
The expensive review LLM call already ran; Smart Diff just composes the
already-persisted `pr_files` + the latest review's already-persisted `findings`
into the existing `SmartDiff` contract, on read. A `GET /pulls/:id/smart-diff`
endpoint returns that shape; a new route-local `SmartDiffViewer` renders the
grouped sections with per-file "N findings" badges that jump to the line, behind
a **Smart order / Original order** toggle in the existing Files tab.

## 2. Requirements

- **Classification (deterministic, path/pattern only):** each PR file → `core` /
  `wiring` / `boilerplate`. **Thresholds and pattern lists MUST live in a
  separate constants file** (`smart-diff.constants.ts`). Classifier is a pure
  function; it does NOT depend on repo-intel / `file_rank`.
- **Endpoint `GET /pulls/:id/smart-diff`:** deterministic, workspace-scoped, **no
  LLM call**. Take files from `pr_files`, findings from the latest review, compose
  the `SmartDiff` shape. Compute-on-read; **no persistence** (see §3, §9-assumption).
- **`split_suggestion` (in scope, deterministic):** `total_lines` = churn
  (additions+deletions) summed over `core`+`wiring` files **only** (boilerplate
  excluded); `too_big` = `total_lines > SPLIT_TOO_BIG_LINES` (threshold in the
  constants file); `proposed_splits` = group core+wiring files by top-level path
  segment, emitted only when `too_big` (else `[]`).
- **`finding_lines`:** for each file, the sorted, de-duplicated new-side line
  numbers of the **latest review's** findings whose `.file === path` (each finding
  contributes its inclusive `start_line..end_line` range).
- **`pseudocode_summary`:** left `null` this lesson — no zero-LLM per-file source
  exists (see §11 Q1). Never triggers a new LLM call.
- **Component `SmartDiffViewer`:** grouped sections (Core / Wiring / Boilerplate);
  boilerplate collapsed by default; a **Smart order vs Original order** toggle in
  the Files tab (default: Smart order).
- **Clickable per-line severity badges + deep-link (added requirement).** On each
  diff line that has a finding, render a real `SeverityBadge` (🔴 CRITICAL / 🟡
  WARNING / 💡 SUGGESTION) carrying the finding's actual severity. **Clicking a
  badge navigates to the Findings tab and auto-expands + highlights + scrolls to
  that exact `FindingCard`, with NO hard reload**, via a `?tab=findings&findingId=<id>`
  URL search param (shallow `router.replace`, the repo's established param idiom).
  The per-line severity/id data is joined **on the client** from the already-loaded
  `usePrReviews` findings — the `SmartDiff` contract (`finding_lines: number[]`,
  no severity/id) is NOT extended (frozen; §3). See §5 "Deep-link".
- Reuse the existing diff primitives (`parsePatch`, `CodeLine`) — do not reinvent
  patch rendering. Add the two missing i18n toggle strings.
- Grounding gate and reviewer prompt are untouched (this feature never reviews).

## 3. Relevant repo insights (must respect)

1. **Parallel implementers share one working tree — safety is by disjoint file
   ownership only** (`INSIGHTS.md:27`). No two tasks in a wave may own the same
   file. Enforced by the "Files owned" column in §7.
2. **Dual-vendored `shared` = every contract change is a two-file edit**
   (`INSIGHTS.md:37-40`). Here it is a *non-edit*: `brief.ts:81-113` and
   `review-api.ts:63-65` are already present and byte-identical in both
   `server/src/vendor/shared/**` and `client/src/vendor/shared/**` (verified). The
   plan deliberately contains **no contract task** — any implementer who feels
   tempted to "add a field" (e.g. severity on `finding_lines`) must STOP: that
   would be a two-file edit and is out of scope.
3. **`@testing-library/user-event` is NOT installed in `client/`; interactive
   tests use `fireEvent`** (`client/INSIGHTS.md:87`); and **a component fed by a
   `lib/hooks/*` TanStack hook is tested by `vi.mock`-ing that hook module, not by
   standing up a real `QueryClientProvider`** (`client/INSIGHTS.md:85`). Both
   govern the C2 test card. Adding the `user-event` package is out of scope.

Supporting insights folded into task cards below: the "may-not-exist-yet → typed
`T | null`" pattern (`client/INSIGHTS.md:21`) — Smart Diff is the **non-null**
counter-case (it always computes, even for a PR with no review → empty
`finding_lines`), so the hook is typed `SmartDiff`, not `SmartDiff | null`; and
Fastify `response:` schemas are opt-in, first used by `GET /pulls/:id/intent`
(`server/INSIGHTS.md:36`) — the new GET follows that precedent with
`response: { 200: SmartDiffResponse }`.

## 4. What already exists (reuse — do NOT recreate)

| Artifact | Location | Note |
|---|---|---|
| `SmartDiff` / `SmartDiffGroup` / `SmartDiffFile` / `ProposedSplit` contract | `server/src/vendor/shared/contracts/brief.ts:81-113` (+ identical client mirror) | Frozen. Verify only, never edit |
| `SmartDiffResponse = SmartDiff` | `.../contracts/review-api.ts:63-65` (both copies); client re-export `client/src/lib/types.ts:35` | Frozen |
| `getPull` / `getRepo` / `getPrFiles` / `reviewsForPull` | `ReviewRepository` (`server/src/modules/reviews/repository.ts:30-65`), impls in `repository/pull.repo.ts:29-34` + `repository/review.repo.ts:57-74` | Reuse verbatim — **no new repo method needed** |
| Deterministic DB-read endpoint template | `GET /pulls/:id/intent` (`reviews/routes.ts:149-156`) + `IntentService.getIntent` (`intent.service.ts:114-120`) | Copy the shape |
| Diff render primitives | `parsePatch` (`diff-viewer/helpers.ts:12-38`), `CodeLine` (`diff-viewer/CodeLine/`) | Reuse; new file-card wraps them |
| Count/severity badge primitives | `Badge` + `SeverityBadge` (`vendor/ui/primitives/Badge.tsx:5-88`) | `finding_lines` carries no severity → use the generic `Badge` (icon + count), NOT `SeverityBadge` |
| i18n `smartDiff` namespace | `client/messages/en/prReview.json:53-62` | Labels/large-title/`findingLines` exist; **only the two order-toggle strings are missing** |
| Client intent-hook pattern | `usePrIntent` (`client/src/lib/hooks/brief.ts:10-16`) | `useSmartDiff` sits beside it |
| PR-detail Files tab | `DiffTab` (`.../_components/DiffTab/DiffTab.tsx`) → `DiffViewer` | Host the toggle here |
| `pr_files` shape | `PrFile { path, additions, deletions, patch? }` (`contracts/platform.ts:188-194`) — **no `status` field** | Classify from path only |
| `FindingRow` fields | `file, startLine, endLine, severity, title, rationale` — **NOT `line`/`message`** | Map to new-side line ranges |

## 5. Architecture Changes (per module, per file)

### Server (`@devdigest/api`) — onion placement

Smart Diff is a **read composition over the reviews domain** (its risk signal =
findings). Per precedent, Intent Layer lived *inside* the `reviews` module rather
than the reserved standalone `smart-diff` slot, precisely because its data is
reviews-owned. Smart Diff follows suit: **new files inside `modules/reviews/`**,
reusing `ReviewRepository` — this avoids a sibling-module reaching across into the
reviews repository (an onion violation). The reserved `smart-diff` module slot
(`modules/index.ts:23`) stays reserved; no new registry entry.

- **NEW `modules/reviews/smart-diff.constants.ts`** — the mandated constants file:
  `BOILERPLATE_PATTERNS`, `WIRING_PATTERNS` (RegExp[] against the posix path /
  basename), `SPLIT_TOO_BIG_LINES`. Zero imports; pure data.
- **NEW `modules/reviews/smart-diff.classify.ts`** — pure domain helpers
  (application-layer, no I/O, no DI): `classifyRole`, `buildFindingsByFile`,
  `computeSplit`, `buildSmartDiff`. Consumes the constants; returns the frozen
  `SmartDiff` shape.
- **NEW `modules/reviews/smart-diff.service.ts`** — `SmartDiffService`
  (application service): `getSmartDiff(workspaceId, prId)`. Depends on
  `ReviewRepository` + `Container`; owns NO business rules beyond adapting
  Drizzle rows into the pure helpers' inputs. Mirrors `IntentService.getIntent`
  (workspace-scoped 404 via `repo.getPull`).
- **EDIT `modules/reviews/routes.ts:149-156`** — add `GET /pulls/:id/smart-diff`
  immediately after the intent GET, with `response: { 200: SmartDiffResponse }`
  (opt-in serializer, per `server/INSIGHTS.md:36`), delegating to
  `service.getSmartDiff`. No custom rate limit (cheap read, like the intent GET).
- **EDIT `modules/reviews/service.ts:33-39,180-197`** — construct one
  `SmartDiffService` in the `ReviewService` constructor (beside `this.intent`) and
  add a thin `getSmartDiff` delegation, keeping the `service.*` call shape uniform
  for routes.

### Client (`@devdigest/web`) — layered placement

- **EDIT `client/src/lib/hooks/brief.ts:10-16`** — add `useSmartDiff(prId)` beside
  `usePrIntent`, typed `api.get<SmartDiff>('/pulls/${prId}/smart-diff')`,
  `queryKey ["smart-diff", prId]`, `enabled: prId != null`. **Non-null** `SmartDiff`
  (endpoint always computes; contrast the `T | null` intent case,
  `client/INSIGHTS.md:21`).
- **NEW `.../pulls/[number]/_components/SmartDiffViewer/`** — route-local (single
  consumer; peer of `DiffTab`/`IntentCard`). Placement rationale: the entire
  PR-detail tab UI is route-local `_components`; the diff primitives it reuses
  still live under `src/components/diff-viewer/` (migration to `features/reviews/`
  is *pending*, `client/CLAUDE.md` migration table). Lifting to `features/reviews/`
  now would create a premature `features → components` dependency that must be
  reworked at migration time; route-local is the correct co-location today.
  - `SmartDiffViewer.tsx` — renders three grouped `<section>`s in fixed
    core→wiring→boilerplate order; boilerplate `<details>`-collapsed by default.
    Props: `{ smartDiff: SmartDiff; files: PrFile[]; findings: FindingRecord[];
    onOpenFinding: (findingId: string) => void }`. Builds a `Map<path,
    FindingRecord[]>` from `findings` (pure helper) so a diff line `newNo=N` in
    file `F` matches findings where `f.file===F && N∈[f.start_line, f.end_line]`.
  - `SmartDiffFileCard.tsx` — single-use sub-component; reuses `parsePatch` +
    `CodeLine`. On each line with a matched finding, renders a **clickable**
    `SeverityBadge` (`f.severity as UISeverity`, cast per `FindingCard.tsx:58`)
    wrapped in a `<span role="button" tabIndex={0} onClick>` (precedent
    `ReviewRunAccordion.tsx:76-92`), whose click calls `onOpenFinding(f.id)`.
    Optional non-clickable file-header count summary. Read-only (no inline
    commenting in smart order — see §9 assumptions).
  - `styles.ts`, `SmartDiffViewer.test.tsx`.
- **EDIT `.../_components/DiffTab/DiffTab.tsx:18-64`** — add the Smart/Original
  order toggle (`useState`, default `"smart"`), call `useSmartDiff(prId)` and
  `usePrReviews(prId)`; pass the latest `kind==='review'` review's `findings` +
  the `onOpenFinding` handler (threaded from `page.tsx`) into `SmartDiffViewer`
  (smart) or render the existing `DiffViewer` (original). Inline commenting stays
  on the Original-order path.
- **EDIT `client/messages/en/prReview.json:53-62`** — add `smartOrder`,
  `originalOrder` (and, if referenced, `findings` badge label) under the existing
  `smartDiff` namespace. `en` is the only locale.

### Deep-link: Smart Diff badge → Findings tab → expanded FindingCard (no reload)

The click side (SmartDiff) and the receive side (Findings) communicate **only
through the URL search param `?findingId=`** — no shared React state. Almost every
piece already exists; the only genuinely new code is a controlled force-expand on
`FindingCard` (mirroring the proven accordion mechanism one level down).

- **EDIT `.../pulls/[number]/page.tsx:60-68,139-171`** — (a) read
  `findingId = search.get("findingId")`; (b) add `handleOpenFinding(id)` that sets
  **both** `tab=findings` and `findingId=id` in a single `URLSearchParams` clone +
  `router.replace` (reuse the existing `setParam` shape; a two-key variant so the
  tab switch + target land in one shallow nav), and bumps an in-memory `nonce`
  (so re-clicking the same finding re-triggers); (c) pass `onOpenFinding=
  {handleOpenFinding}` down through `DiffTab`, and pass `findingId`+`nonce` into
  `FindingsTab`.
- **EDIT `.../_components/FindingsTab/FindingsTab.tsx:66-83,169-181`** — given
  `findingId`, resolve it across `runs[].findings` → `finding.review_id` →
  `review.id` → `review.run_id`, and feed that `run_id` into the **existing**
  `targetRunId`/`targetNonce` props of `ReviewRunAccordion` (force-open + scroll,
  `ReviewRunAccordion.tsx:44-57`) — no new accordion mechanism. Also thread a new
  `targetFindingId`+`targetNonce` down to `FindingsPanel`.
- **EDIT `.../FindingsTab/.../FindingsPanel/FindingsPanel.tsx:28,61-73`** — pass
  `targetFindingId`/`targetNonce` to the matching `FindingCard`; ensure the
  `hideLow` confidence filter does NOT hide the deep-linked target (if the target
  finding is low-confidence, keep it visible).
- **EDIT `.../FindingsTab/.../FindingCard/FindingCard.tsx:44-58`** — add
  `targetFindingId?`/`targetNonce?` props; a `useEffect` keyed on them that, when
  `f.id === targetFindingId`, `setExpanded(true)`, `scrollIntoView` (via the
  existing `data-finding-id={f.id}` node / a ref), and applies a highlight
  (reuse/extend the existing `focused` styling flag, `FindingCard.tsx:28,36`) —
  the direct mirror of `ReviewRunAccordion.tsx:44-57`. No controlled prop exists
  today; this adds the minimal one.
- **Cold-load bonus:** because `findingId` lives in the URL, opening
  `?tab=findings&findingId=<id>` directly (shared link, refresh) runs the same
  resolve→open→expand flow on mount — deep links are shareable, not just in-session.

### Classification algorithm (authoritative spec for `smart-diff.classify.ts`)

`classifyRole(path): SmartDiffRole` — **precedence boilerplate → wiring → core**
(most-specific/lowest-value first; a lockfile inside a config dir is boilerplate):
1. if the posix path or basename matches any `BOILERPLATE_PATTERNS` → `'boilerplate'`
2. else if it matches any `WIRING_PATTERNS` → `'wiring'`
3. else → `'core'`

`BOILERPLATE_PATTERNS` (intent + representative tokens; implementer writes the
RegExps, dependency-free — no minimatch):
- lockfiles: `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `Cargo.lock`,
  `poetry.lock`, `Gemfile.lock`, `composer.lock`, `go.sum`
- build output dirs: `dist/`, `build/`, `out/`, `.next/`, `coverage/`
- vendored/generated: `node_modules/`, `vendor/`, `*.min.js`, `*.map`,
  `*.generated.*`, drizzle migration snapshots `migrations/meta/`
- snapshots: `__snapshots__/`, `*.snap`

`WIRING_PATTERNS`:
- config: `*.config.{js,ts,mjs,cjs}`, `tsconfig*.json`, `package.json`,
  `.eslintrc*`, `.prettierrc*`, `.env*`, `Dockerfile`, `docker-compose*.{yml,yaml}`,
  `.github/`, `*.yml`/`*.yaml`
- barrels/index: basename `index.ts` / `index.js`

`buildFindingsByFile(findings: {file,start_line,end_line}[]): Map<string, number[]>`
— for each finding push every integer in `[start_line, end_line]`; per file
de-duplicate + sort ascending. (New-side line numbers, matching the diff and the
grounding gate.)

`computeSplit(files: {path, additions, deletions, role}[]): SmartDiff['split_suggestion']`:
- consider only `role !== 'boilerplate'`
- `total_lines` = Σ(additions+deletions) over those
- `too_big` = `total_lines > SPLIT_TOO_BIG_LINES` (constant; default **500**)
- `proposed_splits` = when `too_big`, group those files by top-level path segment
  (first segment; a bare filename → `"(root)"`) into `ProposedSplit{name, files}`;
  else `[]`

`buildSmartDiff(files, findingsByFile): SmartDiff`:
- role each file; `finding_lines = findingsByFile.get(path) ?? []`;
  `pseudocode_summary = null`
- three groups in fixed `[core, wiring, boilerplate]` order; within each group sort
  files by `finding_lines.length` desc, then churn desc (highest-risk first)
- `split_suggestion = computeSplit(...)`

## 6. Runtime flow

```
Files tab (?tab=diff) mounts
        │
        ├─ default order = "smart"
        ▼
useSmartDiff(prId) ──► GET /pulls/:id/smart-diff
        │                     │
        │                     ▼  ReviewService.getSmartDiff → SmartDiffService.getSmartDiff
        │                        1. repo.getPull(ws, id)          (404 if not in workspace)
        │                        2. repo.getPrFiles(id)           → {path, additions, deletions}
        │                        3. repo.reviewsForPull(id)       (newest-first)
        │                             └─ first row where kind==='review' → its findings
        │                        4. buildFindingsByFile(findings)
        │                        5. buildSmartDiff(files, map)    (pure, deterministic)
        │                     ◄── SmartDiff  (NO LLM, NO persistence)
        ▼
SmartDiffViewer renders groups (+ client join of usePrReviews findings for per-line severity)
Toggle → "original" ── renders existing DiffViewer(pr.files) in GitHub order (+comments)

Deep-link (no reload):
  click severity badge on a diff line
        │  onOpenFinding(f.id)
        ▼
  page.tsx: router.replace(?tab=findings&findingId=f.id)  + bump nonce   (shallow)
        │
        ▼
  FindingsTab: findingId → finding.review_id → review.id → review.run_id
        ├─ ReviewRunAccordion(targetRunId=run_id): force-open + scroll   (reused)
        └─ FindingsPanel → FindingCard(targetFindingId=f.id): expand + highlight + scrollIntoView (new)
```

## 7. Parallelizable Tasks

Wave 0 = S1, C1 (parallel, disjoint, no deps). Wave 1 = S2, C2 (parallel, disjoint,
each depends only on its own wave-0 sibling). Wave 2 = C3 (integration + deep-link;
depends on C2 — it wires `page.tsx`/`DiffTab` to pass `onOpenFinding` into the
`SmartDiffViewer` prop C2 defines, and adds the Findings-side receive). File-ownership
check: every file appears in exactly one row (C2 owns the `SmartDiffViewer/*` render;
C3 owns all wiring + Findings-side files, incl. `DiffTab.tsx`). No shared-contract
edit exists, so no task is labeled `[shared: two-file edit]`.

| Task | Module | Files owned (with anchors) | Skills to apply | Acceptance criteria | Tests to run | Depends-on |
|---|---|---|---|---|---|---|
| **S1 — pure classifier + constants** | server (`modules/reviews`) | NEW `server/src/modules/reviews/smart-diff.constants.ts`; NEW `server/src/modules/reviews/smart-diff.classify.ts`; NEW `server/test/smart-diff-classify.test.ts` (model after sibling pure helpers `modules/reviews/intent-inputs.ts` + tests `server/test/intent-inputs.test.ts`; target shape `contracts/brief.ts:81-113`) | `onion-architecture`, `typescript-expert` | Constants file holds ALL thresholds+patterns (`BOILERPLATE_PATTERNS`, `WIRING_PATTERNS`, `SPLIT_TOO_BIG_LINES=500`); nothing hard-coded in `classify.ts`. `classifyRole` precedence boilerplate→wiring→core (lockfile→boilerplate, `*.config.ts`/`index.ts`/`package.json`→wiring, `src/foo.ts`→core). `buildFindingsByFile` expands each `[start_line,end_line]` inclusive, dedupes+sorts per file. `computeSplit`: `total_lines`=churn over core+wiring ONLY (boilerplate excluded); `too_big`=`>SPLIT_TOO_BIG_LINES`; `proposed_splits` grouped by top-level segment, `[]` when not too_big. `buildSmartDiff`: fixed core→wiring→boilerplate group order, within-group sort findings-desc then churn-desc, `pseudocode_summary=null`, returns valid `SmartDiff` (parses against the Zod schema). Pure — no DB/DI/LLM imports. | `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'` (+ `pnpm typecheck`) | — |
| **S2 — endpoint + service + delegation** | server (`modules/reviews`) | NEW `server/src/modules/reviews/smart-diff.service.ts`; NEW `server/test/smart-diff.it.test.ts`; EDIT `server/src/modules/reviews/routes.ts:149-156` (add GET after intent GET); EDIT `server/src/modules/reviews/service.ts:33-39,180-197` (construct `SmartDiffService`, add `getSmartDiff` delegation) | `onion-architecture`, `fastify-best-practices`, `drizzle-orm-patterns`, `zod`, `security`, `typescript-expert` | `GET /pulls/:id/smart-diff` returns `SmartDiff`, **NO LLM call**, no new persistence; workspace-scoped (404 when PR not in workspace, via `repo.getPull`). Route uses `response: { 200: SmartDiffResponse }` and reuses existing `ReviewRepository.getPull/getPrFiles/reviewsForPull` (adds NO repo method). "Latest review" = first `reviewsForPull(prId)` row with `kind==='review'`; its `FindingRow`s mapped `{file, startLine→start_line, endLine→end_line}` into `buildFindingsByFile`. PR with zero reviews → all `finding_lines` empty but a valid `SmartDiff` still returns. Composition delegates to S1's pure helpers (no rule logic in the service). No custom rate limit. | `cd server && pnpm exec vitest run .it.test` (Docker); `cd server && pnpm typecheck` | S1 |
| **C1 — smart-diff hook** | client (`lib/hooks`) | EDIT `client/src/lib/hooks/brief.ts:10-16` (add `useSmartDiff` after `usePrIntent`) | `frontend-architecture`, `react-best-practices`, `next-best-practices`, `typescript-expert` | `useSmartDiff(prId)` = `useQuery`, `queryKey ["smart-diff", prId]`, `queryFn: () => api.get<SmartDiff>('/pulls/${prId}/smart-diff')`, `enabled: prId != null`. Typed **non-null** `SmartDiff` (not `\| null`) — endpoint always computes; import `SmartDiff` from `@devdigest/shared`. No other export in the file is touched. | `cd client && pnpm typecheck` (+ `pnpm test`) | — |
| **C2 — SmartDiffViewer (grouped render + clickable severity badges)** | client (route-local `pulls/[number]/_components/SmartDiffViewer`) | NEW `.../SmartDiffViewer/SmartDiffViewer.tsx`; NEW `.../SmartDiffViewer/SmartDiffFileCard.tsx`; NEW `.../SmartDiffViewer/styles.ts`; NEW `.../SmartDiffViewer/SmartDiffViewer.test.tsx` | `frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`, `typescript-expert` | Props `{ smartDiff, files, findings, onOpenFinding }` (pure/presentational — no hooks/network). Renders three sections labeled from `smartDiff.{coreLabel,wiringLabel,boilerplateLabel}`; **boilerplate collapsed by default**, core+wiring expanded; group order + within-group risk order come pre-sorted from the server (render as received). Joins `SmartDiffFile.path`→`PrFile.patch`, renders via `parsePatch`+`CodeLine`. Builds a per-file finding map from `findings`; on each line where `newNo ∈ [f.start_line,f.end_line]` renders a **clickable** `SeverityBadge` (`f.severity as UISeverity`) in a `role="button"` wrapper whose click calls `onOpenFinding(f.id)`. `split_suggestion.too_big` → render `smartDiff.largeTitle/largeBody` banner with `proposed_splits`. Test with fixture `smartDiff`+`files`+`findings` (no hook/network mock); use **`fireEvent`** (user-event not installed, `client/INSIGHTS.md:87`); assert group labels render, boilerplate starts collapsed, a severity badge appears only on lines with a matching finding, and clicking it fires `onOpenFinding` with the right `f.id`. | `cd client && pnpm test` (+ `pnpm typecheck`) | C1 |
| **C3 — integration + Findings deep-link (no reload)** | client (route-local `pulls/[number]`: page + DiffTab + Findings side) | EDIT `.../pulls/[number]/page.tsx:60-68,139-171` (read `findingId`, `handleOpenFinding` sets `tab=findings`+`findingId` in one `router.replace`, bump nonce, thread down); EDIT `.../_components/DiffTab/DiffTab.tsx:18-64` (Smart/Original toggle default smart, `useSmartDiff`+`usePrReviews`, pass latest review `findings`+`onOpenFinding` into `SmartDiffViewer`); EDIT `.../_components/FindingsTab/FindingsTab.tsx:66-83,169-181` (resolve `findingId`→`review_id`→`run_id`, reuse existing `targetRunId`/`targetNonce`, thread `targetFindingId`); EDIT `.../FindingsTab/.../FindingsPanel/FindingsPanel.tsx:28,61-73` (thread `targetFindingId`; don't let `hideLow` hide the target); EDIT `.../FindingsTab/.../FindingCard/FindingCard.tsx:44-58` (add `targetFindingId`/`targetNonce` props → force-expand+scroll+highlight, mirror of `ReviewRunAccordion.tsx:44-57`); EDIT `client/messages/en/prReview.json:53-62` (add `smartOrder`/`originalOrder`) | `frontend-architecture`, `react-best-practices`, `next-best-practices`, `react-testing-library`, `typescript-expert` | Files tab has a working Smart/Original toggle (default **smart**); Original path keeps `DiffViewer` + inline commenting intact. Clicking a Smart-Diff severity badge → shallow nav to `?tab=findings&findingId=<id>` (NO hard reload) → the finding's parent `ReviewRunAccordion` force-opens + scrolls (reused mechanism) AND its `FindingCard` expands + highlights + `scrollIntoView`s. Resolution `finding.review_id→review.id→review.run_id` is correct (finding has no `run_id`). Low-confidence target is not hidden by `hideLow`. Cold-load of the URL reproduces the same open/expand on mount. Re-clicking the same finding re-triggers (nonce). Test (RTL, `fireEvent`, `vi.mock` the hooks per `client/INSIGHTS.md:85`): a badge click sets the expected params / calls the handler, and a mounted `FindingCard` with a matching `targetFindingId` renders expanded+highlighted. | `cd client && pnpm test` (+ `pnpm typecheck`); hermetic `./scripts/e2e.sh` exercises badge→Findings jump | C2 |

## 8. Testing Strategy (per-module commands)

- **S1 (server unit, hermetic):** `cd server && pnpm exec vitest run --exclude '**/*.it.test.ts'`
  — classifier precedence (lockfile/config/index/core), boilerplate-excluded
  `total_lines`, `too_big` threshold boundary, `proposed_splits` grouping + empty
  when not too_big, `finding_lines` range expansion+dedupe+sort, within-group
  risk-first sort, output parses against the `SmartDiff` Zod schema. Mutation-check
  each assertion (flip the threshold comparator, drop the boilerplate exclusion,
  swap group order) — red then revert, per the Intent-Layer test discipline
  (`server/INSIGHTS.md:62`).
- **S2 (server integration, needs Docker):** `cd server && pnpm exec vitest run .it.test`
  — seed PR + `pr_files` + a `kind==='review'` review with findings; assert
  `GET /pulls/:id/smart-diff` composes groups + `finding_lines`; assert **no LLM
  call** (mock LLM `.calls` empty, per `server/INSIGHTS.md:44,48`); PR with no
  review → valid empty-`finding_lines` `SmartDiff`; cross-workspace PR → 404. The
  service is drivable directly (`new Container` + `new ReviewRepository` + service)
  without `buildApp`, per `server/INSIGHTS.md:48`.
- **C1/C2 (client, jsdom, fetch mocked):** `cd client && pnpm test` + `pnpm typecheck`.
  SmartDiffViewer tested in isolation with fixture props (no hook/network mock
  needed); interactions via `fireEvent`.
- **Cross-cutting:** `cd server && pnpm typecheck` and `cd client && pnpm typecheck`
  to catch any accidental drift; hermetic `./scripts/e2e.sh` (no LLM) exercises the
  Files tab and the order toggle.

## 9. Assumptions / Scope decisions (explicit)

1. **`pseudocode_summary` = `null` this lesson.** No zero-LLM per-file source
   exists: `kind==='summary'` review rows carry a single review-level `summary`
   string (`review.repo.ts` insert shape), not per-file text. Generating it would
   require a new LLM call, which the feature forbids. Flagged §11 Q1.
2. **`split_suggestion` counts core+wiring only; boilerplate excluded** from
   `total_lines` and `proposed_splits` — a 5 000-line `pnpm-lock.yaml` must not
   trigger "too big, split this PR." `SPLIT_TOO_BIG_LINES` default 500, in the
   constants file. `proposed_splits` group by top-level path segment.
3. **Compute-on-read, no persistence.** The result is O(files) deterministic and
   derived entirely from already-persisted `pr_files` + `findings`; the `pr_brief`
   table has no `smart_diff` column and adding one is a migration + frozen-contract
   change for zero benefit. No DB writes.
4. **Core classifier is pure path/pattern**, independent of repo-intel. `file_rank`
   / `RepoIntelService.getFileRank` (`repo-intel/service.ts:417-422`) is noted only
   as a *future* enrichment signal; making the classifier depend on an indexed repo
   would break the "works on any PR" requirement.
5. **"Latest review" = the single newest `kind==='review'` review row.** Matches
   the ground-truth `reviewsForPull(prId)[0]`-after-filter suggestion. Multi-agent
   latest cycles therefore reflect one row's findings — flagged §11 Q2.
6. **Inline commenting stays on the Original-order path only.** Smart order renders
   read-only diff lines (keeps `SmartDiffFileCard` simple); the existing
   `DiffViewer` commenting flow is unchanged.
7. **Smart Diff lives inside `modules/reviews/`, not the reserved `smart-diff`
   module slot** — its risk signal is reviews-domain findings; a standalone module
   would have to reach into `ReviewRepository` (onion violation). Slot stays reserved.
8. **Per-line severity badges are a CLIENT-side join, not a contract field.** The
   frozen `SmartDiff.finding_lines` is `number[]` (no severity, no id) and is used
   server-side only for file risk-ordering + the optional file count. The clickable
   per-line 🔴/🟡/💡 badges read severity + `id` from the already-loaded
   `usePrReviews` findings (`FindingRecord`), joined by `file`+line range in the
   viewer. This keeps the contract untouched (§3) and reuses the exact data the
   Findings tab already renders — so a badge always maps to a real, openable
   `FindingCard`. The client join uses the newest `kind==='review'` review's
   findings, matching the server's "latest review" choice for `finding_lines`
   (assumption #5) so badges and ordering stay consistent.
9. **Deep-link reuses existing machinery; only `FindingCard`'s controlled expand is
   new.** Tab/param nav (`page.tsx` `setParam`/`router.replace`), the
   `ReviewRunAccordion` `targetRunId`/`targetNonce` force-open+scroll, and
   `FindingCard`'s `data-finding-id` DOM anchor + `focused` highlight styling all
   already exist. The feature adds a `targetFindingId`/`targetNonce` prop pair on
   `FindingCard` (mirror of the accordion's) and the `finding.review_id→run_id`
   resolution — nothing more.

## 10. Risks & Mitigations

- **Someone "improves" the frozen contract (e.g. adds severity to `finding_lines`)
  — Medium.** That is a dual-vendored two-file edit (`INSIGHTS.md:37-40`) and is
  explicitly out of scope. Mitigation: no contract task exists; §2/§3 forbid it;
  reviewers reject any diff under `vendor/shared/`.
- **Pattern list mis-buckets a real file (e.g. a hand-written `index.ts` with
  logic classed as wiring) — Low.** Deterministic and cheap to tune; mitigation:
  patterns isolated in one constants file, unit-tested, adjustable without touching
  logic. Boilerplate/wiring are additive hints, never hide files (all three groups
  render).
- **`GET` accidentally triggers an LLM call or a write — Medium.** Mitigation: S2
  it-test asserts the mock LLM `.calls` is empty and no rows are written; service
  depends only on read repo methods.
- **`response:` serializer strictness drops a nullish field — Low.** `SmartDiff`
  has no nullable top-level fields; `pseudocode_summary` is `nullish` and set to
  `null`. Mitigation: it-test round-trips the payload through the route.
- **Large finding range explodes `finding_lines` — Low.** Findings ranges are
  small in practice; dedupe+sort bounds it. Mitigation: if ever pathological, cap
  in `buildFindingsByFile` (single constants-file change).
- **Parallel tree collision — Low.** Disjoint file ownership per §7; the two
  server tasks are sequenced (S2 imports S1).

## 11. Open Questions

1. **`pseudocode_summary` source (deferred to a future lesson).** Recommend keeping
   it `null` until a zero-LLM per-file summary exists (e.g. a future blast-radius /
   symbol pass) or the feature is allowed to reuse a cached structured-review
   artifact. Do NOT add an LLM call to fill it.
2. **Multi-agent latest cycle.** Should `finding_lines` aggregate findings across
   ALL `kind==='review'` rows of the current head SHA, not just the newest row?
   That needs `agent_runs.head_sha` join semantics (`server/INSIGHTS.md:71-72`);
   deferred. Current behavior: newest single review row.
3. **Order toggle persistence.** Default is Smart order per-mount; persisting the
   user's choice (query param `?order=` like `?tab=`) is a trivial follow-up, left
   out to keep C2 scope tight.

## 12. Success Criteria

- [ ] `GET /pulls/:id/smart-diff` returns a valid `SmartDiff` with **no LLM call
  and no DB write**; workspace-scoped (404 cross-workspace); PR with no review still
  returns valid groups with empty `finding_lines`.
- [ ] Every threshold and pattern lives in `smart-diff.constants.ts`; `classify.ts`
  hard-codes nothing.
- [ ] Classification is deterministic path/pattern only, independent of repo-intel;
  precedence boilerplate→wiring→core.
- [ ] `total_lines` excludes boilerplate; `too_big`/`proposed_splits` follow the
  §5 heuristic; groups render in core→wiring→boilerplate order, risk-first within.
- [ ] `finding_lines` per file = sorted-deduped new-side ranges of the latest
  review's matching findings.
- [ ] `SmartDiffViewer` shows grouped sections, boilerplate collapsed by default;
  the Files tab has a working Smart/Original toggle (default Smart).
- [ ] Each diff line with a finding shows a clickable `SeverityBadge` (real
  severity, joined client-side from `usePrReviews` — contract NOT extended);
  clicking it shallow-navigates to `?tab=findings&findingId=<id>` (NO hard reload)
  and the matching `FindingCard` (with its parent accordion) auto-expands,
  highlights, and scrolls into view; the same URL works on cold load.
- [ ] `pseudocode_summary` is `null`; no LLM call anywhere in this feature.
- [ ] No file under `server/src/vendor/shared/**` or `client/src/vendor/shared/**`
  was edited.
- [ ] All per-task suites green; `pnpm typecheck` clean on server + client; hermetic
  e2e passes.
