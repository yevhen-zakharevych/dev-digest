/**
 * annotateDiffLines — regression coverage for the off-by-leading-context-count
 * line bug: the model was reporting a finding's line as if the hunk's changed
 * block started at `newStart`, ignoring the leading context lines before it.
 * Annotating removes the counting step: the model copies a number instead of
 * deriving one from the `@@ ... @@` header.
 */
import { describe, it, expect } from 'vitest';
import { annotateDiffLines } from '../src/review/reduce.js';

describe('annotateDiffLines', () => {
  it('prefixes context + added lines with the absolute new-file line number, honoring leading context', () => {
    // Mirrors the reported bug: 3 leading context lines (12-14) before the
    // added block (15-22). A model that (wrongly) treats newStart (12) as the
    // start of the added block would be off by exactly 3 — the number of
    // leading context lines.
    const raw = [
      'diff --git a/ConventionCard.tsx b/ConventionCard.tsx',
      '--- a/ConventionCard.tsx',
      '+++ b/ConventionCard.tsx',
      '@@ -12,6 +12,14 @@',
      ' function existing() {',
      '   return 1;',
      ' }',
      '+export function toGithubBlobUrl(repoFullName: string) {',
      '+  return `https://github.com/${repoFullName}`;',
      '+}',
    ].join('\n');

    const annotated = annotateDiffLines(raw);
    const lines = annotated.split('\n');

    expect(lines[4]).toBe('12: function existing() {');
    expect(lines[5]).toBe('13:   return 1;');
    expect(lines[6]).toBe('14: }');
    expect(lines[7]).toBe('15:+export function toGithubBlobUrl(repoFullName: string) {');
    expect(lines[8]).toBe('16:+  return `https://github.com/${repoFullName}`;');
    expect(lines[9]).toBe('17:+}');
  });

  it('leaves deleted lines unprefixed (they do not exist in the new file)', () => {
    const raw = ['@@ -1,3 +1,2 @@', ' keep', '-removed', ' keep2'].join('\n');
    const annotated = annotateDiffLines(raw);
    expect(annotated.split('\n')).toEqual(['@@ -1,3 +1,2 @@', '1: keep', '-removed', '2: keep2']);
  });

  it('resets the line cursor per hunk and per file', () => {
    const raw = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,1 @@',
      '+first file line',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -50,1 +50,1 @@',
      '+second file line',
    ].join('\n');

    const annotated = annotateDiffLines(raw);
    expect(annotated).toContain('1:+first file line');
    expect(annotated).toContain('50:+second file line');
  });

  it('preserves a trailing newline exactly (no phantom numbered empty line)', () => {
    const raw = '@@ -1,1 +1,1 @@\n+only line\n';
    const annotated = annotateDiffLines(raw);
    expect(annotated).toBe('@@ -1,1 +1,1 @@\n1:+only line\n');
  });

  it('leaves non-hunk preamble/lines untouched', () => {
    const raw = 'diff --git a/x b/x\n--- a/x\n+++ b/x\n';
    expect(annotateDiffLines(raw)).toBe(raw);
  });
});
