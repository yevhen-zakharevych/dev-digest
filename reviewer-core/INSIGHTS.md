# reviewer-core — INSIGHTS

Landmines & engineering insights specific to the review engine. Repo-wide ones
live in `../INSIGHTS.md`.

> Append-only. New entries go into the section that best fits. Each entry must
> be actionable cold and cite `file:line`. If it would be obvious to anyone
> reading the code, do not write it. The `engineering-insights` skill writes
> here.

## What Works

_No entries yet._

## What Doesn't Work

_No entries yet._

## Codebase Patterns

**Adding a new optional untrusted prompt slot is a 3-point edit, and the trusted "rule" text must live OUTSIDE the `wrapUntrusted` fence, not inside it.** Pattern, added for the Intent Layer's `intent` slot (`reviewer-core/src/prompt.ts:78-90` `PromptParts.intent`, `:122-123` the `intentBlock` empty/blank guard mirroring `prDescription`'s at `:117-120`, `:141-145` the `userSections.push` before `## Diff to review`, `:163` the `assembly.intent` line): (1) interface field on `PromptParts`, (2) compute a `xBlock = value?.trim() ? value : undefined` guard so `assemblePrompt` silently omits the section (the existing convention, not new), (3) push into `userSections` in the right *position relative to the diff* — order in the array is the order the model reads context, so slot placement is a deliberate call, not "append at the end". For a slot carrying a scope/behavior instruction (like `INTENT_RULE`, `:41-43`), keep the instruction text as a bare string concatenated OUTSIDE `wrapUntrusted(...)` and only the untrusted *data* goes inside the fence — mixing them (rule inside the fence) would make the model's own injection defense (`INJECTION_GUARD`) tell it to ignore the rule as "just data".

## Tool & Library Notes

_No entries yet._

## Recurring Errors & Fixes

_No entries yet._

## Session Notes

### 2026-07-04 — Intent Layer (A): hermetic tests for the `intent` prompt slot

**Testing "trusted rule sits OUTSIDE the untrusted fence" needs a position (index-based) assertion, not just a `.toContain()` — a substring check alone can't tell you which side of the fence the text landed on.** Added to `reviewer-core/test/prompt.test.ts` a test that compares `user.indexOf(INTENT_RULE)` against `user.indexOf('<untrusted source="intent">')` (and the paired `</untrusted>` close) to prove `INTENT_RULE` is outside and the intent data is inside. Verified this is non-vacuous by temporarily moving `INTENT_RULE` inside the `wrapUntrusted(...)` call at `prompt.ts:141-145` — the test went red (`expected 63 to be less than 35`) — then reverted; a plain `toContain(INTENT_RULE)` would have stayed green through that regression since the rule text is still present in the string, just on the wrong side of the fence.

**The blank-string omit guard (`parts.intent && parts.intent.trim().length > 0`, `prompt.ts:122-123`) is a real behavior, not incidental — a bare truthy check on `parts.intent` lets a whitespace-only string leak an empty `## Intent (constrains your review)` section into the prompt.** Confirmed by weakening the guard to `parts.intent ? parts.intent : undefined` — the "omits when blank" test (intent: `'   '`) went red, showing the section rendered with an empty untrusted body. This mirrors the same guard already used for `prDescription` (`prompt.ts:117-120`); worth keeping the two guards symmetric if either is ever touched.

## Open Questions

_No entries yet._
