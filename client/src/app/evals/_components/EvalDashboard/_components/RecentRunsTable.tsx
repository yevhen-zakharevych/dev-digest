"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, Card, EmptyState } from "@devdigest/ui";
import type { EvalRunSummary } from "@devdigest/shared";
import { formatCost, formatDateTime, formatPercent } from "../../../_lib/format";
import { s } from "../styles";

const STATUS_COLOR: Record<EvalRunSummary["status"], string> = {
  running: "var(--accent)",
  done: "var(--ok)",
  failed: "var(--crit)",
  cancelled: "var(--text-muted)",
};

/** Recent eval runs spanning ALL agents (AC-29) — no `Table` primitive in this
 *  codebase; rows are composed with `Card` + CSS grid, as elsewhere. */
export function RecentRunsTable({
  runs,
  agentNames,
}: {
  runs: EvalRunSummary[];
  agentNames: Map<string, string>;
}) {
  const t = useTranslations("eval");

  if (runs.length === 0) {
    return <EmptyState icon="History" title={t("dashboard.noRuns")} />;
  }

  return (
    <Card pad={false}>
      <div style={s.tableWrap}>
        <div style={s.tableHeadRow}>
          <span>Agent</span>
          <span>Version</span>
          <span>Status</span>
          <span>Started</span>
          <span>Recall</span>
          <span>Precision</span>
          <span>Citation</span>
          <span>Passing</span>
          <span>Cost</span>
        </div>
        {runs.map((run) => (
          <div key={run.id} style={s.tableRow} data-testid={`recent-run-${run.id}`}>
            <span>
              <Link href={`/agents/${run.owner_id}?tab=evals`}>{agentNames.get(run.owner_id) ?? run.owner_id}</Link>
              {run.set_drifted && (
                <span style={{ marginLeft: 6 }}>
                  <Badge color="var(--warn, #b58900)" icon="AlertTriangle">
                    drifted
                  </Badge>
                </span>
              )}
            </span>
            <span className="tnum">{run.agent_version != null ? `v${run.agent_version}` : "—"}</span>
            <span>
              <Badge color={STATUS_COLOR[run.status]}>{run.status}</Badge>
            </span>
            <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{formatDateTime(run.started_at)}</span>
            <span className="tnum">{formatPercent(run.recall)}</span>
            <span className="tnum">{formatPercent(run.precision)}</span>
            <span className="tnum">{formatPercent(run.citation_accuracy)}</span>
            <span className="tnum">
              {run.traces_passed}/{run.traces_total}
            </span>
            <span className="tnum">{formatCost(run.cost_usd)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}
