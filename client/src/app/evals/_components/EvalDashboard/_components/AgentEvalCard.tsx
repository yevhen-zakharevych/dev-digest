"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Badge, Card } from "@devdigest/ui";
import type { EvalAgentEvalSummary } from "@devdigest/shared";
import { formatPercent } from "@/features/evals/format";
import { agentEvalState } from "../helpers";
import { s } from "../styles";

/**
 * A compact metric for the dashboard TILE — deliberately NOT the shared
 * `MetricCard` primitive. That one is page-scale (18px padding, 32px numerals)
 * and, being a flex child with the default `min-width: auto`, refuses to shrink
 * below its content — so three of them overflow a 280px grid column. This is the
 * three-up tile variant; the full-size cards still live on the agent's Evals tab.
 */
function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.miniMetric}>
      <div style={s.miniMetricLabel}>{label}</div>
      <div className="tnum" style={s.miniMetricValue}>
        {value}
      </div>
    </div>
  );
}

/** One agent's tile on the workspace Eval Dashboard (AC-29). */
export function AgentEvalCard({ agent }: { agent: EvalAgentEvalSummary }) {
  const t = useTranslations("eval");
  const router = useRouter();
  const state = agentEvalState(agent);

  return (
    <Card hover onClick={() => router.push(`/agents/${agent.agent_id}?tab=evals`)} style={s.agentCard}>
      <div style={s.agentCardHead}>
        <span style={s.agentName}>{agent.agent_name}</span>
        <Badge mono color="var(--text-secondary)">
          v{agent.agent_version}
        </Badge>
      </div>

      {state === "no-cases" && (
        <div data-testid={`agent-state-${agent.agent_id}`} data-state="no-cases">
          <div style={s.emptyHint}>{t("states.noCases")}</div>
          <div style={{ ...s.emptyHint, marginTop: 4 }}>{t("states.noCasesHint")}</div>
          <div style={{ ...s.emptyHint, marginTop: 8 }}>{t("dashboard.configure")}</div>
        </div>
      )}

      {state === "never-run" && (
        <div data-testid={`agent-state-${agent.agent_id}`} data-state="never-run">
          <Badge color="var(--text-muted)">{t("states.neverRun")}</Badge>
          <div style={{ ...s.emptyHint, marginTop: 8 }}>{t("states.neverRunHint")}</div>
        </div>
      )}

      {state === "measured" && (
        <div data-testid={`agent-state-${agent.agent_id}`} data-state="measured">
          <div style={s.metricsRow}>
            <MiniMetric label={t("metrics.recall")} value={formatPercent(agent.recall)} />
            <MiniMetric label={t("metrics.precision")} value={formatPercent(agent.precision)} />
            <MiniMetric label={t("metrics.citation")} value={formatPercent(agent.citation_accuracy)} />
          </div>
          <div style={s.passingLine}>
            {t("evalsTab.passingSummary", { passed: agent.traces_passed, total: agent.traces_total })}
          </div>
        </div>
      )}
    </Card>
  );
}
