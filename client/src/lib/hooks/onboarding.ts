/* hooks/onboarding.ts — TanStack Query hooks for the Onboarding Generator (C1).

   Surfaces the workflow:
     read persisted artifact (or null) → Generate/Regenerate → either
       (a) async full generation: { scanId } — subscribe via `useRunEvents`
           (see hooks/reviews.ts) and refetch the GET on completion, or
       (b) sync degraded path: an OnboardingResponse returned directly,
           written straight into the query cache — NO SSE progress ever
           renders on this path (plan §13 Gap 3).

   The GET is typed `OnboardingResponse | null` — `null` means "never
   generated yet" for this repo, not a loading/error state (client/INSIGHTS.md:21). */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { OnboardingResponse } from "@devdigest/shared";

/** POST /repos/:repoId/onboarding/generate resolves to EITHER shape. */
export type OnboardingGenerateResult = { scanId: string } | OnboardingResponse;

/** Discriminate the generate response: an async full-generation run carries
 * `scanId` (the SSE run id); the synchronous degraded path carries the
 * artifact directly and has no `scanId`. */
export function isOnboardingScanResult(
  result: OnboardingGenerateResult,
): result is { scanId: string } {
  return typeof (result as { scanId?: unknown }).scanId === "string";
}

/** Read the persisted onboarding artifact for a repo. `null` = never
 * generated. While a generation is in flight (`generating: true`, e.g. after
 * a page reload with no local `scanId` to re-subscribe SSE to — see
 * client/INSIGHTS.md:92-93) poll until it resolves. */
export function useOnboarding(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["onboarding", repoId],
    queryFn: () => api.get<OnboardingResponse | null>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    refetchInterval: (query) => (query.state.data?.generating ? 3000 : false),
  });
}

export interface GenerateOnboardingInput {
  repoId: string;
  force?: boolean;
}

/** Generate/Regenerate. `force: true` = Regenerate (AC-15). On the
 * synchronous degraded path, the response IS the fresh artifact — write it
 * straight into the GET cache so the view re-renders without another round
 * trip. On the async path the caller subscribes to SSE via the returned
 * `scanId` and refetches the GET once the stream finishes. */
export function useGenerateOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, force }: GenerateOnboardingInput) =>
      api.post<OnboardingGenerateResult>(`/repos/${repoId}/onboarding/generate`, {
        ...(force ? { force } : {}),
      }),
    onSuccess: (result, { repoId }) => {
      if (!isOnboardingScanResult(result)) {
        qc.setQueryData(["onboarding", repoId], result);
      }
    },
  });
}
