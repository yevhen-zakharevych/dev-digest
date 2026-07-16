"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import { formatPercent } from "../../../../_lib/format";
import { s } from "../styles";

/**
 * One metric's before -> after, WITH direction (a11y: never colour alone —
 * an arrow AND a signed number, per this task's a11y rule).
 */
export function MetricDeltaRow({
  label,
  base,
  candidate,
  format = formatPercent,
}: {
  label: string;
  base: number | null;
  candidate: number | null;
  format?: (v: number | null) => string;
}) {
  const delta = base != null && candidate != null ? candidate - base : null;
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  const color = delta == null ? "var(--text-muted)" : up ? "var(--ok)" : down ? "var(--crit)" : "var(--text-muted)";
  const DeltaIcon = delta == null ? Icon.Slash : up ? Icon.ArrowUp : down ? Icon.ArrowDown : Icon.Slash;
  const sign = delta == null ? "" : delta > 0 ? "+" : delta < 0 ? "-" : "±";

  return (
    <div style={s.metricRow} data-testid={`delta-${label.toLowerCase()}`}>
      <span style={s.metricLabel}>{label}</span>
      <span className="tnum">{format(base)}</span>
      <span aria-hidden style={{ color: "var(--text-muted)" }}>
        →
      </span>
      <span className="tnum">{format(candidate)}</span>
      <span
        className="tnum"
        style={{ display: "inline-flex", alignItems: "center", gap: 4, color, fontWeight: 600 }}
      >
        <DeltaIcon size={12} />
        <span>{delta == null ? "—" : `${sign}${format(Math.abs(delta))}`}</span>
      </span>
    </div>
  );
}
