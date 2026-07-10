/* ProjectContextBody — the data-driven part of the Project Context page:
   loading/error/clone-unavailable/empty states, and (once documents are
   discovered) the two-pane master-detail layout: DocumentList on the left
   (flat list + search + AC-7 footer), DocumentDetail on the right (the
   selected document's Preview/Edit + "Used by N agents"). Split out from
   ProjectContextView (which owns AppShell + the repo-not-found guard) so
   this piece is testable without standing up the whole app shell — no
   existing test in this codebase wraps AppShell directly (it pulls in
   next/navigation's router + several more hooks), so route pages here
   follow the same "test the sub-component, not the AppShell wrapper" split
   already used by `pulls/_components/*`. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Skeleton, EmptyState, ErrorState } from "@devdigest/ui";
import { useProjectContextDocs } from "@/lib/hooks/project-context";
import { ApiError } from "@/lib/api";
import { DocumentList } from "../DocumentList/DocumentList";
import { DocumentDetail } from "../DocumentDetail/DocumentDetail";
import { s } from "./styles";

const SKELETON_ROWS = 4;

export function ProjectContextBody({ repoId }: { repoId: string }) {
  const t = useTranslations("projectContext");
  const { data, isLoading, isError, error, refetch } = useProjectContextDocs(repoId);
  const [selectedPath, setSelectedPath] = React.useState<string | null>(null);

  // Auto-select the first discovered document once discovery loads, so the
  // right pane isn't empty on initial load. Only fires while nothing is
  // selected yet — it never overrides a user's own selection.
  React.useEffect(() => {
    const first = selectedPath == null ? data?.documents[0] : undefined;
    if (first) setSelectedPath(first.path);
  }, [data, selectedPath]);

  if (isLoading) {
    return (
      <div style={s.stateWrap}>
        <div style={s.loadingStack}>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Skeleton key={i} height={44} />
          ))}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div style={s.stateWrap}>
        <ErrorState
          title={t("errorTitle")}
          body={error instanceof ApiError ? error.message : t("errorBody")}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  if (!data) return null;

  // AC-5: no clone on disk yet → explicit empty state, never an error toast.
  if (!data.clone_available) {
    return (
      <div style={s.stateWrap}>
        <EmptyState
          icon="GitBranch"
          title={t("cloneUnavailable.title")}
          body={t("cloneUnavailable.body")}
        />
      </div>
    );
  }

  if (data.documents.length === 0) {
    return (
      <div style={s.stateWrap}>
        <EmptyState icon="FileText" title={t("empty.title")} body={t("empty.body")} />
      </div>
    );
  }

  const selectedDoc = data.documents.find((doc) => doc.path === selectedPath) ?? null;

  return (
    <div style={s.page}>
      <DocumentList
        documents={data.documents}
        summary={data.summary}
        selectedPath={selectedPath}
        onSelect={setSelectedPath}
      />
      <DocumentDetail repoId={repoId} doc={selectedDoc} />
    </div>
  );
}
