import { describe, it, expect } from 'vitest';
import type { EvalExpectedItem, EvalForbiddenRegion } from '@devdigest/shared';
import { validateFreeze } from './diff-freeze.js';

/**
 * AC-7 — diff-freeze integrity. Proves `validateFreeze` rejects an
 * unsatisfiable eval case (the file absent from the frozen diff, or the
 * expected lines outside every hunk) and accepts a satisfiable one,
 * including the full-file-kind exception the grounding gate itself grants
 * (`reviewer-core/src/grounding.ts:16`, `:59`).
 */

// A single-hunk diff touching `src/webhooks.ts` lines 61-70 (new side).
const WEBHOOKS_DIFF = [
  'diff --git a/src/webhooks.ts b/src/webhooks.ts',
  '--- a/src/webhooks.ts',
  '+++ b/src/webhooks.ts',
  '@@ -58,5 +58,13 @@',
  ' context line 58',
  ' context line 59',
  ' context line 60',
  '+added line 61',
  '+added line 62',
  '+added line 63',
  '+added line 64',
  '+added line 65',
  '+added line 66',
  '+added line 67',
  '+added line 68',
  '+added line 69',
  '+added line 70',
].join('\n');

// Same diff, but only touching `src/other.ts` — no hunk for webhooks.ts at all.
const OTHER_FILE_DIFF = [
  'diff --git a/src/other.ts b/src/other.ts',
  '--- a/src/other.ts',
  '+++ b/src/other.ts',
  '@@ -1,3 +1,4 @@',
  ' context line 1',
  ' context line 2',
  '+added line 3',
].join('\n');

function findingItem(overrides: Partial<EvalExpectedItem> = {}): EvalExpectedItem {
  return {
    file: 'src/webhooks.ts',
    start_line: 63,
    end_line: 65,
    kind: 'finding',
    ...overrides,
  };
}

function forbiddenRegion(overrides: Partial<EvalForbiddenRegion> = {}): EvalForbiddenRegion {
  return {
    file: 'src/webhooks.ts',
    start_line: 63,
    end_line: 65,
    kind: 'finding',
    ...overrides,
  };
}

describe('validateFreeze', () => {
  it('rejects when the expected item file has no hunk at all in the frozen diff', () => {
    const result = validateFreeze(OTHER_FILE_DIFF, 'must_find', [findingItem()], null);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('file_missing');
    expect(result.file).toBe('src/webhooks.ts');
    expect(result.message).toContain('src/webhooks.ts');
  });

  it('rejects when the expected lines fall outside every hunk on that file', () => {
    // The diff's only hunk covers new-side lines 61-70; the expected item
    // cites lines far outside that range.
    const result = validateFreeze(
      WEBHOOKS_DIFF,
      'must_find',
      [findingItem({ start_line: 200, end_line: 205 })],
      null,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('lines_uncovered');
    expect(result.file).toBe('src/webhooks.ts');
    expect(result.start_line).toBe(200);
    expect(result.end_line).toBe(205);
    expect(result.message).toContain('src/webhooks.ts');
    expect(result.message).toContain('200');
    expect(result.message).toContain('205');
  });

  it('accepts a full-file-kind item whose file is present but whose lines overlap no hunk', () => {
    // This is the case a naive (line-strict-for-everything) implementation
    // gets wrong: lethal_trifecta only needs the file present (AC-17).
    const result = validateFreeze(
      WEBHOOKS_DIFF,
      'must_find',
      [findingItem({ kind: 'lethal_trifecta', start_line: 900, end_line: 905 })],
      null,
    );
    expect(result.ok).toBe(true);
  });

  it('rejects a full-file-kind item whose file is entirely absent from the diff', () => {
    // File presence is still required for a full-file kind — only the line
    // check is waived.
    const result = validateFreeze(
      OTHER_FILE_DIFF,
      'must_find',
      [findingItem({ kind: 'secret_leak', start_line: 1, end_line: 1 })],
      null,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.reason).toBe('file_missing');
  });

  it('applies the same rule to a negative case forbidden region', () => {
    const missingFile = validateFreeze(OTHER_FILE_DIFF, 'must_not_flag', [], forbiddenRegion());
    expect(missingFile.ok).toBe(false);
    if (missingFile.ok) throw new Error('unreachable');
    expect(missingFile.reason).toBe('file_missing');
    expect(missingFile.file).toBe('src/webhooks.ts');

    const linesOutside = validateFreeze(
      WEBHOOKS_DIFF,
      'must_not_flag',
      [],
      forbiddenRegion({ start_line: 300, end_line: 310 }),
    );
    expect(linesOutside.ok).toBe(false);
    if (linesOutside.ok) throw new Error('unreachable');
    expect(linesOutside.reason).toBe('lines_uncovered');
  });

  it('accepts a well-formed positive case whose expected lines are covered by a hunk', () => {
    const result = validateFreeze(WEBHOOKS_DIFF, 'must_find', [findingItem({ start_line: 63, end_line: 65 })], null);
    expect(result.ok).toBe(true);
  });

  it('accepts a well-formed negative case whose forbidden region is covered by a hunk', () => {
    const result = validateFreeze(WEBHOOKS_DIFF, 'must_not_flag', [], forbiddenRegion({ start_line: 63, end_line: 65 }));
    expect(result.ok).toBe(true);
  });
});
