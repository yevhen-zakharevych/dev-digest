/* AgentColumnCard — one agent's column in the Multi-Agent Review (AC-15).

   Header: live status, score (blank when null — never `0`), duration, cost,
   findings count and a View-trace link back to the PR page's existing
   RunTraceDrawer (`?trace=<run_id>`). Body: the agent's own findings, each a
   button that opens the shared FindingCard detail (AC-17) one level up.

   The status shown here is whatever the latest read returned; the transition to
   a terminal value is driven by `useLatestMultiRun`'s self-clearing poll, not
   by this component (AC-16). */
"use client";

import React from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Badge, SeverityBadge, formatCost, type UISeverity } from "@devdigest/ui";
import type { AgentColumn, AgentColumnFinding } from "@devdigest/shared";
import { formatDurationMs } from "../../_lib/format";
import { STATUS_COLOR } from "./constants";
import { s } from "./styles";

export function AgentColumnCard({
  column,
  traceHref,
  selectedFindingId,
  onSelectFinding,
}: {
  column: AgentColumn;
  /** `/repos/{repoId}/pulls/{number}?trace={run_id}` — the PR page already
   *  reads `?trace=` and opens RunTraceDrawer, so the drawer is NOT imported
   *  across route folders. */
  traceHref: string;
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
}) {
  const t = useTranslations("runs");
  const statusColor = STATUS_COLOR[column.status];

  return (
    <section style={s.card} data-testid="agent-column" data-agent-id={column.agent_id}>
      <header style={s.header}>
        <div style={s.titleRow}>
          <span style={s.agentName}>{column.agent_name}</span>
          <Badge color={statusColor} bg="transparent" dot>
            <span data-testid="agent-status">{t(`column.status.${column.status}`)}</span>
          </Badge>
        </div>

        <div style={s.metaRow}>
          {/* AC-15: a null score (a run that never produced one) renders BLANK,
              never `0` — so the element itself is absent, not zero-valued. */}
          {column.score != null && (
            <span style={s.meta} data-testid="agent-score">{`${t("column.score")} ${column.score}`}</span>
          )}
          <span style={s.meta} data-testid="agent-duration">
            {`${t("column.duration")} ${formatDurationMs(column.duration_ms)}`}
          </span>
          <span style={s.meta} data-testid="agent-cost">
            {`${t("column.cost")} ${formatCost(column.cost_usd)}`}
          </span>
          <span style={s.meta} data-testid="agent-findings-count">
            {t("column.findingsCount", { count: column.findings.length })}
          </span>
        </div>

        <Link href={traceHref} style={s.traceLink} data-testid="agent-trace-link">
          {t("viewTrace")}
        </Link>
      </header>

      <ul style={s.list}>
        {column.findings.length === 0 ? (
          <li style={s.empty}>{t("column.noFindings")}</li>
        ) : (
          column.findings.map((f) => (
            <li key={f.id}>
              <FindingRow
                finding={f}
                selected={f.id === selectedFindingId}
                label={t("column.openFinding", { title: f.title })}
                onSelect={() => onSelectFinding(f.id)}
              />
            </li>
          ))
        )}
      </ul>
    </section>
  );
}

function FindingRow({
  finding,
  selected,
  label,
  onSelect,
}: {
  finding: AgentColumnFinding;
  selected: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={selected}
      style={s.findingRow(selected)}
      data-testid="column-finding"
      data-finding-id={finding.id}
    >
      <SeverityBadge severity={finding.severity as UISeverity} compact />
      <span style={s.findingBody}>
        <span style={s.findingTitle}>{finding.title}</span>
        {/* Model-authored path rendered as escaped text, never as a raw href. */}
        <span className="mono" style={s.findingLoc}>{`${finding.file}:${finding.start_line}`}</span>
      </span>
    </button>
  );
}
