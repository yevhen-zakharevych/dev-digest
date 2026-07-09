import { describe, it, expect } from 'vitest';
import type { Finding } from '@devdigest/shared';
import { toConciseFinding, toDetailedFinding, toFinding, paginateFindings } from '../src/mappers.js';

/**
 * Hermetic pure-function coverage for the MCP mappers. No I/O.
 *
 * Unlike the old in-`server/` version, findings always arrive as the canonical
 * snake_case `Finding` (from the HTTP API), so there is no camelCase-DB-row
 * branch to cover here.
 */

const finding: Finding = {
  id: 'f-1',
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
};

describe('toConciseFinding / toDetailedFinding / toFinding', () => {
  it('maps a Finding to a concise finding (only key fields)', () => {
    expect(toConciseFinding(finding)).toEqual({
      id: 'f-1',
      severity: 'WARNING',
      category: 'perf',
      title: 'DTO row title',
      file: 'src/b.ts',
      start_line: 5,
      end_line: 6,
    });
  });

  it('detailed mapping adds rationale/suggestion/confidence', () => {
    expect(toDetailedFinding(finding)).toEqual({
      id: 'f-1',
      severity: 'WARNING',
      category: 'perf',
      title: 'DTO row title',
      file: 'src/b.ts',
      start_line: 5,
      end_line: 6,
      rationale: 'r',
      suggestion: null,
      confidence: 0.5,
    });
  });

  it('toFinding toggles between concise and detailed via the format arg', () => {
    const concise = toFinding(finding, 'concise');
    const detailed = toFinding(finding, 'detailed');
    expect(concise).not.toHaveProperty('rationale');
    expect(detailed).toHaveProperty('rationale', 'r');
  });
});

describe('paginateFindings', () => {
  function f(id: string, severity: 'CRITICAL' | 'WARNING' | 'SUGGESTION') {
    return { id, severity };
  }

  it('sorts by severity CRITICAL -> WARNING -> SUGGESTION (stable within a severity)', () => {
    const all = [f('s1', 'SUGGESTION'), f('c1', 'CRITICAL'), f('w1', 'WARNING'), f('c2', 'CRITICAL'), f('w2', 'WARNING')];
    const page = paginateFindings(all, 0, { maxChars: 1_000_000 });
    expect(page.items.map((x) => x.id)).toEqual(['c1', 'c2', 'w1', 'w2', 's1']);
  });

  it('slices from the given offset after sorting', () => {
    const all = [f('c1', 'CRITICAL'), f('c2', 'CRITICAL'), f('w1', 'WARNING'), f('s1', 'SUGGESTION')];
    const page = paginateFindings(all, 2, { maxChars: 1_000_000 });
    expect(page.items.map((x) => x.id)).toEqual(['w1', 's1']);
    expect(page.offset).toBe(2);
    expect(page.total).toBe(4);
    expect(page.has_more).toBe(false);
    expect(page.next_offset).toBeNull();
  });

  it('stops adding items once the cumulative char budget would be exceeded, and sets has_more/next_offset', () => {
    const all = [1, 2, 3, 4, 5].map((n) => f(`f${n}`, 'WARNING'));
    const oneItemChars = JSON.stringify(all[0]).length;
    const maxChars = oneItemChars * 2 + 1; // room for exactly 2 items

    const page = paginateFindings(all, 0, { maxChars });

    expect(page.items).toHaveLength(2);
    expect(page.count).toBe(2);
    expect(page.total).toBe(5);
    expect(page.has_more).toBe(true);
    expect(page.next_offset).toBe(2);
  });

  it('always includes at least one item even if it alone exceeds the char budget', () => {
    const all = [f('big', 'CRITICAL'), f('small', 'WARNING')];
    const page = paginateFindings(all, 0, { maxChars: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]!.id).toBe('big');
    expect(page.has_more).toBe(true);
    expect(page.next_offset).toBe(1);
  });

  it('reports has_more false and next_offset null when everything fits', () => {
    const all = [f('c1', 'CRITICAL'), f('w1', 'WARNING')];
    const page = paginateFindings(all, 0, { maxChars: 1_000_000 });
    expect(page.count).toBe(2);
    expect(page.has_more).toBe(false);
    expect(page.next_offset).toBeNull();
  });
});
