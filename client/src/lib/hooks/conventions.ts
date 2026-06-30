/* hooks/conventions.ts — React Query hooks for the Conventions Extractor.

   Surfaces the workflow:
     extract → wait via SSE → list → accept/reject/edit → create-skill.

   Live progress reuses the existing `/runs/:id/events` SSE bridge through
   `useRunEvents` (see `hooks/reviews.ts`). The `scanId` returned by the
   extract endpoint is the SSE runId. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  ConventionCandidate,
  ConventionScanSummary,
  ConventionSkillPreview,
  ConventionStatus,
  Skill,
} from "@devdigest/shared";

export function useConventions(
  repoId: string | null | undefined,
  statuses: ConventionStatus[] = ["pending", "accepted"],
) {
  const statusParam = statuses.join(",");
  return useQuery({
    queryKey: ["conventions", repoId, statusParam],
    queryFn: () =>
      api.get<ConventionCandidate[]>(
        `/repos/${repoId}/conventions?status=${encodeURIComponent(statusParam)}`,
      ),
    enabled: !!repoId,
  });
}

export function useLatestConventionScan(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["conventions-scan-latest", repoId],
    queryFn: () =>
      api.get<ConventionScanSummary>(`/repos/${repoId}/conventions/scans/latest`),
    enabled: !!repoId,
  });
}

export function useExtractConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<{ scanId: string; jobId: string }>(
        `/repos/${repoId}/conventions/extract`,
      ),
    onSuccess: (_data, repoId) => {
      qc.invalidateQueries({ queryKey: ["conventions-scan-latest", repoId] });
    },
  });
}

export interface UpdateConventionInput {
  id: string;
  repoId: string;
  patch: { status?: ConventionStatus; rule?: string };
}

export function useUpdateConvention() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["conventions", vars.repoId] });
    },
  });
}

export interface CreateSkillFromConventionsInput {
  repoId: string;
  candidateIds: string[];
  name: string;
  description: string;
  body: string;
  enabled?: boolean;
}

export function useCreateSkillFromConventions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, candidateIds, ...rest }: CreateSkillFromConventionsInput) =>
      api.post<Skill>(`/repos/${repoId}/conventions/create-skill`, {
        candidate_ids: candidateIds,
        ...rest,
      }),
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["conventions", vars.repoId] });
    },
  });
}

/** Server-computed preview (name/description/body) seeding the create-skill modal. */
export function useConventionSkillPreview(
  repoId: string | null | undefined,
  candidateIds: string[],
) {
  const idsParam = candidateIds.slice().sort().join(",");
  return useQuery({
    queryKey: ["conventions-skill-preview", repoId, idsParam],
    queryFn: () =>
      api.get<ConventionSkillPreview>(
        `/repos/${repoId}/conventions/create-skill/preview?candidate_ids=${encodeURIComponent(idsParam)}`,
      ),
    enabled: !!repoId && candidateIds.length > 0,
  });
}
