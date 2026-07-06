/* hooks/brief.ts — React Query hooks for PR intent (Intent Layer, L03).
   Cheap DB read on the PR page; recompute forces a fresh classification. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { PrIntentRecord, SmartDiff } from "@devdigest/shared";

// ---- Stored intent for a PR (cheap DB read, no LLM) ----
export function usePrIntent(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["intent", prId],
    queryFn: () => api.get<PrIntentRecord | null>(`/pulls/${prId}/intent`),
    enabled: prId != null,
  });
}

// ---- Smart Diff composition for a PR (deterministic, always computes) ----
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: ["smart-diff", prId],
    queryFn: () => api.get<SmartDiff>(`/pulls/${prId}/smart-diff`),
    enabled: prId != null,
  });
}

// ---- Force a fresh intent classification for a PR ----
export interface RecomputeIntentInput {
  prId: string | number;
}

export function useRecomputeIntent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId }: RecomputeIntentInput) =>
      api.post<PrIntentRecord>(`/pulls/${prId}/intent`),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["intent", prId] });
    },
  });
}
