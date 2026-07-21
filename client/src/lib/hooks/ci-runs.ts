/* hooks/ci-runs.ts — CI Runs page data (A3): the ingested `ci_runs` list
   (AC-38, AC-39, AC-40) and the explicit Refresh action (AC-32, AC-37). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiRun } from "@devdigest/shared";

/**
 * A run plus the repository it ran in.
 *
 * `CiRun` itself carries only `ci_installation_id`, but AC-40 requires a repository
 * column — so `GET /ci/runs` composes the slug onto each row from the installation join
 * it already performs for workspace scoping. Deriving it client-side by parsing
 * `github_url` also "works", but makes the table depend on a GitHub URL shape nothing
 * declares as a contract, and silently degrades whenever that URL is absent.
 *
 * Composed here rather than added to the `CiRun` contract: that contract is vendored in
 * two copies and this feature budgets exactly one mirrored edit.
 */
export type CiRunRow = CiRun & { repo: string };

/** No shared wrapper type exists for this compound response (only `CiRun`
 *  itself is vendored) — a thin local wrapper, same pattern as
 *  `SeedEvalCaseResult` in `evals.ts`. */
export interface CiRunsRefreshResult {
  runs: CiRunRow[];
  failed: Array<{ repo: string; message: string }>;
}

/**
 * Every CI run reachable installation → agent → workspace (AC-38), for the
 * CI Runs table (AC-39, AC-40).
 *
 * Deliberately has NO `refetchInterval` and NO `refetchOnWindowFocus` — this
 * is the one place that differs from `usePulls`'s shape (`hooks/core.ts`):
 * AC-32 forbids ingestion at any time other than an explicit Refresh press,
 * so leaving this page open in a tab must issue no request.
 */
export function useCiRuns() {
  return useQuery({
    queryKey: ["ci-runs"],
    queryFn: () => api.get<CiRunRow[]>("/ci/runs"),
  });
}

/**
 * The only trigger for ingestion (AC-32). One installation's GitHub failure
 * does not abort the rest — `failed` names the repos that could not be
 * refreshed (AC-37) so the caller can surface a partial-failure message
 * without blanking the table.
 */
export function useRefreshCiRuns() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<CiRunsRefreshResult>("/ci/runs/refresh"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ci-runs"] }),
  });
}
