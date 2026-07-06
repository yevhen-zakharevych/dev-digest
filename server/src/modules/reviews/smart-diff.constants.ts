/**
 * Smart Diff (L03) — the split-suggestion threshold.
 *
 * The file-path classification patterns are NOT here: they live in the
 * canonical classifier at `../pulls/classifier.ts` (`classifyFile` +
 * `BOILERPLATE_PATTERNS`/`WIRING_PATTERNS`), which the Smart Diff composer
 * imports. This file keeps only the split threshold — a Smart-Diff-specific
 * concern, not file classification.
 *
 * `docs/plans/smart-diff.md` §5 is the authoritative spec.
 */

/**
 * `split_suggestion.too_big` threshold: total churn (additions + deletions)
 * summed over `core` + `wiring` files only (boilerplate excluded).
 */
export const SPLIT_TOO_BIG_LINES = 500;
