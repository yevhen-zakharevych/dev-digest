import { describe, it, expect } from 'vitest';
import type { EvalExpectedItem } from '@devdigest/shared';
import { computeFingerprint, canonicalStringify, type FingerprintInput } from './fingerprint.js';

function baseInput(): FingerprintInput {
  const items: EvalExpectedItem[] = [{ file: 'a.ts', start_line: 1, end_line: 2, kind: 'finding' }];
  return {
    diff: '--- a/a.ts\n+++ b/a.ts\n@@ -1,1 +1,2 @@\n+x\n',
    prMeta: { title: 'Fix the bug', description: 'A description' },
    expectation: 'must_find',
    expectedItems: items,
    forbiddenRegion: null,
  };
}

describe('computeFingerprint (AC-14)', () => {
  it('is deterministic: identical input hashes identically across independent calls', () => {
    const a = computeFingerprint(baseInput());
    const b = computeFingerprint(baseInput());
    expect(a).toBe(b);
  });

  it('produces a stable-shaped sha256 hex digest', () => {
    const hash = computeFingerprint(baseInput());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is NOT sensitive to object key insertion order (no key-order dependence)', () => {
    const input = baseInput();
    // Same PR meta, keys inserted in a different order.
    const reordered: FingerprintInput = {
      ...input,
      prMeta: { description: 'A description', title: 'Fix the bug' },
    };
    expect(computeFingerprint(input)).toBe(computeFingerprint(reordered));
  });

  it('is NOT sensitive to key order nested inside expected items either', () => {
    const input = baseInput();
    const item = input.expectedItems[0]!;
    const reorderedItem: EvalExpectedItem = {
      kind: item.kind,
      end_line: item.end_line,
      start_line: item.start_line,
      file: item.file,
    };
    const reordered: FingerprintInput = { ...input, expectedItems: [reorderedItem] };
    expect(computeFingerprint(input)).toBe(computeFingerprint(reordered));
  });

  it('editing the diff changes the fingerprint (AC-14 observable)', () => {
    const before = computeFingerprint(baseInput());
    const after = computeFingerprint({ ...baseInput(), diff: baseInput().diff + '\n+more\n' });
    expect(after).not.toBe(before);
  });

  it('editing the expectation changes the fingerprint', () => {
    const before = computeFingerprint(baseInput());
    const after = computeFingerprint({ ...baseInput(), expectation: 'must_not_flag', expectedItems: [] });
    expect(after).not.toBe(before);
  });

  it('editing an expected item (a line range) changes the fingerprint', () => {
    const before = computeFingerprint(baseInput());
    const changedItem: EvalExpectedItem = { ...baseInput().expectedItems[0]!, end_line: 99 };
    const after = computeFingerprint({ ...baseInput(), expectedItems: [changedItem] });
    expect(after).not.toBe(before);
  });

  it('editing the forbidden region changes the fingerprint', () => {
    const negative: FingerprintInput = {
      ...baseInput(),
      expectation: 'must_not_flag',
      expectedItems: [],
      forbiddenRegion: { file: 'a.ts', start_line: 1, end_line: 2, kind: 'finding' },
    };
    const before = computeFingerprint(negative);
    const after = computeFingerprint({
      ...negative,
      forbiddenRegion: { ...negative.forbiddenRegion!, end_line: 50 },
    });
    expect(after).not.toBe(before);
  });

  it('editing PR meta (title/description) changes the fingerprint', () => {
    const before = computeFingerprint(baseInput());
    const after = computeFingerprint({
      ...baseInput(),
      prMeta: { title: 'A different title', description: 'A description' },
    });
    expect(after).not.toBe(before);
  });
});

describe('canonicalStringify', () => {
  it('sorts nested object keys recursively but preserves array order', () => {
    const a = canonicalStringify({ b: 1, a: [{ z: 1, y: 2 }] });
    const b = canonicalStringify({ a: [{ y: 2, z: 1 }], b: 1 });
    expect(a).toBe(b);
  });

  it('treats [1,2] and [2,1] as different (array order is semantic)', () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
  });
});
