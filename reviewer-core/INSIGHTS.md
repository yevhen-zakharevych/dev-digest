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

**The `@devdigest/reviewer-core` BARREL (`src/index.ts`) eagerly loads `openai` — so a PURE consumer that only needs a grounding helper must import from the `grounding.js` SUBPATH, never the barrel.** ESM re-exports are evaluated at module load, and the barrel re-exports `./llm/structured.js` + `./llm/openrouter.js` (`index.ts:40,67`), both of which `import 'openai'` at the top level. So `import { buildLineIndex } from '@devdigest/reviewer-core'` transitively loads the entire LLM stack **and its `openai` dependency** — even though `buildLineIndex`/`FULL_FILE_KINDS` live in the dependency-free `grounding.ts` (types only). This is invisible locally (reviewer-core deps are installed) but breaks any context that runs before `reviewer-core`'s deps exist: it bit `server/src/db/seed.ts` in the **e2e-web CI job**, whose step order is `pnpm db:seed` **then** `Install reviewer-core deps` — the seed pulls the pure eval `diff-freeze.ts`, which imported the barrel, and CI died with `Cannot find package 'openai' imported from reviewer-core/src/llm/structured.ts`. Fix: `diff-freeze.ts`/`scorer.ts` import `{ buildLineIndex, FULL_FILE_KINDS }` from `@devdigest/reviewer-core/grounding.js` (the wildcard alias `@devdigest/reviewer-core/*` → `../reviewer-core/src/*` exists in `server/tsconfig.json:25`, and vite's string alias prefix-matches it, so tests resolve it too). **This deliberately violates `reviewer-core/CLAUDE.md`'s "consumers never reach into subpaths" convention — and must, because honouring the barrel convention here force-loads `openai` into a pure validator.** Reproduce the failure locally before trusting a fix: `mv reviewer-core/node_modules/openai{,__hidden}` then `cd server && pnpm db:seed` — it crashes on the barrel import and succeeds on the subpath. NOTE this was a self-inflicted regression: the original L06 code used the subpath; a mid-session "tidy it to the barrel" (adding `buildLineIndex` to the barrel export) reintroduced the coupling and cost a CI run. Leave the inline comments that say why.

## Recurring Errors & Fixes

**Citation grounding's range-intersection check (`grounding.ts:41-46` `rangeIntersects`) is deliberately loose — a finding's line must fall inside SOME hunk, not the semantically-right spot — so a model that miscounts an absolute line number produces a plausible-but-wrong citation that survives grounding undetected.** Confirmed root cause of `docs/todos/finding-line-numbers-offset.md`: the model derived a finding's absolute new-file line by counting from the `@@ -oldStart,oldLines +newStart,newLines @@` hunk header itself, and it reliably skipped the leading context lines before the interesting change (reported `newStart` as if that were where the change started). Don't try to fix this at the grounding seam — there's no reliable signal there to "re-anchor" a wrong-but-in-range line to the right one. Fix it upstream instead: eliminate the counting task from the model. `review/reduce.ts` `annotateDiffLines()` prefixes every kept (context/added) line of the raw diff with its absolute new-file line number before the text ever reaches the LLM — wired into both the single-pass and map-reduce (`sliceDiff`) paths in `review/run.ts:139-158` — paired with a trusted `DIFF_LINE_NUMBER_RULE` (`prompt.ts`, same outside-the-`wrapUntrusted`-fence pattern as `INTENT_RULE`, see `Codebase Patterns` above) telling the model to copy the prefixed number verbatim instead of counting. Being a single seam in `assemblePrompt`/`run.ts` (not per-agent system-prompt text in `server/src/db/seed-prompts.ts`), it automatically covers every agent, built-in and custom.

## Session Notes

### 2026-07-04 — Intent Layer (A): hermetic tests for the `intent` prompt slot

**Testing "trusted rule sits OUTSIDE the untrusted fence" needs a position (index-based) assertion, not just a `.toContain()` — a substring check alone can't tell you which side of the fence the text landed on.** Added to `reviewer-core/test/prompt.test.ts` a test that compares `user.indexOf(INTENT_RULE)` against `user.indexOf('<untrusted source="intent">')` (and the paired `</untrusted>` close) to prove `INTENT_RULE` is outside and the intent data is inside. Verified this is non-vacuous by temporarily moving `INTENT_RULE` inside the `wrapUntrusted(...)` call at `prompt.ts:141-145` — the test went red (`expected 63 to be less than 35`) — then reverted; a plain `toContain(INTENT_RULE)` would have stayed green through that regression since the rule text is still present in the string, just on the wrong side of the fence.

**The blank-string omit guard (`parts.intent && parts.intent.trim().length > 0`, `prompt.ts:122-123`) is a real behavior, not incidental — a bare truthy check on `parts.intent` lets a whitespace-only string leak an empty `## Intent (constrains your review)` section into the prompt.** Confirmed by weakening the guard to `parts.intent ? parts.intent : undefined` — the "omits when blank" test (intent: `'   '`) went red, showing the section rendered with an empty untrusted body. This mirrors the same guard already used for `prDescription` (`prompt.ts:117-120`); worth keeping the two guards symmetric if either is ever touched.

### 2026-07-04 — Fixed the finding line-number offset bug (`docs/todos/finding-line-numbers-offset.md`)

**End-to-end fix + tests: `annotateDiffLines()` (`review/reduce.ts`) + `DIFF_LINE_NUMBER_RULE` (`prompt.ts`) + wiring in `review/run.ts:139-158`.** New `reviewer-core/test/annotate-diff.test.ts` reproduces the exact reported scenario (3 leading context lines before an added block) plus deletions, multi-hunk/multi-file cursor resets, and trailing-newline preservation. `prompt.test.ts` gained an index-based fence-position test for the new rule (same technique as the `INTENT_RULE` test at `INSIGHTS.md:35`). `run.test.ts` gained an end-to-end assertion that `outcome.assembly.user` contains the correctly-numbered `MockGitClient` diff lines. Full `reviewer-core` (38 tests) and `server` hermetic (144 tests) suites plus both typechecks pass unmodified elsewhere — confirms `UnifiedDiff.raw` (the LLM-facing text this touches) has no other consumer; grepped `server/src/modules` + `adapters` for `.raw` usage to verify the client's "Files changed" diff viewer reads from a separate data source, so annotating `.raw` doesn't touch any user-facing rendering.

## Open Questions

_No entries yet._
