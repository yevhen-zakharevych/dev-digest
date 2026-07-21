/* CiTab (agent editor) — CI deployment surface (AC-42 wires the tab itself;
   this component covers AC-1, AC-29 .. AC-31, AC-43). "Add to CI" opens the
   Export wizard; the "Fail CI on" selector persists via the existing
   `useUpdateAgent` (no new plumbing — `ci_fail_on` is already in
   `UpdateAgentInput`, AC-29). Each installation row owns its OWN "Update CI
   config" — there is deliberately no header-level bulk control (AC-31). */
"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, SelectInput, Skeleton } from "@devdigest/ui";
import type { Agent, CiFailOn } from "@devdigest/shared";
import { useUpdateAgent } from "@/lib/hooks/agents";
import { useCiInstallations, useUpdateCiConfig } from "@/lib/hooks/ci-export";
import { InstallationRow } from "./InstallationRow";
import { ExportWizard } from "./ExportWizard/ExportWizard";

const FAIL_ON_VALUES: readonly CiFailOn[] = ["never", "critical", "warning", "any"];

export function CiTab({ agent }: { agent: Agent }) {
  const t = useTranslations("ci");
  const [wizardOpen, setWizardOpen] = React.useState(false);
  const [updatingId, setUpdatingId] = React.useState<string | null>(null);

  const { data: installations, isLoading } = useCiInstallations(agent.id);
  const updateAgent = useUpdateAgent();
  const updateConfig = useUpdateCiConfig();

  const rows = installations ?? [];

  const handleUpdateConfig = (installationId: string) => {
    setUpdatingId(installationId);
    updateConfig.mutate({ installationId }, { onSettled: () => setUpdatingId(null) });
  };

  return (
    <div style={{ padding: "20px 24px 40px", maxWidth: 1040 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t("ciTab.heading")}</div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>{t("ciTab.subtitle")}</div>
        </div>
        <Button kind="primary" size="sm" icon="Plus" onClick={() => setWizardOpen(true)}>
          {t("ciTab.addToCi")}
        </Button>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
          {t("ciTab.failOnLabel")}
        </span>
        <div style={{ width: 220 }}>
          <SelectInput
            value={agent.ci_fail_on}
            onChange={(v) => updateAgent.mutate({ id: agent.id, patch: { ci_fail_on: v as CiFailOn } })}
            options={FAIL_ON_VALUES.map((v) => ({ value: v, label: t(`ciTab.failOn.${v}`) }))}
          />
        </div>
      </label>

      {rows.length > 0 && (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12 }}>
          {t("ciTab.activeInRepos", { count: rows.length })}
        </div>
      )}

      {isLoading ? (
        <Skeleton height={56} />
      ) : rows.length === 0 ? (
        <EmptyState icon="Workflow" title={t("ciTab.empty")} />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((row) => (
            <InstallationRow
              key={row.id}
              row={row}
              onUpdateConfig={() => handleUpdateConfig(row.id)}
              updating={updatingId === row.id && updateConfig.isPending}
            />
          ))}
        </div>
      )}

      {wizardOpen && <ExportWizard agent={agent} onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
