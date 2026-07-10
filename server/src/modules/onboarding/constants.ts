/** L05 — Onboarding Generator: module-local literals. */

import type { OnboardingSection } from '@devdigest/shared';

/** JobRunner kind for a full (index-present) onboarding generation. */
export const ONBOARDING_JOB_KIND = 'onboarding_generate' as const;

/**
 * The five fixed section kinds, in canonical order. `normalize.ts` restricts
 * every produced section's `kind` to this vocabulary and never reorders it
 * (AC-1, AC-2). `kind` is a free string on the wire contract, so the fixed set
 * is enforced here, server-side.
 */
export const ONBOARDING_SECTION_KINDS = [
  'architecture',
  'critical_paths',
  'run_locally',
  'reading_path',
  'first_tasks',
] as const;

export type OnboardingSectionKind = (typeof ONBOARDING_SECTION_KINDS)[number];

/** Only `architecture` may carry a mermaid diagram (AC-3). */
export const DIAGRAM_ELIGIBLE_KIND: OnboardingSectionKind = 'architecture';

/**
 * Mermaid headers a diagram must start with to be kept (N1 heuristic). Matches
 * the diagram rules in `prompts/onboarding.system.md` — no new parser dep.
 */
export const MERMAID_HEADERS = ['flowchart', 'graph', 'sequenceDiagram'] as const;

/**
 * How many top-ranked files seed the reading path (AC-6). The service asks the
 * facade for this many, ordered by descending rank.
 */
export const READING_PATH_FILE_COUNT = 12;

/**
 * Hard cap on how many source files the first-task scan reads bodies for
 * (AC-7). Bounds the TODO/FIXME + untested scan cost; grounding holds
 * regardless of the cap. Files are the top indexed source files by rank.
 */
export const FIRST_TASK_SCAN_FILE_CAP = 60;

/**
 * Test-file conventions used to (a) exclude test files from the untested-source
 * candidate set and (b) detect whether a source file has a corresponding test
 * (AC-7). Substring/suffix match on the repo-relative POSIX path. The exact set
 * is an implementation detail — AC-7 grounding holds regardless.
 */
export const TEST_FILE_PATTERNS = [
  '.test.',
  '.spec.',
  '_test.', // *_test.py / *_test.go
  '__tests__/',
  '/test/',
  '/tests/',
] as const;

/** File extensions the untested + TODO/FIXME scan treats as source. */
export const SOURCE_FILE_EXTENSIONS = [
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rb',
  '.rs',
  '.java',
] as const;

/**
 * Complexity-badge thresholds (AC-8). A deterministic size (line-count) +
 * fan-out (importer/caller count) heuristic. Each dimension contributes 0/1/2
 * points; total ≥3 ⇒ High, ≥1 ⇒ Medium, else Low. Raising either a file's
 * line count or its fan-out past a threshold changes its badge.
 */
export const BADGE_SIZE_LINES_MED = 120;
export const BADGE_SIZE_LINES_HIGH = 350;
export const BADGE_FANOUT_MED = 3;
export const BADGE_FANOUT_HIGH = 8;

/**
 * Per-route rate limit for the generate endpoint — tighter than the 120/min
 * global default because it is an LLM-calling, cost-incurring route (AC-23).
 * Disabled entirely under NODE_ENV=test; the it-test asserts the override
 * exists, not a live 429 (N3).
 */
export const ONBOARDING_GENERATE_RATE_LIMIT = { max: 12, timeWindow: '1 minute' } as const;

/** English titles for the deterministic degraded skeleton (AC-11). */
export const SKELETON_TITLES: Record<OnboardingSectionKind, string> = {
  architecture: 'Architecture',
  critical_paths: 'Critical paths',
  run_locally: 'Run it locally',
  reading_path: 'Reading path',
  first_tasks: 'First tasks',
};

/** An empty section carries these defaults on the wire. */
export const EMPTY_SECTION: Pick<OnboardingSection, 'diagram' | 'links'> = {
  diagram: null,
  links: [],
};
