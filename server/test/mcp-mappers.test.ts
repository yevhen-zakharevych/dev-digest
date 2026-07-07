import { describe, it, expect } from 'vitest';
import { BlastRadius } from '@devdigest/shared';
import {
  toConciseFinding,
  toDetailedFinding,
  toFinding,
  paginateFindings,
  emptyBlastRadius,
  blastResultToContract,
} from '../src/mcp/mappers.js';
import type { ReviewDtoFinding } from '../src/modules/reviews/helpers.js';
import type { FindingRow } from '../src/modules/reviews/repository.js';
import type { BlastResult } from '../src/modules/repo-intel/types.js';

/**
 * Hermetic pure-function coverage for the MCP mappers
 * (`docs/plans/L04-devdigest-mcp.md` §5/§6, task W0-MAP). No I/O.
 */

const dbRow: FindingRow = {
  id: 'f-db-1',
  reviewId: 'r1',
  file: 'src/a.ts',
  startLine: 10,
  endLine: 12,
  severity: 'CRITICAL',
  category: 'bug',
  title: 'DB row title',
  rationale: 'because reasons',
  suggestion: 'fix it',
  confidence: 0.9,
  kind: 'finding',
  trifectaComponents: null,
  acceptedAt: null,
  dismissedAt: null,
};

const dtoRow: ReviewDtoFinding = {
  id: 'f-dto-1',
  severity: 'WARNING',
  category: 'perf',
  title: 'DTO row title',
  file: 'src/b.ts',
  start_line: 5,
  end_line: 6,
  rationale: 'r',
  suggestion: null,
  confidence: 0.5,
  kind: 'finding',
  trifecta_components: null,
  evidence: null,
  review_id: 'r2',
  accepted_at: null,
  dismissed_at: null,
};

describe('toConciseFinding / toDetailedFinding / toFinding', () => {
  it('maps a raw DB FindingRow (camelCase) to a concise finding', () => {
    expect(toConciseFinding(dbRow)).toEqual({
      id: 'f-db-1',
      severity: 'CRITICAL',
      category: 'bug',
      title: 'DB row title',
      file: 'src/a.ts',
      start_line: 10,
      end_line: 12,
    });
  });

  it('maps an already-DTO ReviewDtoFinding (snake_case) to a concise finding', () => {
    expect(toConciseFinding(dtoRow)).toEqual({
      id: 'f-dto-1',
      severity: 'WARNING',
      category: 'perf',
      title: 'DTO row title',
      file: 'src/b.ts',
      start_line: 5,
      end_line: 6,
    });
  });

  it('detailed mapping adds rationale/suggestion/confidence for both row shapes', () => {
    expect(toDetailedFinding(dbRow)).toEqual({
      id: 'f-db-1',
      severity: 'CRITICAL',
      category: 'bug',
      title: 'DB row title',
      file: 'src/a.ts',
      start_line: 10,
      end_line: 12,
      rationale: 'because reasons',
      suggestion: 'fix it',
      confidence: 0.9,
    });
    expect(toDetailedFinding(dtoRow)).toMatchObject({
      rationale: 'r',
      suggestion: null,
      confidence: 0.5,
    });
  });

  it('toFinding toggles between concise and detailed via the format arg', () => {
    const concise = toFinding(dbRow, 'concise');
    const detailed = toFinding(dbRow, 'detailed');
    expect(concise).not.toHaveProperty('rationale');
    expect(detailed).toHaveProperty('rationale', 'because reasons');
  });
});

describe('paginateFindings', () => {
  function finding(id: string, severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION') {
    return { id, severity };
  }

  it('sorts by severity CRITICAL -> WARNING -> SUGGESTION (stable within a severity)', () => {
    const all = [
      finding('s1', 'SUGGESTION'),
      finding('c1', 'CRITICAL'),
      finding('w1', 'WARNING'),
      finding('c2', 'CRITICAL'),
      finding('w2', 'WARNING'),
    ];
    const page = paginateFindings(all, 0, { maxChars: 1_000_000 });
    expect(page.items.map((f) => f.id)).toEqual(['c1', 'c2', 'w1', 'w2', 's1']);
  });

  it('slices from the given offset after sorting', () => {
    const all = [
      finding('c1', 'CRITICAL'),
      finding('c2', 'CRITICAL'),
      finding('w1', 'WARNING'),
      finding('s1', 'SUGGESTION'),
    ];
    const page = paginateFindings(all, 2, { maxChars: 1_000_000 });
    expect(page.items.map((f) => f.id)).toEqual(['w1', 's1']);
    expect(page.offset).toBe(2);
    expect(page.total).toBe(4);
    expect(page.has_more).toBe(false);
    expect(page.next_offset).toBeNull();
  });

  it('stops adding items once the cumulative char budget would be exceeded, and sets has_more/next_offset', () => {
    const all = [1, 2, 3, 4, 5].map((n) => finding(`f${n}`, 'WARNING'));
    const oneItemChars = JSON.stringify(all[0]).length;
    // Room for exactly 2 items, not a 3rd.
    const maxChars = oneItemChars * 2 + 1;

    const page = paginateFindings(all, 0, { maxChars });

    expect(page.items).toHaveLength(2);
    expect(page.count).toBe(2);
    expect(page.total).toBe(5);
    expect(page.has_more).toBe(true);
    expect(page.next_offset).toBe(2);
  });

  it('always includes at least one item even if it alone exceeds the char budget', () => {
    const all = [finding('big', 'CRITICAL'), finding('small', 'WARNING')];
    const page = paginateFindings(all, 0, { maxChars: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0].id).toBe('big');
    expect(page.has_more).toBe(true);
    expect(page.next_offset).toBe(1);
  });

  it('reports has_more false and next_offset null when everything fits', () => {
    const all = [finding('c1', 'CRITICAL'), finding('w1', 'WARNING')];
    const page = paginateFindings(all, 0, { maxChars: 1_000_000 });
    expect(page.count).toBe(2);
    expect(page.has_more).toBe(false);
    expect(page.next_offset).toBeNull();
  });
});

