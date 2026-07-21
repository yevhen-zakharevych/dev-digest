/* hooks/multi-agent.ts — React Query hooks for T3 (agent picker + Configure-run
   page): pre-run estimates (GET /agents/estimates) and multi-run creation
   (POST /pulls/:id/multi-agent-runs). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { latestMultiRunKey } from "./multi-agent-runs";
import type { AgentEstimate, CreateMultiRunResponse } from "@devdigest/shared";

/**
 * Per-agent time/cost hint scoped to a repo (AC-7). An agent with no `done`
 * history in the repo is simply absent from the response — never a fabricated
 * zero — so callers must treat "no row" the same as a `null` field.
 *
 * `retry: false` so a failing estimate source degrades to the "—" hint
 * immediately rather than blocking the picker while it retries (AC-10).
 */
export function useAgentEstimates(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-estimates", repoId],
    queryFn: () => api.get<AgentEstimate[]>(`/agents/estimates?repoId=${repoId}`),
    enabled: !!repoId,
    retry: false,
  });
}

export interface CreateMultiRunInput {
  prId: string;
  agentIds: string[];
}

/**
 * Create a multi-agent run for a PR (AC-3, AC-6, AC-11) — launches the chosen
 * agent set through the server's `runReview` fan-out and returns the created
 * multi-run + launched run targets. Callers navigate to the results page on
 * success; this never runs anything inline on the calling page.
 *
 * The `onSuccess` invalidation is load-bearing for AC-13, not hygiene: the
 * results page reads `latestMultiRunKey(prId)`, the global `staleTime` is 30s
 * with `refetchOnWindowFocus: false` (`lib/providers.tsx`), and
 * `multiRunPollInterval` stops polling once no column is `running`. So without
 * this, navigating to the results page within 30s of its last fetch serves the
 * PREVIOUS multi-run — or a cached `null` empty state on a first run — and the
 * self-clearing poll is already off, so nothing corrects it.
 */
export function useCreateMultiRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, agentIds }: CreateMultiRunInput) =>
      api.post<CreateMultiRunResponse>(`/pulls/${prId}/multi-agent-runs`, { agentIds }),
    onSuccess: (_data, { prId }) => {
      void qc.invalidateQueries({ queryKey: latestMultiRunKey(prId) });
    },
  });
}
