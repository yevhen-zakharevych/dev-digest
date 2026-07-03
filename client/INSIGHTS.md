# client — INSIGHTS

Landmines & engineering insights specific to the web app. Repo-wide ones live
in `../INSIGHTS.md`.

> Append-only. New entries go into the section that best fits. Each entry must
> be actionable cold and cite `file:line`. If it would be obvious to anyone
> reading the code, do not write it. The `engineering-insights` skill writes
> here.

## What Works

_No entries yet._

## What Doesn't Work

_No entries yet._

## Codebase Patterns

**A "may not exist yet" DB-backed resource is typed `api.get<T | null>(...)`, not `api.get<T>(...)`.** `usePullDetail` (`client/src/lib/hooks/core.ts:114-120`) always has a row so it types the plain `PrDetail`. `usePrIntent` (`client/src/lib/hooks/brief.ts`) hits `GET /pulls/:id/intent`, which returns `null` before the first classification runs — typing it `api.get<PrIntentRecord | null>(...)` (not `PrIntentRecord`) lets the consuming component branch on "not computed yet" vs a loading/error state without a cast. Same shape will recur for any lazily-computed per-PR artifact (e.g. the sibling `risk_brief` feature) — check whether the GET can legitimately return `null` before assuming the non-null contract type.

## Tool & Library Notes

**`Severity` type is duplicated with different shapes — always import from `@devdigest/shared` for finding code.**
- `client/src/vendor/shared/contracts/findings.ts:11` exports `Severity = "CRITICAL" | "WARNING" | "SUGGESTION"` (3 values; the runtime finding shape).
- `client/src/vendor/ui/primitives/tokens.ts:3` exports a same-named `Severity = "CRITICAL" | "WARNING" | "SUGGESTION" | "INFO"` (4 values; UI tokens map for `SEV`/`SeverityBadge`).
- Importing the UI variant when the value comes from `FindingRecord.severity` triggers TS2322 like `Type '"INFO"' is not assignable to ...` from the consuming side and the same error inverted on producer sides. The error message points at the wrong line.
- Rule of thumb: code that reads/writes `FindingRecord` or builds `Record<Severity, …>` keyed by it must use `@devdigest/shared`'s `Severity`. UI presentation helpers that index `SEV[...]` can still use the UI type as long as they don't cross the boundary.

## Recurring Errors & Fixes

_No entries yet._

## Codebase Patterns (continued)

**`SectionLabel`'s `right` prop is the idiom for an inline header action — don't wrap it in a custom flex row.** `client/src/vendor/ui/primitives/SectionLabel.tsx:7-11,28` accepts `right?: React.ReactNode` and renders it `marginLeft: auto` beside the uppercase label. Already used this way at `client/src/app/repos/[repoId]/pulls/[number]/_components/FindingsTab/FindingsTab.tsx:153-158` (a muted caption) and now for `IntentCard`'s "Recompute" button (`client/src/app/repos/[repoId]/pulls/[number]/_components/IntentCard/IntentCard.tsx`, `<SectionLabel icon="Target" right={recomputeButton}>`). Building a separate `display:flex; justify-content:space-between` wrapper around `SectionLabel` + an action element is redundant — pass the action as `right` instead.

**`Button`'s `loading` prop already swaps in an animated `RefreshCw` icon and disables the button — don't hand-roll a spinner/disabled ternary.** `client/src/vendor/ui/primitives/Button.tsx:18,24,71`: `loading={mutation.isPending}` is sufficient for the icon+disabled state; only the button LABEL text still needs a ternary (e.g. `recompute.isPending ? t("recomputing") : t("recompute")`) since the component has no separate "loading label" slot.

**A card whose data hook expects a non-nullable id (e.g. `usePrIntent`/`useRecomputeIntent`, `prId: string | number`) should keep that prop non-nullable and let the ROUTE-LEVEL parent guard on `!= null` before rendering — don't loosen the card's own prop type.** `client/src/app/repos/[repoId]/pulls/[number]/page.tsx:36`'s local `prId` is `string | null` (resolved from the `usePulls` list by PR number before the PR row itself has loaded), threaded through `OverviewTab` which does the guard: `client/src/app/repos/[repoId]/pulls/[number]/_components/OverviewTab/OverviewTab.tsx:16` — `{prId != null && <IntentCard prId={prId} />}`. `DiffTab` (`client/src/app/repos/[repoId]/pulls/[number]/_components/DiffTab/DiffTab.tsx:11`) is a deliberate counter-example: it types `prId: string | null` directly because its hooks (`usePrComments`/`useCreatePrComment`) are designed to no-op on null. Check whether the underlying hook tolerates `null` before choosing which pattern to follow for a new card.

## Session Notes

### 2026-06-25 — Cost & Tokens Surfacing

