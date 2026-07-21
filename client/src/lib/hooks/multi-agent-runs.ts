/* hooks/multi-agent-runs.ts — read side of the Multi-Agent Review (L07).

   One hook: the latest multi-run for a PR, as rendered by
   `/repos/:repoId/multi-agent/:number`. The CREATE side (agent picking +
   `POST /pulls/:id/multi-agent-runs`) lives in the sibling `multi-agent.ts`. */
"use client";

import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import type { MultiAgentRun } from "@devdigest/shared";

/** Query key for the latest multi-run of a PR (exported so callers can
 *  invalidate it after creating a new multi-run). */
export const latestMultiRunKey = (prId: string | null | undefined) =>
  ["multi-agent-run", "latest", prId] as const;

export const MULTI_RUN_POLL_MS = 4000;

/**
 * Poll only while at least one column is non-terminal; `false` = stop.
 * `done`, `failed` and `cancelled` are all terminal — `cancelled` in particular
 * is terminal-but-not-completed, so a cancelled agent must NOT keep the page
 * polling forever waiting for an answer that will never come.
 *
 * Extracted as a pure function so the self-clearing behaviour is unit-testable
 * without mounting a QueryClient.
 */
export function multiRunPollInterval(data: MultiAgentRun | null | undefined): number | false {
  return (data?.columns ?? []).some((c) => c.status === "running") ? MULTI_RUN_POLL_MS : false;
}

/**
 * The latest multi-agent run for a PR, or `null` when the PR has never had one
 * (the server answers 200 + `null`, not a 404 — that is the AC-14 empty state).
 *
 * AC-16: column status must reach its terminal value WITHOUT a manual refresh.
 * The transport is deliberately a self-clearing poll, not SSE — `useRunEvents`
 * (`hooks/reviews.ts:168-215`) exposes only `{events, running}` and carries no
 * status/score/cost/terminal signal, so it cannot drive a column header. This
 * mirrors the repo's existing live-status precedent, `usePrRuns`
 * (`hooks/reviews.ts:40-48`): poll only while something is non-terminal, and
 * return `false` (stop polling) as soon as every column has settled.
 */
export function useLatestMultiRun(prId: string | null | undefined) {
  return useQuery({
    queryKey: latestMultiRunKey(prId),
    queryFn: () => api.get<MultiAgentRun | null>(`/pulls/${prId}/multi-agent-runs/latest`),
    enabled: !!prId,
    refetchInterval: (query) => multiRunPollInterval(query.state.data),
  });
}
