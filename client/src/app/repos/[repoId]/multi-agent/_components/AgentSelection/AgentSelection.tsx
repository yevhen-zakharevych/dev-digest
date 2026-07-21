/* AgentSelection — step 2 of the Configure-run page: pick agents (each with a
   description + time/cost hint), Select-all, and Run with an adjacent
   summary estimate (AC-5, AC-6, AC-8, AC-9, AC-10). Route-local. */
"use client";

import { useTranslations } from "next-intl";
import { Button, EmptyState, formatCost } from "@devdigest/ui";
import { AgentPickList } from "@/features/multi-agent/components/AgentPickList";
import { useAgentSelection } from "@/features/multi-agent/hooks/useAgentSelection";
import { computeEstimateSummary, formatSeconds } from "@/features/multi-agent/helpers";

export function AgentSelection({
  repoId,
  prId,
  prNumber,
  onRan,
}: {
  repoId: string;
  prId: string;
  prNumber: number;
  onRan: (prNumber: number) => void;
}) {
  const t = useTranslations("multiAgent");
  const { agents, estimates, selected, count, toggle, clear, selectAll, run, isPending } =
    useAgentSelection({ repoId, prId, onRan: () => onRan(prNumber) });

  const summary = computeEstimateSummary(selected, estimates);

  if (agents.length === 0) {
    return (
      <EmptyState icon="Cpu" title={t("configure.noAgentsTitle")} body={t("configure.noAgentsBody")} />
    );
  }

  const summaryText =
    summary.timeMs == null && summary.costUsd == null
      ? t("configure.summary.noHistory")
      : t("configure.summary.line", {
          time: summary.timeMs != null ? formatSeconds(summary.timeMs) : "—",
          cost: formatCost(summary.costUsd),
        }) + (summary.approximate ? ` · ${t("configure.summary.approximate")}` : "");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-secondary)" }}>
          {t("configure.agentsHeading")}
        </span>
        <Button kind="ghost" size="sm" onClick={selectAll}>
          {t("configure.selectAll")}
        </Button>
      </div>

      <AgentPickList agents={agents} estimates={estimates} selectedIds={selected} onToggle={toggle} showDescription />

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <Button
          kind="primary"
          disabled={count === 0}
          aria-disabled={count === 0}
          loading={isPending}
          onClick={run}
        >
          {t("configure.runButton", { count })}
        </Button>
        <span data-testid="estimate-summary" style={{ fontSize: 13, color: "var(--text-secondary)" }}>
          {summaryText}
        </span>
      </div>
      <Button kind="ghost" size="sm" onClick={clear} disabled={count === 0} style={{ alignSelf: "flex-start" }}>
        {t("configure.clearAll")}
      </Button>
    </div>
  );
}