**Test factories must include EVERY required field of a Zod-inferred shape — the type error is misleading.**
After adding `cost_usd: z.number().nullable()` to `RunSummary` (`src/vendor/shared/contracts/trace.ts`), `RunHistory.test.tsx` failed to typecheck with:
> `Type '...' is not assignable to type '...'. Two different types with this name exist, but they are unrelated. Types of property 'cost_usd' are incompatible.`

That "two different types" wording sounds like a duplicate-vendoring problem (and the codebase DOES have two vendored shareds — see root INSIGHTS), but here it was a red herring: the factory `run(o: Partial<RunSummary>)` returned an object literal whose `...o` spread couldn't guarantee `cost_usd: number | null` (it allowed `undefined`). Fix is mundane: add `cost_usd: null` to the factory defaults at `RunHistory.test.tsx:17–35`. **Do NOT type-coerce or widen the prop type** — every factory like this in the codebase needs the same defaults treatment when a non-optional field is added to its target schema.

**When a leaf renders from `ReviewRecord` but needs `RunSummary` data, lift the lookup to the parent — don't refetch.**
`ReviewRunAccordion` renders one persisted review (no cost field — cost lives on the run). To show the per-review cost badge in its header, the cleanest pattern is for the parent (`FindingsTab`, which already fetches both `reviews` and `prRuns`) to do the join at render time and pass the matched run down:
```tsx
<ReviewRunAccordion
  review={review}
  run={prRuns?.find((r) => r.run_id === review.run_id) ?? null}
  …
/>
```
See `FindingsTab/FindingsTab.tsx:158` and `ReviewRunAccordion/ReviewRunAccordion.tsx:30`. The leaf stays render-only; no new hook, no duplicate fetch. Same pattern applies whenever a denormalized run-level field needs to appear on a review-level UI.

### 2026-06-29 — Skills page + custom body editor (L02)

**`Modal` renders children at zero padding — every modal body must own its `padding`. Easy to miss because the title + footer ARE padded.**
`client/src/vendor/ui/kit/Modal.tsx:60` is literally `<div style={{flex:1, overflow:auto}}>{children}</div>`. The title bar (`padding:"18px 24px"`) and footer (`padding:"16px 24px"`) have padding, which makes a fresh modal look fine UNTIL you put a form inside and the inputs visually touch the left/right edges. Convention: wrap the form in `<div style={{padding:"20px 24px 24px", display:"flex", flexDirection:"column", gap:16}}>` (see `CreateSkillModal/CreateSkillModal.tsx:67` and `ImportSkillModal/ImportSkillModal.tsx`). Do NOT add the padding inside the Modal kit — other call sites (e.g. confirm dialogs) want zero-padded children.

**Custom textarea with a line-number gutter is ~70 lines and zero deps — reach for it before pulling in CodeMirror/Monaco for read/edit-with-numbers UX.**
The skill body editor needed line numbers, monospace, "unsaved" indicator, and a token counter. CodeMirror is ~150KB minified, Monaco ~3MB. The component at `client/src/app/skills/_components/SkillEditor/_components/ConfigTab/BodyEditor.tsx` is a sibling `<div>` gutter + `<textarea>`, kept in sync by `onScroll → gutterRef.scrollTop = taRef.scrollTop`. Both share `font-family: var(--font-mono)`, `font-size: 13`, `line-height: 20`. The textarea owns the scrollbar; the gutter sets `overflow: hidden` and is positioned manually. Use this pattern when you need "rendered like code" but **don't** need syntax highlighting, autocomplete, or multi-cursor. Cheap token approximation lives in the same file: `approxTokens(text) = max(1, round(len/4))` — good enough for a live UI counter; real tiktoken stays server-side.

**A subtitle on the left rail of a side-by-side list breaks when the column is narrow — drop it before adding `white-space: nowrap` workarounds.**
`SkillsListView` originally had a header row with `<title>+<subtitle>` block beside the search input and Add button. At `width: 380px` the title block collapsed below ~80px, which made the subtitle word-wrap one character per line (each character on its own line — the entire text rendered vertically). Fix at `SkillsListView/styles.ts` was to drop the subtitle and lay header as `[h1 | Add]` row + `[search]` row below. The new design has no subtitle either — confirms the simpler IA. Lesson: when the list rail is narrow (<420px) and contains a search/cta, kill the subtitle instead of forcing flex shrink.

**A linked-skills row uses HTML5 drag-and-drop directly because `react-dnd` would be overkill — the snippet is ~6 lines and is the recurring pattern for "lightweight reorder a small list" UIs.**
`SkillsTab/SkillsTab.tsx` reorders the agent's linked skills with `draggable + onDragStart + onDragOver + onDrop`, passing the source index through `dataTransfer.setData("text/plain", String(i))`. On drop, splice the array and call `setSkills.mutate({skillIds: …})`. The mutation hits `POST /agents/:id/skills` with `{skill_ids}` which under the hood preserves per-link `enabled` (see server INSIGHTS 2026-06-29 entry on the agent-skills repo). Use this pattern for any small ordered list where the items are tall enough to grab; for >50 items consider `dnd-kit`.

