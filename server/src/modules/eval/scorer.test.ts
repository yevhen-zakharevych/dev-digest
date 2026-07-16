import { describe, it, expect } from 'vitest';
import type { EvalExpectedItem, Finding } from '@devdigest/shared';
import { matchesLocation, scoreCase, aggregateSetMetrics, type CaseMetricInput } from './scorer.js';

let nextId = 0;
function finding(overrides: Partial<Finding> = {}): Finding {
  nextId += 1;
  return {
    id: overrides.id ?? `f${nextId}`,
    severity: 'WARNING',
    category: 'bug',
    title: 'a finding',
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    rationale: 'because',
    confidence: 0.9,
    kind: 'finding',
    ...overrides,
  };
}

function expectedItem(overrides: Partial<EvalExpectedItem> = {}): EvalExpectedItem {
  return {
    file: 'src/a.ts',
    start_line: 10,
    end_line: 12,
    kind: 'finding',
    ...overrides,
  };
}

describe('matchesLocation (AC-17)', () => {
  it('matches on file equality + line overlap for a finding-kind expected item', () => {
    const f = finding({ file: 'src/a.ts', start_line: 11, end_line: 11 });
    const item = expectedItem({ file: 'src/a.ts', start_line: 10, end_line: 12, kind: 'finding' });
    expect(matchesLocation(f, item)).toBe(true);
  });

  it('rejects a finding-kind item when lines do not overlap, even on the same file', () => {
    const f = finding({ file: 'src/a.ts', start_line: 50, end_line: 55 });
    const item = expectedItem({ file: 'src/a.ts', start_line: 10, end_line: 12, kind: 'finding' });
    expect(matchesLocation(f, item)).toBe(false);
  });

  it('rejects when the file differs, regardless of line overlap', () => {
    const f = finding({ file: 'src/other.ts', start_line: 10, end_line: 12 });
    const item = expectedItem({ file: 'src/a.ts', start_line: 10, end_line: 12, kind: 'finding' });
    expect(matchesLocation(f, item)).toBe(false);
  });

  it('matches a full-file kind (lethal_trifecta) on file alone, with NO line overlap required', () => {
    // The user's own mockup: "Lethal trifecta: untrusted input reaches exfil
    // path" at src/api/public/webhooks.ts:61-74 (AC-17's cited example).
    const f = finding({ file: 'src/api/public/webhooks.ts', start_line: 5, end_line: 6, kind: 'lethal_trifecta' });
    const item = expectedItem({
      file: 'src/api/public/webhooks.ts',
      start_line: 61,
      end_line: 74,
      kind: 'lethal_trifecta',
    });
    expect(matchesLocation(f, item)).toBe(true);
  });

  it('does NOT read as a mismatch for every other full-file kind either (secret_leak, phantom, hook)', () => {
    for (const kind of ['secret_leak', 'phantom', 'hook'] as const) {
      const f = finding({ file: 'src/a.ts', start_line: 1, end_line: 1, kind });
      const item = expectedItem({ file: 'src/a.ts', start_line: 999, end_line: 999, kind });
      expect(matchesLocation(f, item)).toBe(true);
    }
  });

  it('title, category, and severity never participate in the match', () => {
    const f = finding({
      file: 'src/a.ts',
      start_line: 10,
      end_line: 12,
      title: 'Totally different title',
      category: 'perf',
      severity: 'SUGGESTION',
      kind: 'finding',
    });
    const item = expectedItem({
      file: 'src/a.ts',
      start_line: 10,
      end_line: 12,
      kind: 'finding',
      title: 'Original rationale title',
      category: 'security',
      severity: 'CRITICAL',
    });
    expect(matchesLocation(f, item)).toBe(true);
  });
});

