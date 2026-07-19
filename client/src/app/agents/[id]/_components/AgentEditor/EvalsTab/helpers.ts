/* Pure helpers for the Evals tab (T12) — no I/O, no React. Colocated (not
   lifted to `lib/`) because these are specific to how THIS tab reconciles
   the agent-scoped eval hooks (`useAgentEvalDashboard`/`useEvalCases`/
   `useEvalRun`) into per-case rows; nothing else in the client consumes
   them yet (co-location rule, `client/AGENTS.md`).

   NOTE: `client/src/features/evals/format.ts` already carries a near-
   identical `formatPercent`/`formatCost`/`formatDateTime` set, but that
   module is route-local (`_lib` under `app/evals/**`, owned by a sibling
   task in this same wave) and the architecture convention is explicit that
   sibling route trees must not reach into each other's `_lib` — lift to
   `src/lib/` instead if a THIRD consumer appears. Duplicating ~15 lines here
   is cheaper than a cross-route import or a premature lib/ promotion. */
import type { EvalCase, EvalCaseResult, EvalRunSummary } from "@devdigest/shared";

/** A null metric is an ABSENT measurement, not a zero (AC-31/AC-32) — "—". */
export function formatPercent(v: number | null | undefined, dash = "—"): string {
  if (v == null) return dash;
  return `${Math.round(v * 100)}%`;
}

export function formatDateTime(iso: string | null | undefined, dash = "—"): string {
  if (!iso) return dash;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? dash : d.toLocaleString();
}

/** `recent_runs` order isn't pinned by contract — resolved defensively by
 *  `started_at` rather than assumed to be sorted. */
export function latestOf(runs: EvalRunSummary[]): EvalRunSummary | null {
  if (runs.length === 0) return null;
  return runs.reduce((a, b) => (new Date(b.started_at).getTime() > new Date(a.started_at).getTime() ? b : a));
}

/** The run that anchors the case list + headline (AC-46): the newest
 *  SETTLED (`done`) run — an in-flight run has no metrics yet. */
export function latestDoneRun(runs: EvalRunSummary[]): EvalRunSummary | null {
  return latestOf(runs.filter((r) => r.status === "done"));
}

export function inFlightRun(runs: EvalRunSummary[]): EvalRunSummary | null {
  return runs.find((r) => r.status === "running") ?? null;
}

export type CaseRowStatus =
  | { kind: "never_run" }
  | { kind: "not_measured" }
  | { kind: "pending" }
  | { kind: "result"; result: EvalCaseResult };

/**
 * Per-case display status against the run the tab is currently anchored to
 * (the in-flight run while one is running — so rows fill in live — else the
 * latest done run). `detailRun` may be running while `results` only has the
 * cases scored so far; a case not yet in `results` is "pending" while
 * running, or "not yet measured" (AC-50) once the run has settled without
 * ever covering it (added after the run started).
 */
export function statusForCase(
  caseId: string,
  detailRun: EvalRunSummary | null,
  results: EvalCaseResult[] | undefined,
): CaseRowStatus {
  if (!detailRun) return { kind: "never_run" };
  const result = results?.find((r) => r.case_id === caseId);
  if (result) return { kind: "result", result };
  return detailRun.status === "running" ? { kind: "pending" } : { kind: "not_measured" };
}

/** A draft only outranks a run's own recorded result for THIS case when it
 *  postdates the run the row is anchored to (AC-50) — an older draft under a
 *  newer run is stale history, not the row's headline. */
export function draftIsNewer(draftRanAt: string, run: EvalRunSummary | null): boolean {
  if (!run) return true;
  return new Date(draftRanAt).getTime() > new Date(run.started_at).getTime();
}

/** "expected N, got M" (AC-30) — mirrors the scorer's own fields
 *  (`server/src/modules/eval/scorer.ts`): for `must_find`, N is the case's
 *  own expected-item count and M is how many were matched; for
 *  `must_not_flag`, N is 0 (nothing should be found) and M is every
 *  surviving finding the run recorded for the case (extra noise elsewhere
 *  never fails the case, but it is still worth naming). */
export function caseExpectedGot(c: EvalCase, result: EvalCaseResult): { expected: number; got: number } {
  if (c.expectation === "must_find") {
    return { expected: c.expected_output.length, got: result.matched_expected_indices.length };
  }
  return { expected: 0, got: result.kept_count };
}