### 2026-06-29 — Conventions Extractor (L02)

**`activeScanId` is ephemeral React state — lost on page reload while a scan is running.**
`ConventionsListView` stores the current scan ID in `useState`, which evaporates on navigation or reload. After reload, `latestScan.data?.status === 'running'` remains true (the server knows the job is running), the spinner shows, but no SSE events flow because `useRunEvents` receives an empty array. Fix: add a `useEffect` that seeds `activeScanId` from `latestScan.data.scan_id` whenever the scan status is `'running'` and `activeScanId` is not yet set (`client/src/app/conventions/_components/ConventionsListView/ConventionsListView.tsx:52`). The same pattern applies to any page that drives SSE from a background job stored on the server.

### 2026-07-04 — Intent Layer client tests (D1 + D2)

**A component whose data comes from a `lib/hooks/<domain>.ts` TanStack hook is tested by `vi.mock`-ing the hooks module, NOT by standing up a real `QueryClientProvider` + fetch mock — there is no MSW/network-mock precedent anywhere in `client/`.** Confirmed via `grep -rln "fetch" client/src --include="*.test.tsx"` returning zero hits before this session. `RunStatus.test.tsx:6-8`, `FindingsPanel.test.tsx:7-9`, and `RunReviewDropdown.test.tsx:7-14` all `vi.mock` the exact hook-module specifier the component imports (e.g. `vi.mock("../../../../../lib/hooks/reviews", () => ({ useRunEvents: () => (...) }))`), then set per-test `mockReturnValue`/`mockImplementation` to drive loading/data/pending states. `IntentCard.test.tsx` follows suit: `vi.mock("@/lib/hooks/brief", () => ({ usePrIntent: vi.fn(), useRecomputeIntent: vi.fn() }))`, controlled per-test via `vi.mocked(usePrIntent).mockReturnValue(...)`. Reach for a real `QueryClientProvider` + fetch stub only when the test's actual subject IS the hook itself (see next entry) — not when testing a consuming component.

**`@testing-library/user-event` is not an installed devDependency in `client/package.json`, despite the `react-testing-library` skill recommending it over `fireEvent`.** Importing it throws a Vite "Failed to resolve import" error at collection time (not a normal assertion failure — the whole suite file fails to load). The two existing tests that simulate clicks, `FindingCard.test.tsx:55,57` and `RunTraceDrawer.test.tsx:52`, both use `fireEvent.click(...)` directly from `@testing-library/react`. Any new interactive component test must follow `fireEvent`, not silently add the `user-event` package (that would be a non-test-file/package.json change outside a test-writer's scope).

**`client/src/lib/hooks/` had zero test files before this session — `brief.test.tsx` is the first, and it's the one case that DOES need a real `QueryClientProvider` + `vi.stubGlobal("fetch", ...)`.** Because the hook itself (`usePrIntent`/`useRecomputeIntent` in `client/src/lib/hooks/brief.ts:10-32`) is the subject under test, mocking it out would test nothing — instead stub `global.fetch` to return a `Response`-shaped object (`{ ok, status, json: async () => body }`) matching what `src/lib/api.ts`'s `apiFetch` expects, and assert the exact URL/method it was called with (`http://localhost:3001/pulls/pr1/intent`, the `API_BASE` default). For the `invalidateQueries` assertion, build one `QueryClient` instance per test and `vi.spyOn(qc, "invalidateQueries")` on that SAME instance passed into the `QueryClientProvider` wrapper — a helper that constructs a fresh `QueryClient` per hook render (rather than once, captured and reused) will never see the spy invoked, since `useMutation`'s `onSuccess` closes over whichever client `useQueryClient()` resolved inside the wrapper, not the one the spy was attached to if they differ.

**Mutation sanity-check (3 mutations, all confirmed red, all reverted cleanly):** relaxing `IntentCard.tsx`'s `in_scope.length > 0` to `>= 0` breaks the empty-array em-dash test (it renders an empty `<ul>` instead of "—"); replacing the Recompute button's `onClick={() => recompute.mutate({ prId })}` with a no-op breaks both recompute tests (`mutate` never called); changing `useRecomputeIntent`'s `invalidateQueries({ queryKey: ["intent", prId] })` to a wrong key breaks the hook test's exact-match assertion. `git diff --stat` on the two touched product files showed no diff after each revert, confirming the working tree returned to its pre-mutation state.

## Open Questions

_No entries yet._