describe('scoreCase — per-case pass/fail (AC-22)', () => {
  it('must_find: passes when every expected item is matched', () => {
    const items = [expectedItem({ file: 'a.ts', start_line: 1, end_line: 1 })];
    const result = scoreCase({
      expectation: 'must_find',
      expectedItems: items,
      forbiddenRegion: null,
      keptFindings: [finding({ id: 'f1', file: 'a.ts', start_line: 1, end_line: 1 })],
      emittedCount: 1,
    });
    expect(result.passed).toBe(true);
    expect(result.matchedExpectedIndices).toEqual([0]);
  });

  it('must_find: an extra unrelated finding does NOT fail the case ("expected 1, got 1")', () => {
    const items = [expectedItem({ file: 'a.ts', start_line: 1, end_line: 1 })];
    const result = scoreCase({
      expectation: 'must_find',
      expectedItems: items,
      forbiddenRegion: null,
      keptFindings: [
        finding({ id: 'f1', file: 'a.ts', start_line: 1, end_line: 1 }),
        finding({ id: 'f2', file: 'other.ts', start_line: 99, end_line: 99 }),
      ],
      emittedCount: 2,
    });
    expect(result.passed).toBe(true);
    expect(result.matchedExpectedIndices).toEqual([0]);
    expect(result.unmatchedFindingIds).toEqual(['f2']);
  });

  it('must_find: fails when an expected item has no matching survivor', () => {
    const items = [
      expectedItem({ file: 'a.ts', start_line: 1, end_line: 1 }),
      expectedItem({ file: 'b.ts', start_line: 1, end_line: 1 }),
    ];
    const result = scoreCase({
      expectation: 'must_find',
      expectedItems: items,
      forbiddenRegion: null,
      keptFindings: [finding({ id: 'f1', file: 'a.ts', start_line: 1, end_line: 1 })],
      emittedCount: 1,
    });
    expect(result.passed).toBe(false);
    expect(result.matchedExpectedIndices).toEqual([0]);
  });

  it('must_not_flag: passes when no survivor overlaps the forbidden region', () => {
    const result = scoreCase({
      expectation: 'must_not_flag',
      expectedItems: [],
      forbiddenRegion: { file: 'a.ts', start_line: 10, end_line: 12, kind: 'finding' },
      keptFindings: [finding({ id: 'f1', file: 'unrelated.ts', start_line: 1, end_line: 1 })],
      emittedCount: 1,
    });
    expect(result.passed).toBe(true);
  });

  it('must_not_flag: fails when a survivor overlaps the forbidden region', () => {
    const result = scoreCase({
      expectation: 'must_not_flag',
      expectedItems: [],
      forbiddenRegion: { file: 'a.ts', start_line: 10, end_line: 12, kind: 'finding' },
      keptFindings: [finding({ id: 'f1', file: 'a.ts', start_line: 11, end_line: 11 })],
      emittedCount: 1,
    });
    expect(result.passed).toBe(false);
  });

  it('must_not_flag on a full-file forbidden kind: fails on file alone, no line overlap needed', () => {
    const result = scoreCase({
      expectation: 'must_not_flag',
      expectedItems: [],
      forbiddenRegion: { file: 'a.ts', start_line: 1, end_line: 1, kind: 'secret_leak' },
      keptFindings: [finding({ id: 'f1', file: 'a.ts', start_line: 500, end_line: 500, kind: 'secret_leak' })],
      emittedCount: 1,
    });
    expect(result.passed).toBe(false);
  });
});

