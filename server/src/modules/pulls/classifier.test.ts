import { describe, it, expect } from 'vitest';
import { classifyFile } from './classifier.js';

/**
 * L03 verification harness — `pnpm verify:l03`.
 *
 * Proves `classifyFile()` routes each changed-file path to the right Smart Diff
 * bucket. 15 cases, 5 per category. If lock-files, build output, snapshots, and
 * migrations land in `boilerplate` (and config/barrels in `wiring`, logic in
 * `core`), the classifier's pattern precedence is correct.
 */
describe('classifyFile', () => {
  it('routes lock-files, build output, snapshots and migrations to boilerplate', () => {
    expect(classifyFile('pnpm-lock.yaml')).toBe('boilerplate');
    expect(classifyFile('0001_migration.sql')).toBe('boilerplate');
    expect(classifyFile('dist/bundle.js')).toBe('boilerplate');
    expect(classifyFile('src/__snapshots__/Button.test.tsx.snap')).toBe('boilerplate');
    expect(classifyFile('go.sum')).toBe('boilerplate');
  });

  it('routes config and barrel/index files to wiring', () => {
    expect(classifyFile('src/index.ts')).toBe('wiring');
    expect(classifyFile('vitest.config.ts')).toBe('wiring');
    expect(classifyFile('tsconfig.json')).toBe('wiring');
    expect(classifyFile('package.json')).toBe('wiring');
    expect(classifyFile('.github/workflows/ci.yml')).toBe('wiring');
  });

  it('routes business logic to core', () => {
    expect(classifyFile('src/modules/reviews/service.ts')).toBe('core');
    expect(classifyFile('server/src/modules/pulls/classifier.ts')).toBe('core');
    expect(classifyFile('client/src/app/page.tsx')).toBe('core');
    expect(classifyFile('reviewer-core/src/review/run.ts')).toBe('core');
    expect(classifyFile('src/utils/format.ts')).toBe('core');
  });
});
