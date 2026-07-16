/* /evals/cases/:id — edit an existing eval case (hand-authored or seeded
   from a decided finding). */
"use client";

import React from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, Skeleton } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell/AppShell";
import { useEvalCase } from "../../../../lib/hooks/evals";
import { ApiError } from "../../../../lib/api";
import { EvalCaseEditor } from "../_components/EvalCaseEditor/EvalCaseEditor";

export default function EvalCasePage() {
  const t = useTranslations("eval.page");
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { data: evalCase, isLoading, isError, error, refetch } = useEvalCase(params.id);

  const crumb = [{ label: t("crumbAgents"), href: "/agents" }, { label: t("crumbEvalCase") }];

  if (isError || (!isLoading && !evalCase)) {
    return (
      <AppShell crumb={crumb}>
        <ErrorState
          fullScreen
          title="Couldn't load this eval case"
          body={error instanceof ApiError ? error.message : "This eval case could not be loaded."}
          onRetry={() => refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      {isLoading || !evalCase ? (
        <div style={{ padding: 28, display: "flex", flexDirection: "column", gap: 16, maxWidth: 860 }}>
          <Skeleton height={24} width={240} />
          <Skeleton height={200} />
        </div>
      ) : (
        <EvalCaseEditor
          agentId={evalCase.owner_id}
          existingCase={evalCase}
          onSaved={() => router.push(`/evals/cases/${evalCase.id}`)}
        />
      )}
    </AppShell>
  );
}
