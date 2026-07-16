/* /evals/cases/new — hand-author a new (always `must_find`) eval case for an
   agent. Reached from the Evals tab's "New case" control with `?agentId=`. */
"use client";

import React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ErrorState, SelectInput } from "@devdigest/ui";
import { AppShell } from "../../../../components/app-shell/AppShell";
import { useAgents } from "../../../../lib/hooks/agents";
import { EvalCaseEditor } from "../_components/EvalCaseEditor/EvalCaseEditor";

export default function NewEvalCasePage() {
  const t = useTranslations("eval.page");
  const router = useRouter();
  const search = useSearchParams();
  const agentIdParam = search.get("agentId");
  const { data: agents } = useAgents();
  const [pickedAgentId, setPickedAgentId] = React.useState<string | null>(agentIdParam);

  const agentId = agentIdParam ?? pickedAgentId;

  const crumb = [{ label: t("crumbAgents"), href: "/agents" }, { label: t("crumbNewCase") }];

  if (!agentId) {
    // Reached directly (no `?agentId=`) — let the user pick which agent
    // owns the new case rather than erroring.
    return (
      <AppShell crumb={crumb}>
        <div style={{ padding: 28, maxWidth: 420, display: "flex", flexDirection: "column", gap: 12 }}>
          {agents && agents.length > 0 ? (
            <SelectInput
              value={pickedAgentId ?? ""}
              onChange={setPickedAgentId}
              options={[{ value: "", label: "Select an agent…" }, ...agents.map((a) => ({ value: a.id, label: a.name }))]}
            />
          ) : (
            <ErrorState title="No agents yet" body="Create an agent first, then add an eval case from its Evals tab." />
          )}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell crumb={crumb}>
      <EvalCaseEditor
        agentId={agentId}
        existingCase={null}
        onSaved={(c) => router.push(`/evals/cases/${c.id}`)}
      />
    </AppShell>
  );
}