describe('aggregateSetMetrics — recall (AC-18)', () => {
  it('5 expected items across 3 positive cases, 4 matched ⇒ recall 0.8, regardless of distribution', () => {
    const cases: CaseMetricInput[] = [
      {
        outcome: 'failed',
        expectation: 'must_find',
        expectedCount: 2,
        score: {
          passed: false,
          matchedExpectedIndices: [0],
          matchedFindingIds: ['f1'],
          unmatchedFindingIds: [],
          keptCount: 1,
          emittedCount: 1,
        },
      },
      {
        outcome: 'passed',
        expectation: 'must_find',
        expectedCount: 1,
        score: {
          passed: true,
          matchedExpectedIndices: [0],
          matchedFindingIds: ['f2'],
          unmatchedFindingIds: [],
          keptCount: 1,
          emittedCount: 1,
        },
      },
      {
        outcome: 'passed',
        expectation: 'must_find',
        expectedCount: 2,
        score: {
          passed: true,
          matchedExpectedIndices: [0, 1],
          matchedFindingIds: ['f3', 'f4'],
          unmatchedFindingIds: [],
          keptCount: 2,
          emittedCount: 2,
        },
      },
    ];
    const metrics = aggregateSetMetrics(cases);
    expect(metrics.recall).toBeCloseTo(0.8);
  });

  it('recall is null (not 0) when the scored set has zero must_find items', () => {
    const cases: CaseMetricInput[] = [
      {
        outcome: 'passed',
        expectation: 'must_not_flag',
        expectedCount: 0,
        score: {
          passed: true,
          matchedExpectedIndices: [],
          matchedFindingIds: [],
          unmatchedFindingIds: [],
          keptCount: 0,
          emittedCount: 0,
        },
      },
    ];
    expect(aggregateSetMetrics(cases).recall).toBeNull();
  });
});

describe('aggregateSetMetrics — precision (AC-19)', () => {
  it('10 surviving findings across the set, 8 match ⇒ precision 0.8', () => {
    const cases: CaseMetricInput[] = [
      {
        outcome: 'passed',
        expectation: 'must_find',
        expectedCount: 8,
        score: {
          passed: true,
          matchedExpectedIndices: Array.from({ length: 8 }, (_, i) => i),
          matchedFindingIds: Array.from({ length: 8 }, (_, i) => `m${i}`),
          unmatchedFindingIds: ['u1', 'u2'],
          keptCount: 10,
          emittedCount: 10,
        },
      },
    ];
    expect(aggregateSetMetrics(cases).precision).toBeCloseTo(0.8);
  });

  it('a single false positive on a negative case moves precision from 8/8 (1.0) to 8/9', () => {
    const baseline: CaseMetricInput[] = [
      {
        outcome: 'passed',
        expectation: 'must_find',
        expectedCount: 8,
        score: {
          passed: true,
          matchedExpectedIndices: Array.from({ length: 8 }, (_, i) => i),
          matchedFindingIds: Array.from({ length: 8 }, (_, i) => `m${i}`),
          unmatchedFindingIds: [],
          keptCount: 8,
          emittedCount: 8,
        },
      },
    ];
    expect(aggregateSetMetrics(baseline).precision).toBe(1);

    const withFalsePositive: CaseMetricInput[] = [
      ...baseline,
      {
        // A must_not_flag case the agent commented on — noise, contributes
        // nothing to the numerator but one finding to the denominator.
        outcome: 'failed',
        expectation: 'must_not_flag',
        expectedCount: 0,
        score: {
          passed: false,
          matchedExpectedIndices: [],
          matchedFindingIds: [],
          unmatchedFindingIds: ['fp1'],
          keptCount: 1,
          emittedCount: 1,
        },
      },
    ];
    expect(aggregateSetMetrics(withFalsePositive).precision).toBeCloseTo(8 / 9);
  });

  it('noise on a POSITIVE case (not only a forbidden region) also costs set precision', () => {
    // AC-22's "expected 1, got 1 + an extra" example: the case itself
    // passes, but the extra finding still counts against precision.
    const cases: CaseMetricInput[] = [
      {
        outcome: 'passed',
        expectation: 'must_find',
        expectedCount: 1,
        score: {
          passed: true,
          matchedExpectedIndices: [0],
          matchedFindingIds: ['m1'],
          unmatchedFindingIds: ['extra1'],
          keptCount: 2,
          emittedCount: 2,
        },
      },
    ];
    expect(aggregateSetMetrics(cases).precision).toBeCloseTo(0.5);
  });

  it('precision is 1.0 when the agent emits zero surviving findings across the whole set', () => {
    const cases: CaseMetricInput[] = [
      {
        outcome: 'failed',
        expectation: 'must_find',
        expectedCount: 1,
        score: {
          passed: false,
          matchedExpectedIndices: [],
          matchedFindingIds: [],
          unmatchedFindingIds: [],
          keptCount: 0,
          emittedCount: 0,
        },
      },
    ];
    const metrics = aggregateSetMetrics(cases);
    expect(metrics.precision).toBe(1);
    expect(metrics.recall).toBe(0); // recall 0 + precision 1.0 makes a silent agent legible (AC-19).
  });
});

