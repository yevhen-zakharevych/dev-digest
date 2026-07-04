# Bug: finding line numbers are offset from the actual code

> Status: **OPEN** · Reported 2026-07-04 · Area: `reviewer-core` / grounding (NOT Smart Diff)

## Symptom

A finding's stored `start_line`/`end_line` point a few lines **above** the code the
finding actually describes. Observed offset in the sample = **3 lines**.

**Example (PR #4, `lesson-03`):**

- Finding: *"Potential open redirect via unsanitized repoFullName in ConventionCard"* (WARNING, 70% conf)
- File: `client/src/app/conventions/_components/ConventionCard/ConventionCard.tsx`
- **Stored / displayed:** `:12-19`
- **Actual code** (the `toGithubBlobUrl` function the finding is about): new-side lines **15-22**
- Offset = **+3**, which equals the number of **context lines** (12, 13, 14) before the added block in the hunk.

## Where it is NOT

**This is not a Smart Diff bug.** Both surfaces read the *same* stored value and agree:

- `FindingCard` (Findings tab) renders `lineLabel(f)` = `` `${f.start_line}-${f.end_line}` `` → shows `12-19`.
  (`.../FindingCard/FindingCard.tsx` + `.../FindingCard/helpers.ts` — pre-existing, earlier lesson.)
- Smart Diff per-line badge/accent bars use `f.start_line`/`f.end_line` directly
  (`.../SmartDiffViewer/SmartDiffFileCard.tsx`) → badge lands on line 12, bars span 12-19.

Neither applies any offset. If the display were shifting numbers, the two views would
disagree — they don't. So the wrong number lives in the **finding data**, not the render.

## Likely root cause (to verify)

The number is produced upstream by the **review + grounding pipeline** (`reviewer-core`
+ `groundFindings()`), which predates this session (L01/L02 work):

- The model likely counts lines **relative to the hunk header** (`@@ -12,6 +12,14 @@`)
  or off the pre-image, instead of the absolute new-side file line.
- `groundFindings()` appears to validate that a finding's line falls **within a changed
  range** (so 12-19 passes — those lines are in the diff) but does **not** re-anchor it to
  the semantically-correct line. So a plausible-but-wrong line survives grounding.

The exact `+3 == context-lines-before-hunk` relationship is the strongest clue: it points
at a hunk-relative vs file-absolute line-number mismatch somewhere in
`reviewer-core/**` (finding extraction) or the grounding mapping.

## Repro

1. Import a repo + open PR #4 (branch `lesson-03`).
2. Run a review (Run Review ▾).
3. Open the *ConventionCard open-redirect* WARNING finding.
4. Compare its `:12-19` label against the actual `toGithubBlobUrl` function location (15-22)
   in Files changed.

## Suggested investigation (next session)

1. Read `reviewer-core/**` finding extraction + `platform/grounding*` (`groundFindings`):
   determine whether line numbers are model-reported hunk-relative and whether grounding
   re-anchors or merely range-validates.
2. Check a few more findings across files to confirm the offset is systematic and equals
   the leading-context-line count (vs. a one-off model miscount).
3. If systematic: fix at the grounding/extraction seam so `start_line`/`end_line` are
   absolute new-side file lines, re-anchored against the diff.
4. Add a grounding test asserting a finding on an added line inside a hunk with N leading
   context lines resolves to the correct absolute line (guards the off-by-N).

## Out of scope

- Smart Diff (this session's work) — verified faithful; no change needed there.
- The fix belongs in `reviewer-core` / grounding, which is a cross-module contract area
  (`server/AGENTS.md` → `../specs/`).
