/* hooks/ci-export.ts — React Query hooks for the L06/A4 Export-to-CI surface
   (the agent editor's CI tab + its Export wizard). Single data-access surface
   for this feature: no component under `AgentEditor/_components/CiTab/` may
   call `api` directly (client/CLAUDE.md — "no fetch() in a component").

   Route surface (server does not exist yet at implementation time — this
   file is tested against a mocked `fetch`, per client/CLAUDE.md):
     POST /agents/:id/ci/preview               -> CiFile[]
     POST /agents/:id/export-ci                -> CiExport
     GET  /agents/:id/ci/installations         -> Array<CiInstallation & { last_run: CiRun | null }>
     POST /ci/installations/:id/update-config  -> { pr_url: string | null; files: CiFile[] } */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { CiExport, CiExportInputBody, CiFile, CiInstallation, CiRun } from "@devdigest/shared";

/** Preview the generated CI bundle without any write (AC-5) — no branch, no
 *  commit, no installation row. A mutation (not a query) because it is a
 *  POST the wizard fires deliberately on entering the Preview step, not a
 *  cacheable GET. */
export function useCiPreview() {
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.post<CiFile[]>(`/agents/${agentId}/ci/preview`, input),
  });
}

/** Open (or persist) the export — the wizard's Install step CTA. */
export function useExportToCi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CiExportInputBody }) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["ci-installations", agentId] });
    },
  });
}

/** One row per repository this agent is installed into, each carrying its
 *  most recently ingested run (or `null` — AC-43). The composed shape is
 *  declared where it's consumed (`_components/CiTab/types.ts`) from these
 *  same two vendored contracts — this hook's own return type is the same
 *  intersection, inferred structurally, so the contract is composed, not
 *  redefined, in either place. */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["ci-installations", agentId],
    queryFn: () => api.get<Array<CiInstallation & { last_run: CiRun | null }>>(`/agents/${agentId}/ci/installations`),
    enabled: !!agentId,
  });
}

/** Per-installation-row "Update CI config" (AC-30/AC-31) — there is
 *  deliberately no bulk/header-level variant of this mutation. */
export function useUpdateCiConfig() {
  const qc = useQueryClient();
  return useMutation({
    // Body-less on purpose. Update-config regenerates the manifest and skill files from
    // the agent's CURRENT stored config and commits them to the branch the installation
    // row already names — so there is nothing for the caller to supply, and the server
    // route accordingly declares no body schema and reads none.
    //
    // It previously sent an export-shaped payload (`repo`/`target`/`action`), which was
    // silently discarded. That is worse than useless: it implies passing `triggers` or
    // `post_as` here would change something, when update-config deliberately never
    // rewrites the workflow — doing so would reset the wizard choices the export made.
    mutationFn: ({ installationId }: { installationId: string }) =>
      api.post<{ pr_url: string | null; files: CiFile[] }>(
        `/ci/installations/${installationId}/update-config`,
      ),
    onSuccess: () => {
      // The response carries no agentId to scope the invalidation to a single
      // key, so every installations list is refreshed — cheap (one row-list
      // per agent) and always correct.
      qc.invalidateQueries({ queryKey: ["ci-installations"] });
    },
  });
}
