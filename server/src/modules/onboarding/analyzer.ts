/**
 * L05 — Onboarding first-task analyzer (PURE — no I/O).
 *
 * Given facts already gathered by the service (source-file bodies, the full
 * indexed path set, per-file fan-out counts), compute the deterministic
 * first-task candidates + complexity badges (AC-7, AC-8). The model is NEVER
 * asked to source these — it only writes the narrative around them.
 *
 * Grounding (AC-7): a candidate exists ONLY for a source file that is (a)
 * untested (no corresponding test file in the indexed set) OR (b) carries a
 * TODO/FIXME marker. Zero untested files and zero markers ⇒ zero candidates.
 *
 * Badge (AC-8): a size (line-count) + fan-out (importer/caller count)
 * heuristic. Raising either dimension past a threshold changes the badge.
 */
import {
  BADGE_FANOUT_HIGH,
  BADGE_FANOUT_MED,
  BADGE_SIZE_LINES_HIGH,
  BADGE_SIZE_LINES_MED,
  SOURCE_FILE_EXTENSIONS,
  TEST_FILE_PATTERNS,
} from './constants.js';

export type ComplexityBadge = 'Low' | 'Medium' | 'High';
export type FirstTaskReason = 'untested' | 'todo';

/** One source file the service has already read a body + fan-out for. */
export interface SourceFileFact {
  /** Repo-relative POSIX path (from the index / git tree — never caller input). */
  path: string;
  /** File body, already read through the sandboxed GitClient. */
  body: string;
  /** Importer/caller count = number of graph edges touching this file. */
  fanOut: number;
}

export interface AnalyzeInput {
  /** Non-test source files with bodies read (bounded by the scan cap). */
  sourceFiles: SourceFileFact[];
  /** Every indexed path — used to detect a source file's test coverage. */
  allPaths: string[];
}

export interface FirstTaskCandidate {
  path: string;
  reason: FirstTaskReason;
  badge: ComplexityBadge;
}

/** TODO/FIXME marker scan — word-boundary, case-sensitive (matches convention). */
const TODO_FIXME_RE = /\b(TODO|FIXME)\b/;

/** True when a path matches any configured test-file convention. */
export function isTestFile(path: string): boolean {
  const lower = path.toLowerCase();
  return TEST_FILE_PATTERNS.some((p) => lower.includes(p));
}

/** True when a path has a source-code extension the scan understands. */
export function isSourceFile(path: string): boolean {
  const lower = path.toLowerCase();
  return SOURCE_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

/**
 * The module "stem" of a path: the basename with its extension and any test
 * markers stripped, e.g. `src/foo.ts` → `foo`, `src/foo.test.ts` → `foo`,
 * `pkg/bar_test.go` → `bar`. Used to match a source file to its test file.
 */
export function moduleStem(path: string): string {
  const base = path.split('/').pop() ?? path;
  // Drop everything from the first dot (handles `.test.ts`, `.d.ts`, `.tsx`).
  let stem = base.includes('.') ? base.slice(0, base.indexOf('.')) : base;
  // Strip a trailing `_test` / `_spec` marker (Go/Python style).
  stem = stem.replace(/_(test|spec)$/i, '');
  return stem;
}

/**
 * Deterministic complexity badge from file size (line count) + fan-out
 * (importer/caller count). Each dimension scores 0/1/2; total ≥3 ⇒ High,
 * ≥1 ⇒ Medium, else Low (AC-8).
 */
export function complexityBadge(lines: number, fanOut: number): ComplexityBadge {
  const sizePoints = lines >= BADGE_SIZE_LINES_HIGH ? 2 : lines >= BADGE_SIZE_LINES_MED ? 1 : 0;
  const fanPoints = fanOut >= BADGE_FANOUT_HIGH ? 2 : fanOut >= BADGE_FANOUT_MED ? 1 : 0;
  const score = sizePoints + fanPoints;
  if (score >= 3) return 'High';
  if (score >= 1) return 'Medium';
  return 'Low';
}

const BADGE_WEIGHT: Record<ComplexityBadge, number> = { High: 2, Medium: 1, Low: 0 };

/**
 * Compute the grounded first-task candidates (AC-7) with badges (AC-8). Pure:
 * same input ⇒ same output, no I/O. Order is deterministic — highest badge
 * first, then path (ascending) — so it is safe to assert on.
 */
export function analyzeFirstTasks(input: AnalyzeInput): FirstTaskCandidate[] {
  // The set of module stems that HAVE a test file anywhere in the index.
  const testedStems = new Set<string>();
  for (const p of input.allPaths) {
    if (isTestFile(p)) testedStems.add(moduleStem(p));
  }

  const candidates: FirstTaskCandidate[] = [];
  for (const f of input.sourceFiles) {
    if (isTestFile(f.path) || !isSourceFile(f.path)) continue;
    const lines = countLines(f.body);
    const hasTodo = TODO_FIXME_RE.test(f.body);
    const untested = !testedStems.has(moduleStem(f.path));
    if (!untested && !hasTodo) continue;
    candidates.push({
      path: f.path,
      // Prefer the "untested" framing; a file can be both, we surface one.
      reason: untested ? 'untested' : 'todo',
      badge: complexityBadge(lines, f.fanOut),
    });
  }

  candidates.sort((a, b) => {
    const byBadge = BADGE_WEIGHT[b.badge] - BADGE_WEIGHT[a.badge];
    if (byBadge !== 0) return byBadge;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  return candidates;
}

function countLines(body: string): number {
  if (body.length === 0) return 0;
  return body.split(/\r?\n/).length;
}
