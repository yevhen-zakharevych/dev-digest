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

_No entries yet._

## Tool & Library Notes

**`Severity` type is duplicated with different shapes — always import from `@devdigest/shared` for finding code.**
- `client/src/vendor/shared/contracts/findings.ts:11` exports `Severity = "CRITICAL" | "WARNING" | "SUGGESTION"` (3 values; the runtime finding shape).
- `client/src/vendor/ui/primitives/tokens.ts:3` exports a same-named `Severity = "CRITICAL" | "WARNING" | "SUGGESTION" | "INFO"` (4 values; UI tokens map for `SEV`/`SeverityBadge`).
- Importing the UI variant when the value comes from `FindingRecord.severity` triggers TS2322 like `Type '"INFO"' is not assignable to ...` from the consuming side and the same error inverted on producer sides. The error message points at the wrong line.
- Rule of thumb: code that reads/writes `FindingRecord` or builds `Record<Severity, …>` keyed by it must use `@devdigest/shared`'s `Severity`. UI presentation helpers that index `SEV[...]` can still use the UI type as long as they don't cross the boundary.

## Recurring Errors & Fixes

_No entries yet._

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

## Open Questions

_No entries yet._
