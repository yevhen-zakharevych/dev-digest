import { describe, it, expect } from 'vitest';
import { SmartDiff } from '@devdigest/shared';
import {
  classifyRole,
  buildFindingsByFile,
  computeSplit,
  buildSmartDiff,
} from '../src/modules/reviews/smart-diff.classify.js';
import { SPLIT_TOO_BIG_LINES } from '../src/modules/reviews/smart-diff.constants.js';

/**
 * Pure hermetic coverage for Smart Diff's classifier + composer
 * (`docs/plans/smart-diff.md` §5, task S1). No I/O — plain-object-in/out,
 * so this is a plain `*.test.ts` (not `.it.test.ts`).
 */

describe('classifyRole', () => {
  it('classifies known lockfiles as boilerplate', () => {
    expect(classifyRole('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyRole('package-lock.json')).toBe('boilerplate');
    expect(classifyRole('backend/yarn.lock')).toBe('boilerplate');
    expect(classifyRole('go.sum')).toBe('boilerplate');
  });

  it('classifies build output, vendored, and snapshot paths as boilerplate', () => {
    expect(classifyRole('dist/index.js')).toBe('boilerplate');
    expect(classifyRole('client/.next/server/app.js')).toBe('boilerplate');
    expect(classifyRole('node_modules/foo/index.js')).toBe('boilerplate');
    expect(classifyRole('src/__snapshots__/App.test.tsx.snap')).toBe('boilerplate');
    expect(classifyRole('src/db/migrations/meta/0001_snapshot.json')).toBe('boilerplate');
  });

  it('classifies config files and barrel/index files as wiring', () => {
    expect(classifyRole('vite.config.ts')).toBe('wiring');
    expect(classifyRole('src/modules/reviews/index.ts')).toBe('wiring');
    expect(classifyRole('package.json')).toBe('wiring');
    expect(classifyRole('.github/workflows/ci.yml')).toBe('wiring');
    expect(classifyRole('docker-compose.yml')).toBe('wiring');
  });

  it('classifies ordinary source files as core', () => {
    expect(classifyRole('src/foo.ts')).toBe('core');
    expect(classifyRole('server/src/modules/reviews/service.ts')).toBe('core');
  });

  it('gives boilerplate precedence over wiring — a lockfile inside a config-looking dir is boilerplate, not wiring', () => {
    // "config/" directory could plausibly be mistaken for wiring, but the
    // basename is a lockfile, and boilerplate is checked first.
    expect(classifyRole('config/pnpm-lock.yaml')).toBe('boilerplate');

    // MUTATION CHECK: if precedence were flipped to wiring-first, a
    // yaml-catchall wiring pattern would also match "pnpm-lock.yaml" (it
    // ends in .yaml) and this assertion would fail. Verified by temporarily
    // swapping the `if` order in classifyRole (boilerplate/wiring checks
    // reversed) — this test went red, then the swap was reverted.
  });
});

describe('buildFindingsByFile', () => {
  it('expands each finding into every integer line in its inclusive range', () => {
    const map = buildFindingsByFile([{ file: 'src/foo.ts', start_line: 10, end_line: 12 }]);
    expect(map.get('src/foo.ts')).toEqual([10, 11, 12]);
  });

  it('dedupes overlapping ranges within the same file and sorts ascending', () => {
    const map = buildFindingsByFile([
      { file: 'src/foo.ts', start_line: 20, end_line: 22 },
      { file: 'src/foo.ts', start_line: 10, end_line: 11 },
      { file: 'src/foo.ts', start_line: 11, end_line: 12 },
    ]);
    expect(map.get('src/foo.ts')).toEqual([10, 11, 12, 20, 21, 22]);
  });

  it('keeps separate files in separate map entries', () => {
    const map = buildFindingsByFile([
      { file: 'a.ts', start_line: 1, end_line: 1 },
      { file: 'b.ts', start_line: 5, end_line: 6 },
    ]);
    expect(map.get('a.ts')).toEqual([1]);
    expect(map.get('b.ts')).toEqual([5, 6]);
  });

  it('returns an empty map for no findings', () => {
    expect(buildFindingsByFile([]).size).toBe(0);
  });
});

describe('computeSplit', () => {
  it('excludes boilerplate files from total_lines', () => {
    const split = computeSplit([
      { path: 'src/foo.ts', additions: 100, deletions: 0, role: 'core' },
      { path: 'pnpm-lock.yaml', additions: 5000, deletions: 5000, role: 'boilerplate' },
    ]);
    expect(split.total_lines).toBe(100);

    // MUTATION CHECK: temporarily removed the `role !== 'boilerplate'`
    // filter in computeSplit — total_lines became 10100 and this assertion
    // went red, confirming the exclusion is load-bearing. Reverted.
  });

  it('too_big is false at exactly the threshold and true just above it', () => {
    const atThreshold = computeSplit([
      { path: 'src/foo.ts', additions: SPLIT_TOO_BIG_LINES, deletions: 0, role: 'core' },
    ]);
    expect(atThreshold.too_big).toBe(false);
    expect(atThreshold.total_lines).toBe(SPLIT_TOO_BIG_LINES);

    const overThreshold = computeSplit([
      { path: 'src/foo.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0, role: 'core' },
    ]);
    expect(overThreshold.too_big).toBe(true);

    // MUTATION CHECK: temporarily flipped the comparator to `>=` — the
    // at-threshold assertion (`too_big === false`) went red. Reverted.
  });

  it('returns an empty proposed_splits array when not too_big', () => {
    const split = computeSplit([{ path: 'src/foo.ts', additions: 10, deletions: 0, role: 'core' }]);
    expect(split.too_big).toBe(false);
    expect(split.proposed_splits).toEqual([]);
  });

  it('groups eligible files by top-level path segment when too_big, using "(root)" for bare filenames', () => {
    const split = computeSplit([
      { path: 'server/src/a.ts', additions: SPLIT_TOO_BIG_LINES, deletions: 0, role: 'core' },
      { path: 'server/src/b.ts', additions: 10, deletions: 0, role: 'core' },
      { path: 'client/src/c.ts', additions: 10, deletions: 0, role: 'core' },
      { path: 'README.md', additions: 10, deletions: 0, role: 'wiring' },
      { path: 'huge-lockfile.lock', additions: 999999, deletions: 0, role: 'boilerplate' },
    ]);
    expect(split.too_big).toBe(true);
    expect(split.proposed_splits).toEqual(
      expect.arrayContaining([
        { name: 'server', files: ['server/src/a.ts', 'server/src/b.ts'] },
        { name: 'client', files: ['client/src/c.ts'] },
        { name: '(root)', files: ['README.md'] },
      ]),
    );
    // The boilerplate file must never appear in any group.
    expect(split.proposed_splits.some((g) => g.files.includes('huge-lockfile.lock'))).toBe(false);
  });
});

describe('buildSmartDiff', () => {
  it('returns groups in fixed core → wiring → boilerplate order', () => {
    const files = [
      { path: 'pnpm-lock.yaml', additions: 1, deletions: 1 },
      { path: 'vite.config.ts', additions: 1, deletions: 1 },
      { path: 'src/foo.ts', additions: 1, deletions: 1 },
    ];
    const smartDiff = buildSmartDiff(files, new Map());
    expect(smartDiff.groups.map((g) => g.role)).toEqual(['core', 'wiring', 'boilerplate']);
    expect(smartDiff.groups[0]?.files.map((f) => f.path)).toEqual(['src/foo.ts']);
    expect(smartDiff.groups[1]?.files.map((f) => f.path)).toEqual(['vite.config.ts']);
    expect(smartDiff.groups[2]?.files.map((f) => f.path)).toEqual(['pnpm-lock.yaml']);

    // MUTATION CHECK: temporarily reversed GROUP_ORDER to
    // ['boilerplate','wiring','core'] — the role-order assertion above went
    // red. Reverted.
  });

  it('sorts within a group by finding-line count desc, then churn desc', () => {
    const files = [
      { path: 'src/low-risk.ts', additions: 50, deletions: 50 }, // 0 findings, churn 100
      { path: 'src/high-risk.ts', additions: 1, deletions: 1 }, // 2 findings, churn 2
      { path: 'src/big-churn.ts', additions: 500, deletions: 0 }, // 0 findings, churn 500
    ];
    const findingsByFile = new Map<string, number[]>([['src/high-risk.ts', [1, 2]]]);
    const smartDiff = buildSmartDiff(files, findingsByFile);
    const core = smartDiff.groups.find((g) => g.role === 'core');
    expect(core?.files.map((f) => f.path)).toEqual(['src/high-risk.ts', 'src/big-churn.ts', 'src/low-risk.ts']);

    // MUTATION CHECK: temporarily dropped the finding-count comparison term
    // in compareByRisk (churn-only sort) — 'src/big-churn.ts' moved ahead of
    // 'src/high-risk.ts' and this assertion went red. Reverted.
  });

  it('sets pseudocode_summary to null on every file', () => {
    const smartDiff = buildSmartDiff([{ path: 'src/foo.ts', additions: 1, deletions: 1 }], new Map());
    const allFiles = smartDiff.groups.flatMap((g) => g.files);
    expect(allFiles.length).toBeGreaterThan(0);
    for (const file of allFiles) {
      expect(file.pseudocode_summary).toBeNull();
    }
  });

  it('assigns finding_lines from the map, defaulting to [] when absent', () => {
    const files = [
      { path: 'src/a.ts', additions: 1, deletions: 1 },
      { path: 'src/b.ts', additions: 1, deletions: 1 },
    ];
    const findingsByFile = new Map<string, number[]>([['src/a.ts', [3, 4]]]);
    const smartDiff = buildSmartDiff(files, findingsByFile);
    const core = smartDiff.groups.find((g) => g.role === 'core');
    const a = core?.files.find((f) => f.path === 'src/a.ts');
    const b = core?.files.find((f) => f.path === 'src/b.ts');
    expect(a?.finding_lines).toEqual([3, 4]);
    expect(b?.finding_lines).toEqual([]);
  });

  it('produces output that parses against the SmartDiff Zod schema', () => {
    const files = [
      { path: 'pnpm-lock.yaml', additions: SPLIT_TOO_BIG_LINES + 100, deletions: 0 },
      { path: 'vite.config.ts', additions: 10, deletions: 5 },
      { path: 'src/foo.ts', additions: SPLIT_TOO_BIG_LINES + 1, deletions: 0 },
    ];
    const findingsByFile = buildFindingsByFile([{ file: 'src/foo.ts', start_line: 1, end_line: 3 }]);
    const smartDiff = buildSmartDiff(files, findingsByFile);
    expect(() => SmartDiff.parse(smartDiff)).not.toThrow();

    const parsed = SmartDiff.parse(smartDiff);
    expect(parsed.split_suggestion.too_big).toBe(true);
  });
});
