/* hooks/project-context.ts — React Query hooks for the Project Context
   discovery + doc-viewer/editor surface (AC-31, AC-32).

   NOTE: this is a SEPARATE feature from the orphaned semantic-indexing
   scaffold (`useContextFiles`/`useReindexContext` in `./core.ts`, the
   `SpecFile`/`IndexStatus` contracts). Query keys here are deliberately
   prefixed `project-context` (never bare `context`) to avoid colliding with
   that scaffold's `["context", repoId]` key. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { ProjectContextDocs, DocumentContent, SaveDocumentBody } from "@devdigest/shared";

// ---- Discovery + summary for a repo's project-context documents ----
export function useProjectContextDocs(repoId: string | null | undefined) {
  return useQuery({
    queryKey: ["project-context", repoId],
    queryFn: () => api.get<ProjectContextDocs>(`/repos/${repoId}/project-context`),
    enabled: !!repoId,
  });
}

// ---- Raw markdown of one discovered document (AC-31). `path` may
//      legitimately be absent before the user picks a document from the
//      list — the query stays idle rather than firing with an undefined
//      path (client/INSIGHTS.md:21 for the "T | null" GET convention). ----
export function useDocumentContent(
  repoId: string | null | undefined,
  path: string | null | undefined
) {
  return useQuery({
    queryKey: ["project-context-doc", repoId, path],
    queryFn: () =>
      api.get<DocumentContent | null>(
        `/repos/${repoId}/project-context/doc?path=${encodeURIComponent(path!)}`
      ),
    enabled: repoId != null && path != null,
  });
}

// ---- Edit-in-place save. Invalidates the saved document's own content
//      query (so the editor reflects the persisted text) and the discovery
//      query (the token estimate may change with the new content). ----
export interface SaveDocumentInput extends SaveDocumentBody {
  repoId: string;
}

export function useSaveDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, path, text }: SaveDocumentInput) =>
      api.put<DocumentContent>(`/repos/${repoId}/project-context/doc`, { path, text }),
    onSuccess: (_d, { repoId, path }) => {
      qc.invalidateQueries({ queryKey: ["project-context-doc", repoId, path] });
      qc.invalidateQueries({ queryKey: ["project-context", repoId] });
    },
  });
}