describe('emptyBlastRadius', () => {
  it('produces a value that validates against BlastRadius.parse', () => {
    const value = emptyBlastRadius('blast radius not yet implemented (L04 homework)');
    expect(() => BlastRadius.parse(value)).not.toThrow();
    const parsed = BlastRadius.parse(value);
    expect(parsed.changed_symbols).toEqual([]);
    expect(parsed.downstream).toEqual([]);
    expect(parsed.summary).toBe('blast radius not yet implemented (L04 homework)');
  });
});

describe('blastResultToContract', () => {
  it('groups two callers of the same changed symbol into one downstream entry', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/foo.ts', name: 'doFoo', kind: 'function' }],
      callers: [
        { file: 'src/caller1.ts', symbol: 'callerA', viaSymbol: 'doFoo', line: 10, rank: 1 },
        { file: 'src/caller2.ts', symbol: 'callerB', viaSymbol: 'doFoo', line: 20, rank: 1 },
      ],
      impactedEndpoints: [],
    };

    const contract = blastResultToContract(result);
    const parsed = BlastRadius.parse(contract);

    expect(parsed.changed_symbols).toEqual([{ name: 'doFoo', file: 'src/foo.ts', kind: 'function' }]);
    expect(parsed.downstream).toHaveLength(1);
    expect(parsed.downstream[0].symbol).toBe('doFoo');
    expect(parsed.downstream[0].callers).toHaveLength(2);
    expect(parsed.downstream[0].callers).toEqual(
      expect.arrayContaining([
        { name: 'callerA', file: 'src/caller1.ts', line: 10 },
        { name: 'callerB', file: 'src/caller2.ts', line: 20 },
      ]),
    );
  });

  it('does not merge callers of different changed symbols into the same group', () => {
    const result: BlastResult = {
      changedSymbols: [
        { file: 'src/foo.ts', name: 'doFoo', kind: 'function' },
        { file: 'src/bar.ts', name: 'doBar', kind: 'function' },
      ],
      callers: [
        { file: 'src/caller1.ts', symbol: 'callerA', viaSymbol: 'doFoo', line: 10, rank: 1 },
        { file: 'src/caller2.ts', symbol: 'callerB', viaSymbol: 'doBar', line: 20, rank: 1 },
      ],
      impactedEndpoints: [],
    };

    const contract = blastResultToContract(result);
    expect(contract.downstream).toHaveLength(2);
    const symbols = contract.downstream.map((d) => d.symbol).sort();
    expect(symbols).toEqual(['doBar', 'doFoo']);
  });

  it('attributes endpoints/crons per-symbol via factsByFile when present, deduped across callers', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/foo.ts', name: 'doFoo', kind: 'function' }],
      callers: [
        { file: 'src/caller1.ts', symbol: 'callerA', viaSymbol: 'doFoo', line: 10, rank: 1 },
        { file: 'src/caller1.ts', symbol: 'callerA2', viaSymbol: 'doFoo', line: 11, rank: 1 },
      ],
      impactedEndpoints: ['GET /unrelated'],
      factsByFile: {
        'src/caller1.ts': { endpoints: ['GET /foo', 'GET /foo'], crons: ['nightly-foo'] },
      },
    };

    const contract = blastResultToContract(result);
    expect(contract.downstream).toHaveLength(1);
    expect(contract.downstream[0].endpoints_affected).toEqual(['GET /foo']);
    expect(contract.downstream[0].crons_affected).toEqual(['nightly-foo']);
  });

  it('falls back to the flat impactedEndpoints list when factsByFile is absent (degraded path)', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/foo.ts', name: 'doFoo', kind: 'function' }],
      callers: [{ file: 'src/caller1.ts', symbol: 'callerA', viaSymbol: 'doFoo', line: 10, rank: 0 }],
      impactedEndpoints: ['GET /foo', 'POST /foo'],
      degraded: true,
      reason: 'index_partial',
    };

    const contract = blastResultToContract(result);
    expect(contract.downstream[0].endpoints_affected).toEqual(['GET /foo', 'POST /foo']);
    expect(contract.summary).toMatch(/degraded/);
  });

  it('handles no callers at all (empty downstream, changed symbols still mapped)', () => {
    const result: BlastResult = {
      changedSymbols: [{ file: 'src/foo.ts', name: 'doFoo', kind: 'function' }],
      callers: [],
      impactedEndpoints: [],
    };
    const contract = blastResultToContract(result);
    expect(contract.changed_symbols).toHaveLength(1);
    expect(contract.downstream).toEqual([]);
    expect(() => BlastRadius.parse(contract)).not.toThrow();
  });
});
