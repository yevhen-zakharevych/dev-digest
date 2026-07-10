import { describe, it, expect } from 'vitest';
import {
  analyzeFirstTasks,
  complexityBadge,
  isTestFile,
  moduleStem,
  type SourceFileFact,
} from './analyzer.js';
import {
  BADGE_FANOUT_HIGH,
  BADGE_FANOUT_MED,
  BADGE_SIZE_LINES_HIGH,
  BADGE_SIZE_LINES_MED,
} from './constants.js';

/** A body with `n` newline-separated lines and optional trailing text. */
function body(lines: number, extra = ''): string {
  return Array.from({ length: lines }, (_, i) => `line ${i}`).join('\n') + extra;
}

describe('onboarding analyzer — first-task grounding (AC-7)', () => {
  it('flags an untested source file as a candidate', () => {
    const files: SourceFileFact[] = [{ path: 'src/foo.ts', body: body(10), fanOut: 0 }];
    const out = analyzeFirstTasks({ sourceFiles: files, allPaths: ['src/foo.ts'] });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: 'src/foo.ts', reason: 'untested' });
  });

  it('does NOT flag a source file that has a matching test file', () => {
    const files: SourceFileFact[] = [{ path: 'src/foo.ts', body: body(10), fanOut: 0 }];
    const out = analyzeFirstTasks({
      sourceFiles: files,
      allPaths: ['src/foo.ts', 'src/foo.test.ts'],
    });
    expect(out).toHaveLength(0);
  });

  it('flags a TODO/FIXME marker even when the file is tested', () => {
    const files: SourceFileFact[] = [
      { path: 'src/bar.ts', body: `${body(5)}\n// TODO: handle edge case`, fanOut: 0 },
    ];
    const out = analyzeFirstTasks({
      sourceFiles: files,
      allPaths: ['src/bar.ts', 'src/bar.test.ts'],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ path: 'src/bar.ts', reason: 'todo' });
  });

  it('emits NO candidates when every file is tested and marker-free (AC-7 empty case)', () => {
    const files: SourceFileFact[] = [
      { path: 'src/a.ts', body: body(5), fanOut: 0 },
      { path: 'src/b.ts', body: body(5), fanOut: 0 },
    ];
    const out = analyzeFirstTasks({
      sourceFiles: files,
      allPaths: ['src/a.ts', 'src/a.test.ts', 'src/b.ts', 'src/b.spec.ts'],
    });
    expect(out).toHaveLength(0);
  });

  it('ignores non-source and test files handed in as source facts', () => {
    const files: SourceFileFact[] = [
      { path: 'README.md', body: 'TODO doc', fanOut: 0 },
      { path: 'src/x.test.ts', body: 'TODO', fanOut: 0 },
    ];
    const out = analyzeFirstTasks({ sourceFiles: files, allPaths: ['README.md', 'src/x.test.ts'] });
    expect(out).toHaveLength(0);
  });

  it('orders candidates by descending badge weight then path', () => {
    const files: SourceFileFact[] = [
      { path: 'src/small.ts', body: body(5), fanOut: 0 }, // Low
      { path: 'src/huge.ts', body: body(BADGE_SIZE_LINES_HIGH + 1), fanOut: BADGE_FANOUT_HIGH }, // High
    ];
    const out = analyzeFirstTasks({
      sourceFiles: files,
      allPaths: ['src/small.ts', 'src/huge.ts'],
    });
    expect(out.map((c) => c.path)).toEqual(['src/huge.ts', 'src/small.ts']);
  });
});

describe('onboarding analyzer — complexity badge heuristic (AC-8)', () => {
  it('is Low for a small, low-fan-out file', () => {
    expect(complexityBadge(10, 0)).toBe('Low');
  });

  it('rises to Medium when size crosses the medium threshold', () => {
    expect(complexityBadge(BADGE_SIZE_LINES_MED - 1, 0)).toBe('Low');
    expect(complexityBadge(BADGE_SIZE_LINES_MED, 0)).toBe('Medium');
  });

  it('rises to Medium when fan-out crosses the medium threshold', () => {
    expect(complexityBadge(10, BADGE_FANOUT_MED - 1)).toBe('Low');
    expect(complexityBadge(10, BADGE_FANOUT_MED)).toBe('Medium');
  });

  it('is High when both size and fan-out are high', () => {
    expect(complexityBadge(BADGE_SIZE_LINES_HIGH, BADGE_FANOUT_HIGH)).toBe('High');
  });

  it('increasing fan-out alone can change the badge (High threshold via 2+2)', () => {
    const beforeFan = complexityBadge(BADGE_SIZE_LINES_HIGH, 0); // 2 + 0 = Medium
    const afterFan = complexityBadge(BADGE_SIZE_LINES_HIGH, BADGE_FANOUT_HIGH); // 2 + 2 = High
    expect(beforeFan).toBe('Medium');
    expect(afterFan).toBe('High');
  });

  it('reflects a badge change through the analyzer when a file grows', () => {
    const grow = (lines: number, fanOut: number) =>
      analyzeFirstTasks({
        sourceFiles: [{ path: 'src/f.ts', body: body(lines), fanOut }],
        allPaths: ['src/f.ts'],
      })[0]!.badge;
    expect(grow(5, 0)).toBe('Low');
    expect(grow(BADGE_SIZE_LINES_HIGH + 1, BADGE_FANOUT_HIGH)).toBe('High');
  });
});

describe('onboarding analyzer — helpers', () => {
  it('detects test files by convention', () => {
    expect(isTestFile('src/foo.test.ts')).toBe(true);
    expect(isTestFile('pkg/bar_test.go')).toBe(true);
    expect(isTestFile('a/__tests__/x.ts')).toBe(true);
    expect(isTestFile('src/foo.ts')).toBe(false);
  });

  it('reduces a path to its module stem for test matching', () => {
    expect(moduleStem('src/foo.ts')).toBe('foo');
    expect(moduleStem('src/foo.test.ts')).toBe('foo');
    expect(moduleStem('pkg/bar_test.go')).toBe('bar');
  });
});
