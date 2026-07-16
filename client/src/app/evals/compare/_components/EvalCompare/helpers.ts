import type { EvalRunSummary } from "@devdigest/shared";

export type LineDiffOp = { type: "same" | "add" | "remove"; text: string };

/**
 * Pure line-level diff (LCS-based) between two system prompts (AC-24). No
 * diff library is a dependency of this client (`package.json` has none) —
 * this is small enough (system prompts, not source trees) to be worth
 * writing directly rather than pulling one in.
 */
export function diffLines(a: string, b: string): LineDiffOp[] {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const n = linesA.length;
  const m = linesB.length;

  // Standard LCS length table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = linesA[i] === linesB[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }

  const ops: LineDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (linesA[i] === linesB[j]) {
      ops.push({ type: "same", text: linesA[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: "remove", text: linesA[i]! });
      i++;
    } else {
      ops.push({ type: "add", text: linesB[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ type: "remove", text: linesA[i]! });
    i++;
  }
  while (j < m) {
    ops.push({ type: "add", text: linesB[j]! });
    j++;
  }
  return ops;
}

export function hasLineChanges(ops: LineDiffOp[]): boolean {
  return ops.some((o) => o.type !== "same");
}

export function runLabel(run: EvalRunSummary): string {
  return run.agent_version != null ? `v${run.agent_version}` : run.id.slice(0, 8);
}

const QUALITY_METRICS = ["recall", "precision", "citation_accuracy"] as const;
export type QualityMetric = (typeof QUALITY_METRICS)[number];

/** AC-28: which metrics make `candidate` worse than `base` (nulls never
 *  compare as a regression — an absent measurement is not "worse"). */
export function regressions(
  base: Pick<EvalRunSummary, QualityMetric>,
  candidate: Pick<EvalRunSummary, QualityMetric>,
): QualityMetric[] {
  return QUALITY_METRICS.filter((m) => base[m] != null && candidate[m] != null && candidate[m]! < base[m]!);
}
