import type { Finding, Review, UnifiedDiff } from '@devdigest/shared';

/**
 * Reduce + slice helpers for map-reduce reviews. Pure (no DB / `this`), so they
 * live in the engine and are shared by the server and the CI runner.
 */

/**
 * Per-severity penalty subtracted from a perfect 100. Chosen so the score
 * tracks the findings the UI actually shows: 0 findings ⇒ 100, one suggestion
 * ⇒ 97, one warning ⇒ 88, one critical ⇒ 65.
 */
const SEVERITY_PENALTY: Record<Finding['severity'], number> = {
  CRITICAL: 35,
  WARNING: 12,
  SUGGESTION: 3,
};

/**
 * Deterministic 0–100 quality score derived from the (grounded) findings —
 * NOT the model's self-reported `score`, which has no anchor and drifts wildly
 * between models (a cheap model can "approve" with zero findings yet emit 10).
 * This mirrors how the review *event* is already computed from severities in
 * `to-review.ts`, so the number on screen can never contradict the findings
 * beneath it.
 */
export function scoreFromFindings(findings: Finding[]): number {
  const penalty = findings.reduce((sum, f) => sum + (SEVERITY_PENALTY[f.severity] ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

/** Verdict severity order for the reduce step (worst verdict wins). */
const VERDICT_RANK: Record<string, number> = {
  request_changes: 2,
  comment: 1,
  approve: 0,
};

/**
 * Merge N partial Reviews (one per mapped file/chunk) into a single Review:
 * concat findings, take the worst verdict, mean score, joined summaries.
 */
export function reduceReviews(partials: Review[]): Review {
  if (partials.length === 1) return partials[0]!;
  const findings = partials.flatMap((p) => p.findings);
  let verdict: Review['verdict'] = 'approve';
  for (const p of partials) {
    if ((VERDICT_RANK[p.verdict] ?? 0) > (VERDICT_RANK[verdict] ?? 0)) verdict = p.verdict;
  }
  const score = partials.length
    ? Math.round(partials.reduce((s, p) => s + p.score, 0) / partials.length)
    : 0;
  const summary = partials.map((p) => p.summary).filter(Boolean).join(' ');
  return { verdict, score, summary, findings };
}

/**
 * Prefix every kept (context/added) line of a raw unified diff with its
 * absolute NEW-file line number, e.g. `15:+export function foo() {`.
 *
 * Without this, the model has to derive the absolute line itself by counting
 * from the `@@ -oldStart,oldLines +newStart,newLines @@` hunk header — and it
 * reliably miscounts leading context lines (observed: reports the line where
 * the interesting code starts as if it were `newStart`, skipping the context
 * lines before it). The citation-grounding gate (`grounding.ts`) only checks
 * that a finding's line falls somewhere inside a hunk, so a plausible-but-off
 * line survives it. Annotating removes the counting step entirely: the model
 * copies a number instead of computing one.
 *
 * Deleted lines carry no new-file line number (they don't exist in the new
 * file) and are left unprefixed.
 */
export function annotateDiffLines(raw: string): string {
  const hadTrailingNewline = raw.endsWith('\n');
  const lines = raw.split('\n');
  if (hadTrailingNewline) lines.pop();

  const out: string[] = [];
  let newLineCursor = 0;
  let inHunk = false;

  for (const line of lines) {
    const hh = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
    if (hh) {
      newLineCursor = Number(hh[3]);
      inHunk = true;
      out.push(line);
      continue;
    }
    if (line.startsWith('diff --git') || line.startsWith('--- ') || line.startsWith('+++ ')) {
      inHunk = false;
      out.push(line);
      continue;
    }
    if (!inHunk) {
      out.push(line);
      continue;
    }
    if (line.startsWith('-') && !line.startsWith('---')) {
      out.push(line); // deletion: no new-side line to cite
    } else {
      out.push(`${newLineCursor}:${line}`);
      newLineCursor++;
    }
  }

  const result = out.join('\n');
  return hadTrailingNewline ? `${result}\n` : result;
}

/** Extract the slice of the unified diff for a single file (for map chunks). */
export function sliceDiff(diff: UnifiedDiff, path: string): string {
  const lines = diff.raw.split('\n');
  const out: string[] = [];
  let capture = false;
  for (const line of lines) {
    if (line.startsWith('diff --git'))
      capture = line.includes(`b/${path}`) || line.includes(` ${path}`);
    if (capture) out.push(line);
  }
  if (out.length > 0) return out.join('\n');
  // fallback: synthesize from the file's hunks
  const f = diff.files.find((x) => x.path === path);
  if (!f) return diff.raw;
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}`;
}
