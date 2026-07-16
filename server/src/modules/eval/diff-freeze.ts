import type { EvalExpectation, EvalExpectedItem, EvalForbiddenRegion, FindingKind } from '@devdigest/shared';
import { parseUnifiedDiff } from '../../adapters/git/diff-parser.js';
// Import from the grounding SUBPATH, not the `@devdigest/reviewer-core` barrel,
// on purpose: the barrel eagerly re-exports the LLM providers (`llm/structured`,
// `llm/openrouter`), which `import 'openai'` at module load. This file is pure and
// is pulled by `db/seed.ts`, which runs in CI BEFORE reviewer-core's deps are
// installed — importing the barrel there crashes with `Cannot find package 'openai'`.
// `grounding.ts` imports only shared types, so the subpath keeps this layer free of
// the LLM stack. Do NOT "tidy" this back to the barrel (that regression cost a CI run).
import { buildLineIndex, FULL_FILE_KINDS } from '@devdigest/reviewer-core/grounding.js';

/**
 * Diff-freeze integrity (AC-7).
 *
 * A frozen eval case is only satisfiable if the frozen diff can actually
 * ground the expectation it was seeded from. This is the check that turns
 * `server/src/modules/reviews/diff-loader.ts:37` ("if (!f.patch) continue;")
 * silently dropping a large file into a LOUD rejection at creation time,
 * instead of a case that can never pass and reads as a permanent recall
 * regression (`server/INSIGHTS.md:50`).
 *
 * PURE: no I/O, no DB, no model call. Parses the raw diff with
 * `parseUnifiedDiff`, checks coverage with `buildLineIndex`, and reuses the
 * gate's own `FULL_FILE_KINDS` set — the exact same building blocks the
 * grounding gate itself uses (`reviewer-core/src/grounding.ts`), so this
 * validator can never be stricter (or looser) than the gate that will
 * actually score the case.
 */

export type DiffFreezeRejection =
  | {
      ok: false;
      reason: 'file_missing';
      file: string;
      message: string;
    }
  | {
      ok: false;
      reason: 'lines_uncovered';
      file: string;
      start_line: number;
      end_line: number;
      message: string;
    };

export type DiffFreezeValidation = { ok: true } | DiffFreezeRejection;

interface Region {
  file: string;
  start_line: number;
  end_line: number;
  kind: FindingKind;
}

function checkRegion(
  region: Region,
  filesInDiff: Set<string>,
  lineIndex: Map<string, Set<number>>,
): DiffFreezeRejection | null {
  if (!filesInDiff.has(region.file)) {
    return {
      ok: false,
      reason: 'file_missing',
      file: region.file,
      message: `frozen diff has no hunk for '${region.file}' — the file is entirely absent from the captured diff`,
    };
  }

  // Full-file kinds ground on file presence alone — mirrors the grounding
  // gate exactly (reviewer-core/src/grounding.ts:59). A validator stricter
  // than the gate would reject cases the agent can legitimately satisfy.
  if (FULL_FILE_KINDS.has(region.kind)) return null;

  const lines = lineIndex.get(region.file) ?? new Set<number>();
  const lo = Math.min(region.start_line, region.end_line);
  const hi = Math.max(region.start_line, region.end_line);
  let covered = false;
  for (let n = lo; n <= hi; n++) {
    if (lines.has(n)) {
      covered = true;
      break;
    }
  }
  if (!covered) {
    return {
      ok: false,
      reason: 'lines_uncovered',
      file: region.file,
      start_line: region.start_line,
      end_line: region.end_line,
      message: `lines ${region.start_line}-${region.end_line} of '${region.file}' fall outside every hunk in the frozen diff`,
    };
  }
  return null;
}

/**
 * Verify a frozen diff can satisfy an eval case's expectation. Returns `{
 * ok: true }` when every expected item — and, for a negative case, the
 * forbidden region — has a hunk on its file and (for non-full-file kinds)
 * that hunk covers the expected new-side lines. Otherwise returns the first
 * named rejection encountered, in the order: expected items, then the
 * forbidden region.
 */
export function validateFreeze(
  rawDiff: string,
  expectation: EvalExpectation,
  expectedItems: EvalExpectedItem[],
  forbiddenRegion: EvalForbiddenRegion | null | undefined,
): DiffFreezeValidation {
  const diff = parseUnifiedDiff(rawDiff);
  const filesInDiff = new Set(diff.files.map((f) => f.path));
  const lineIndex = buildLineIndex(diff);

  for (const item of expectedItems) {
    const rejection = checkRegion(item, filesInDiff, lineIndex);
    if (rejection) return rejection;
  }

  if (expectation === 'must_not_flag' && forbiddenRegion) {
    const rejection = checkRegion(forbiddenRegion, filesInDiff, lineIndex);
    if (rejection) return rejection;
  }

  return { ok: true };
}
