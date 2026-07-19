/* EvalCaseModal — the eval-case editor as an inline modal (PR #8 review
   follow-up). Three entry points share it:
     - "Turn into eval case" on a decided finding (seed → edit by `caseId`),
     - "New case" on an agent's Evals tab (`agentId`, no `caseId`),
     - "Edit" a case row on that tab (edit by `caseId`).
   Editing/seeding fetches the full case (provenance + latest draft present);
   a new case starts blank and, once saved, keeps the created case in state so
   the same modal switches to edit affordances (Run case, draft result) with no
   reload. `onSaved` never closes the modal — the user dismisses via Cancel/X. */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { ErrorState, Modal, Skeleton } from "@devdigest/ui";
import type { EvalCase } from "@devdigest/shared";
import { useEvalCase } from "@/lib/hooks/evals";
import { ApiError } from "@/lib/api";
import { EvalCaseEditor } from "./EvalCaseEditor/EvalCaseEditor";

export function EvalCaseModal({
  caseId,
  agentId,
  agentName,
  onClose,
}: {
  /** Present for seed/edit; absent for a brand-new case. */
  caseId?: string;
  /** Required when creating a new case (no `caseId`). */
  agentId?: string;
  /** Owning agent's display name — used only for the positive subtitle. */
  agentName?: string;
  onClose: () => void;
}) {
  const t = useTranslations("eval");
  const { data: fetched, isLoading, isError, error, refetch } = useEvalCase(caseId);
  // A newly-created case, captured from the create mutation so the modal can
  // switch to edit affordances without waiting on a refetch.
  const [created, setCreated] = React.useState<EvalCase | null>(null);

  const existing = caseId ? fetched : created;
  const editorAgentId = existing?.owner_id ?? agentId ?? "";
  const isNegative = existing?.expectation === "must_not_flag";

  const title = existing ? t("caseEditor.caseTitle", { name: existing.name }) : t("caseEditor.newCase");
  const subtitle = isNegative
    ? t("caseEditor.subtitleNegative")
    : agentName
      ? t("caseEditor.subtitlePositive", { agent: agentName })
      : t("caseEditor.subtitlePositiveGeneric");

  const failedToLoad = !!caseId && (isError || (!isLoading && !fetched));
  const loadingExisting = !!caseId && !fetched && isLoading;

  return (
    <Modal width={900} title={title} subtitle={subtitle} onClose={onClose}>
      {failedToLoad ? (
        <div style={{ padding: "20px 24px 24px" }}>
          <ErrorState
            title="Couldn't load this eval case"
            body={error instanceof ApiError ? error.message : "This eval case could not be loaded."}
            onRetry={() => refetch()}
          />
        </div>
      ) : loadingExisting ? (
        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
          <Skeleton height={24} width={240} />
          <Skeleton height={200} />
        </div>
      ) : (
        <EvalCaseEditor
          agentId={editorAgentId}
          existingCase={existing ?? null}
          onSaved={setCreated}
          onCancel={onClose}
          chrome={false}
        />
      )}
    </Modal>
  );
}
