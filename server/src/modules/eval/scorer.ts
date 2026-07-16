import type {
  EvalExpectation,
  EvalExpectedItem,
  EvalForbiddenRegion,
  EvalCaseOutcome,
  Finding,
  FindingKind,
} from '@devdigest/shared';
// Subpath, not the barrel — the barrel eagerly loads the LLM providers (which
// `import 'openai'`), and this scorer is pure. See the note in `diff-freeze.ts`.
import { FULL_FILE_KINDS } from '@devdigest/reviewer-core/grounding.js';

/**
 * Scoring — mechanical, no model call anywhere in this file (AC-23).
 *
 * The match rule mirrors `groundFindings` (`reviewer-core/src/grounding.ts`)
 * EXACTLY: a finding is located against an expected item (or a forbidden
 * region) using the SAME locality rule the grounding gate applies, keyed off
 * the target's `kind` — not the finding's own `kind`, and never title,
 * category, severity, or prose (AC-17). `FULL_FILE_KINDS` is imported from
 * `reviewer-core`, never re-declared, so the two rules cannot drift.
 *
 * NOTE on `buildLineIndex`: the plan pointed at `buildLineIndex`
 * (`reviewer-core/src/grounding.ts:24`) for "the" line-overlap
 * implementation. That function intersects a region's lines against a real
 * diff's hunks — it is the right tool for `diff-freeze.ts` (does the FROZEN
 * DIFF cover this region?), which needs a `UnifiedDiff`. Matching a finding
 * against an expected item is a different question — do these two ALREADY-
 * KNOWN ranges (finding vs. expected item) overlap? — and needs no diff at
 * all. Force-fitting `buildLineIndex` here would mean synthesizing a fake
 * one-hunk `UnifiedDiff` per comparison, which reproduces `rangeIntersects`
 * (an unexported, generic interval-overlap primitive) through a much more
 * fragile path. `rangesOverlap` below is that same primitive, reimplemented
 * directly — it duplicates no *business rule* (the one drift risk the plan
 * calls out is `FULL_FILE_KINDS`, which IS imported, not duplicated).
 */

interface Locatable {
  file: string;
  start_line: number;
  end_line: number;
  kind: FindingKind;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  const loA = Math.min(aStart, aEnd);
  const hiA = Math.max(aStart, aEnd);
  const loB = Math.min(bStart, bEnd);
  const hiB = Math.max(bStart, bEnd);
  return loA <= hiB && loB <= hiA;
}

/**
 * AC-17: does `finding` locate `target` (an expected item or a forbidden
 * region)? Classification is driven by `target.kind` — a full-file kind
 * (`secret_leak` | `lethal_trifecta` | `phantom` | `hook`) matches on file
 * equality alone, with no line check; anything else additionally requires
 * line-range overlap. The finding's own `kind`, title, category, and
 * severity never participate.
 */
export function matchesLocation(finding: Finding, target: Locatable): boolean {
  if (finding.file !== target.file) return false;
  if (FULL_FILE_KINDS.has(target.kind)) return true;
  return rangesOverlap(finding.start_line, finding.end_line, target.start_line, target.end_line);
}

export interface ScoreCaseInput {
  expectation: EvalExpectation;
  /** Empty for `must_not_flag` (AC-3). */
  expectedItems: EvalExpectedItem[];
  /** Null unless `must_not_flag`. */
  forbiddenRegion: EvalForbiddenRegion | null;
  /** Findings that survived the grounding gate for this case (AC-15/16). */
  keptFindings: Finding[];
  /** Every finding the model emitted for this case — kept + dropped, from the gate's own record (AC-20). */
  emittedCount: number;
}

export interface CaseScoreResult {
  /**
   * Per-case pass/fail (AC-22). `must_find` passes iff every expected item is
   * matched; `must_not_flag` passes iff no survivor overlaps the forbidden
   * region. An extra finding on a positive case never flips this to false.
   */
  passed: boolean;
  /** Indices into `expectedItems` that a survivor matched. */
  matchedExpectedIndices: number[];
  /** Ids of `keptFindings` that matched some expected item. */
  matchedFindingIds: string[];
  /** Ids of `keptFindings` that matched nothing — noise, whatever the case type. */
  unmatchedFindingIds: string[];
  keptCount: number;
  emittedCount: number;
}

/** Score one case. Never called for an `errored` case — the caller excludes those before scoring (AC-36). */
export function scoreCase(input: ScoreCaseInput): CaseScoreResult {
  const { expectation, expectedItems, forbiddenRegion, keptFindings, emittedCount } = input;

  const matchedIndices = new Set<number>();
  const matchedFindingIds = new Set<string>();

  for (const finding of keptFindings) {
    expectedItems.forEach((item, index) => {
      if (matchesLocation(finding, item)) {
        matchedIndices.add(index);
        matchedFindingIds.add(finding.id);
      }
    });
  }

  const unmatchedFindingIds = keptFindings
    .filter((f) => !matchedFindingIds.has(f.id))
    .map((f) => f.id);

  const passed =
    expectation === 'must_find'
      ? matchedIndices.size === expectedItems.length
      : !forbiddenRegion || !keptFindings.some((f) => matchesLocation(f, forbiddenRegion));

  return {
    passed,
    matchedExpectedIndices: [...matchedIndices].sort((a, b) => a - b),
    matchedFindingIds: [...matchedFindingIds],
    unmatchedFindingIds,
    keptCount: keptFindings.length,
    emittedCount,
  };
}

export interface CaseMetricInput {
  outcome: EvalCaseOutcome;
  expectation: EvalExpectation;
  /** `expectedItems.length` for this case — 0 for `must_not_flag`. */
  expectedCount: number;
  score: CaseScoreResult;
}

export interface SetMetrics {
  recall: number | null;
  precision: number | null;
  citation_accuracy: number | null;
}

/**
 * Set-level metrics (AC-18/19/20), computed only over non-`errored` cases
 * (AC-36). When every case in `cases` is errored — or `cases` is empty —
 * every metric is `null`, never a zero (AC-37): a run over zero scorable
 * cases is an invalid sample, not a measured score of zero.
 */
export function aggregateSetMetrics(cases: CaseMetricInput[]): SetMetrics {
  const scored = cases.filter((c) => c.outcome !== 'errored');
  if (scored.length === 0) return { recall: null, precision: null, citation_accuracy: null };

  let expectedTotal = 0;
  let matchedTotal = 0;
  let survivorTotal = 0;
  let survivorMatchedTotal = 0;
  let emittedTotal = 0;

  for (const c of scored) {
    if (c.expectation === 'must_find') {
      expectedTotal += c.expectedCount;
      matchedTotal += c.score.matchedExpectedIndices.length;
    }
    survivorTotal += c.score.keptCount;
    survivorMatchedTotal += c.score.matchedFindingIds.length;
    emittedTotal += c.score.emittedCount;
  }

  return {
    // AC-18: null (never 0) when the scored set has no `must_find` item at all.
    recall: expectedTotal === 0 ? null : matchedTotal / expectedTotal,
    // AC-19: 1.0 when the agent emitted no surviving finding across the set.
    precision: survivorTotal === 0 ? 1 : survivorMatchedTotal / survivorTotal,
    // AC-20: 1.0 when the model emitted no finding at all (kept or dropped).
    citation_accuracy: emittedTotal === 0 ? 1 : survivorTotal / emittedTotal,
  };
}