describe('aggregateSetMetrics — citation accuracy (AC-20)', () => {
  it('20 findings emitted, 19 kept ⇒ citation accuracy 0.95', () => {
    const cases: CaseMetricInput[] = [
      {
        outcome: 'passed',
        expectation: 'must_find',
        expectedCount: 19,
        score: {
          passed: true,
          matchedExpectedIndices: Array.from({ length: 19 }, (_, i) => i),
          matchedFindingIds: Array.from({ length: 19 }, (_, i) => `m${i}`),
          unmatchedFindingIds: [],
          keptCount: 19,
          emittedCount: 20,
        },
      },
    ];
    expect(aggregateSetMetrics(cases).citation_accuracy).toBeCloseTo(0.95);
  });

  it('citation accuracy is 1.0 when the model emitted no finding at all', () => {
    const cases: CaseMetricInput[] = [
      {
        outcome: 'failed',
        expectation: 'must_find',
        expectedCount: 1,
        score: {
          passed: false,
          matchedExpectedIndices: [],
          matchedFindingIds: [],
          unmatchedFindingIds: [],
          keptCount: 0,
          emittedCount: 0,
        },
      },
    ];
    expect(aggregateSetMetrics(cases).citation_accuracy).toBe(1);
  });

  it('the denominator is EVERY emitted finding, not only ones that matched — an ungrounded false positive still counts', () => {
    // A finding that is BOTH noise (matches nothing) AND ungrounded (dropped
    // by the gate) must still lower citation accuracy — narrowing the
    // denominator to matched findings would let it escape entirely.
    const cases: CaseMetricInput[] = [
      {
        outcome: 'failed',
        expectation: 'must_not_flag',
        expectedCount: 0,
        score: {
          passed: false,
          matchedExpectedIndices: [],
          matchedFindingIds: [],
          unmatchedFindingIds: ['kept-noise'],
          keptCount: 1,
          emittedCount: 3, // 1 kept (noise) + 2 dropped by the gate
        },
      },
    ];
    expect(aggregateSetMetrics(cases).citation_accuracy).toBeCloseTo(1 / 3);
  });
});

describe('aggregateSetMetrics — errored cases (AC-36/AC-37)', () => {
  const passingCase: CaseMetricInput = {
    outcome: 'passed',
    expectation: 'must_find',
    expectedCount: 2,
    score: {
      passed: true,
      matchedExpectedIndices: [0, 1],
      matchedFindingIds: ['m1', 'm2'],
      unmatchedFindingIds: [],
      keptCount: 2,
      emittedCount: 2,
    },
  };

  const erroredCase: CaseMetricInput = {
    outcome: 'errored',
    expectation: 'must_find',
    // If an errored case's numbers leaked into a denominator, this would
    // drag recall/precision/citation down from their true values — the
    // exact "fictional regression" bug (root INSIGHTS.md:63).
    expectedCount: 100,
    score: {
      passed: false,
      matchedExpectedIndices: [],
      matchedFindingIds: [],
      unmatchedFindingIds: [],
      keptCount: 0,
      emittedCount: 500,
    },
  };

  it('an errored case is excluded from every denominator (AC-36)', () => {
    const withErrored = aggregateSetMetrics([passingCase, erroredCase]);
    const withoutErrored = aggregateSetMetrics([passingCase]);
    expect(withErrored).toEqual(withoutErrored);
    expect(withErrored.recall).toBe(1);
  });

  it('an all-errored run reports null metrics, never zeros (AC-37)', () => {
    const metrics = aggregateSetMetrics([erroredCase]);
    expect(metrics).toEqual({ recall: null, precision: null, citation_accuracy: null });
  });

  it('an empty case set also reports null metrics (no scorable case at all)', () => {
    expect(aggregateSetMetrics([])).toEqual({ recall: null, precision: null, citation_accuracy: null });
  });
});
