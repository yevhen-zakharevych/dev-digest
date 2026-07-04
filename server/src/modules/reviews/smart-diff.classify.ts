/**
 * Pure classification helpers for Smart Diff (L03).
 *
 * No I/O, no DI, no LLM: everything here is plain-object-in / plain-object-out
 * over already-persisted `pr_files` + `findings` data. The application service
 * (`smart-diff.service.ts`, a separate task) is the only thing that touches
 * the repository; this module composes its inputs into the frozen `SmartDiff`
 * shape (`@devdigest/shared`, `contracts/brief.ts:81-113`).
 *
 * See `docs/plans/smart-diff.md` §5 "Classification algorithm" for the
 * authoritative spec.
 */
import type { SmartDiff, SmartDiffFile, SmartDiffGroup, SmartDiffRole } from '@devdigest/shared';
import { classifyFile } from '../pulls/classifier.js';
import { SPLIT_TOO_BIG_LINES } from './smart-diff.constants.js';

/**
 * Back-compat alias for the canonical classifier (`../pulls/classifier.ts`).
 * Kept so existing importers (e.g. `server/test/smart-diff-classify.test.ts`)
 * keep working; new code should import `classifyFile` from `pulls/classifier`.
 */
export const classifyRole = classifyFile;

/** A minimal changed-file shape sufficient for classification + churn math. */
export interface ChangedFileForSplit {
  path: string;
  additions: number;
  deletions: number;
}

/** Same shape, already classified — internal to this module's sort/group steps. */
interface ClassifiedFile extends ChangedFileForSplit {
  role: SmartDiffRole;
}

/** A minimal finding shape sufficient for building the per-file line map. */
export interface FindingForLines {
  file: string;
  start_line: number;
  end_line: number;
}

/**
 * Expand each finding's inclusive `[start_line, end_line]` range into the
 * set of new-side line numbers it covers, grouped per file, deduplicated and
 * sorted ascending.
 */
export function buildFindingsByFile(findings: FindingForLines[]): Map<string, number[]> {
  const linesByFile = new Map<string, Set<number>>();
  for (const finding of findings) {
    let lines = linesByFile.get(finding.file);
    if (!lines) {
      lines = new Set<number>();
      linesByFile.set(finding.file, lines);
    }
    for (let line = finding.start_line; line <= finding.end_line; line++) {
      lines.add(line);
    }
  }

  const result = new Map<string, number[]>();
  for (const [file, lines] of linesByFile) {
    result.set(file, Array.from(lines).sort((a, b) => a - b));
  }
  return result;
}

/** The top-level path segment used to group `proposed_splits` (`(root)` for a bare filename). */
function topLevelSegment(path: string): string {
  const slashIdx = path.indexOf('/');
  return slashIdx === -1 ? '(root)' : path.slice(0, slashIdx);
}

/**
 * Compute the `split_suggestion` block: churn is summed over `core` +
 * `wiring` files ONLY (boilerplate excluded, so a huge lockfile diff never
 * triggers "split this PR"). `proposed_splits` groups those same files by
 * top-level path segment, emitted only when `too_big`.
 */
export function computeSplit(files: ClassifiedFile[]): SmartDiff['split_suggestion'] {
  const eligible = files.filter((file) => file.role !== 'boilerplate');
  const total_lines = eligible.reduce((sum, file) => sum + file.additions + file.deletions, 0);
  const too_big = total_lines > SPLIT_TOO_BIG_LINES;

  if (!too_big) {
    return { too_big, total_lines, proposed_splits: [] };
  }

  const filesBySegment = new Map<string, string[]>();
  for (const file of eligible) {
    const segment = topLevelSegment(file.path);
    let paths = filesBySegment.get(segment);
    if (!paths) {
      paths = [];
      filesBySegment.set(segment, paths);
    }
    paths.push(file.path);
  }

  const proposed_splits = Array.from(filesBySegment, ([name, splitFiles]) => ({
    name,
    files: splitFiles,
  }));

  return { too_big, total_lines, proposed_splits };
}

/** Higher risk first: more finding lines wins; ties broken by higher churn. */
function compareByRisk(a: ClassifiedFile & { finding_lines: number[] }, b: ClassifiedFile & { finding_lines: number[] }): number {
  if (b.finding_lines.length !== a.finding_lines.length) {
    return b.finding_lines.length - a.finding_lines.length;
  }
  const churnA = a.additions + a.deletions;
  const churnB = b.additions + b.deletions;
  return churnB - churnA;
}

const GROUP_ORDER: SmartDiffRole[] = ['core', 'wiring', 'boilerplate'];

/**
 * Compose a PR's changed files + findings-by-file map into the frozen
 * `SmartDiff` shape: classify every file, group in fixed core→wiring→
 * boilerplate order, sort each group risk-first (finding count desc, then
 * churn desc), and compute `split_suggestion`. `pseudocode_summary` is always
 * `null` this lesson (`docs/plans/smart-diff.md` §9 assumption 1) — no
 * zero-LLM per-file source exists.
 */
export function buildSmartDiff(files: ChangedFileForSplit[], findingsByFile: Map<string, number[]>): SmartDiff {
  const classified = files.map((file) => ({
    ...file,
    role: classifyFile(file.path),
    finding_lines: findingsByFile.get(file.path) ?? [],
  }));

  const groups: SmartDiffGroup[] = GROUP_ORDER.map((role) => {
    const groupFiles: SmartDiffFile[] = classified
      .filter((file) => file.role === role)
      .sort(compareByRisk)
      .map((file) => ({
        path: file.path,
        pseudocode_summary: null,
        additions: file.additions,
        deletions: file.deletions,
        finding_lines: file.finding_lines,
      }));
    return { role, files: groupFiles };
  });

  return {
    groups,
    split_suggestion: computeSplit(
      classified.map((file) => ({
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        role: file.role,
      })),
    ),
  };
}
