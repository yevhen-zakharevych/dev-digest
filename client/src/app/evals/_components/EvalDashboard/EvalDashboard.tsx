"use client";

import React from "react";
import { useTranslations } from "next-intl";
import { Button, EmptyState, ErrorState, Icon, Skeleton } from "@devdigest/ui";
import { useEvalRunAllPreview, useEvalWorkspaceDashboard, useRunAllEvals } from "../../../../lib/hooks/evals";
import { ApiError } from "../../../../lib/api";
import { AgentEvalCard } from "./_components/AgentEvalCard";
import { RecentRunsTable } from "./_components/RecentRunsTable";
import { RunAllModal } from "./_components/RunAllModal";
import { s } from "./styles";

/**
 * Workspace-wide Eval Dashboard (AC-29) — the sidebar's already-live "Eval
 * Dashboard" entry (`vendor/ui/nav.ts:36`) resolves here instead of a dead
 * link. Every agent's latest metrics + a cross-agent recent-runs table.
 */
export function EvalDashboard() {
  const t = useTranslations("eval");
  const { data, isLoading, isError, error, refetch } = useEvalWorkspaceDashboard();
  const { data: preview } = useEvalRunAllPreview();
  const runAll = useRunAllEvals();
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const agentNames = React.useMemo(() => {
    const m = new Map<string, string>();
    (data?.agents ?? []).forEach((a) => m.set(a.agent_id, a.agent_name));
    return m;
  }, [data?.agents]);

  if (isLoading) {
    return (
      <div style={s.wrap}>
        <Skeleton height={28} width={220} />
        <div style={{ height: 16 }} />
        <Skeleton height={140} />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        fullScreen
        title="Couldn't load the Eval Dashboard"
        body={error instanceof ApiError ? error.message : undefined}
        onRetry={() => refetch()}
      />
    );
  }

  const handleConfirmRunAll = () => {
    runAll.mutate(undefined, { onSuccess: () => setConfirmOpen(false) });
  };

  return (
    <div style={s.wrap}>
      <div style={s.head}>
        <div style={s.flexGrow}>
          <div style={s.title}>{t("dashboard.defaultTitle")}</div>
          <div style={s.subtitle}>{t("dashboard.subtitle")}</div>
        </div>
        <Button kind="primary" icon="Play" onClick={() => setConfirmOpen(true)} disabled={data.agents.length === 0}>
          {t("dashboard.runAllAgents")}
        </Button>
      </div>

      {data.alert && (
        <div role="status" style={s.alert}>
          <Icon.AlertTriangle size={16} />
          <span>{data.alert}</span>
        </div>
      )}

      <div style={s.sectionHeading}>{t("dashboard.agentsHeading")}</div>
      {data.agents.length === 0 ? (
        <EmptyState icon="FlaskConical" title={t("states.noCases")} body={t("states.noCasesHint")} />
      ) : (
        <div style={s.agentsGrid}>
          {data.agents.map((agent) => (
            <AgentEvalCard key={agent.agent_id} agent={agent} />
          ))}
        </div>
      )}

      <div style={s.sectionHeading}>{t("dashboard.recentRunsAllAgents")}</div>
      <RecentRunsTable runs={data.recent_runs} agentNames={agentNames} />

      {confirmOpen && (
        <RunAllModal
          preview={preview}
          totalAgentsOnDashboard={data.agents.length}
          isPending={runAll.isPending}
          onConfirm={handleConfirmRunAll}
          onClose={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}
