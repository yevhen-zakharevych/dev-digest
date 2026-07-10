/* hooks/brief.ts — React Query hooks for the PR page: intent (Intent Layer,
   L03), smart-diff/blast, and the Why+Risk Brief (L06). Cheap DB reads;
   recompute/generate force a fresh computation. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  PrIntentRecord,
  SmartDiff,
  BlastRadius,
  BriefResponse,
  GenerateBriefRequest,
} from "@devdigest/shared";

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

// ---- Blast Radius for a PR (deterministic, reads the repo-intel index —
//      always returns a real BlastRadius, degraded state is encoded in its
//      `summary`, so no `T | null` here — see client/INSIGHTS.md:21) ----
export function useBlastRadius(prId: string | number) {
  return useQuery({
    queryKey: ["blast", prId],
    queryFn: () => api.get<BlastRadius>(`/pulls/${prId}/blast`),
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

// ---- Why+Risk Brief (L06, PrBriefCard) ----
// The GET returns a non-null `BriefResponse` wrapper discriminated by
// `status` ('fresh'|'stale'|'not_generated'|'degraded') — a deliberate
// deviation from the usual `T | null` lazily-computed-artifact shape (see
// client/INSIGHTS.md:21 and docs/plans/L06-why-risk-brief.md §7). Reading a
// fresh/stale brief makes zero model calls; generation is synchronous on the
// POST (no job, no SSE — mirrors `POST /pulls/:id/intent` above).

/** Read the persisted brief for a PR (cheap DB read + a head-SHA freshness
   compare on the server; no model call). */
export function usePrBrief(prId: string | number | null | undefined) {
  return useQuery({
    queryKey: ["brief", prId],
    queryFn: () => api.get<BriefResponse>(`/pulls/${prId}/brief`),
    enabled: prId != null,
  });
}

export interface GenerateBriefInput {
  prId: string | number;
  /** `true` = Regenerate: force a fresh single-call generation against the
     current head, replacing the stored brief (AC-15). Omitted/false = the
     initial Generate for a never-generated PR. */
  force?: boolean;
}

/** Generate or Regenerate a brief. Invalidates the `["brief", prId]` query
   on success so the card re-reads the persisted result (no extra model
   call on the follow-up read). */
export function useGenerateBrief() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ prId, force }: GenerateBriefInput) =>
      api.post<BriefResponse>(`/pulls/${prId}/brief`, { force } satisfies GenerateBriefRequest),
    onSuccess: (_d, { prId }) => {
      qc.invalidateQueries({ queryKey: ["brief", prId] });
    },
  });
}
