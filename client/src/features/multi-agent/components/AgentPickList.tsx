/* features/multi-agent/components/AgentPickList.tsx — the checkbox list
   shared by both agent-picker entry points: the compact PR-page picker
   (MultiAgentPicker) and the Configure-run page. Each row shows the agent's
   name, an optional one-line description, and its per-agent time+cost hint
   (AC-1, AC-5, AC-7). */
"use client";

import React from "react";
import { Checkbox } from "@devdigest/ui";
import type { Agent, AgentEstimate } from "@devdigest/shared";
import { formatAgentDuration, formatAgentHint, indexEstimates } from "../helpers";

export interface AgentPickListProps {
  agents: Agent[];
  estimates: AgentEstimate[] | undefined;
  selectedIds: ReadonlySet<string>;
  onToggle: (agentId: string) => void;
  /** Configure-run page shows a one-line description per agent (AC-5); the
   *  compact PR-page picker omits it (AC-1). */
  showDescription?: boolean;
  /** `"time"` — duration only, for the compact PR-page picker, which folds cost
   *  into its summary line. `"timeAndCost"` (default) — the Configure page's
   *  full "8.2s · $0.060" hint (AC-5). */
  hintMode?: "time" | "timeAndCost";
  /** Localized label for an agent with no run history. Rendered in place of a
   *  number so no fabricated `0s`/`$0` ever appears (AC-7). */
  noHistoryLabel?: string;
}

export function AgentPickList({
  agents,
  estimates,
  selectedIds,
  onToggle,
  showDescription = false,
  hintMode = "timeAndCost",
  noHistoryLabel = "—",
}: AgentPickListProps) {
  const byId = indexEstimates(estimates);
  const hintFor = hintMode === "time" ? formatAgentDuration : formatAgentHint;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%" }}>
      {agents.map((agent) => (
        <div key={agent.id} style={{ width: "100%" }}>
          <Checkbox
            checked={selectedIds.has(agent.id)}
            onChange={() => onToggle(agent.id)}
            label={
              <span
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  width: "100%",
                  gap: 12,
                }}
              >
                <span style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{agent.name}</span>
                  {showDescription && agent.description ? (
                    <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{agent.description}</span>
                  ) : null}
                </span>
                <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)", flexShrink: 0 }}>
                  {hintFor(byId.get(agent.id)) ?? noHistoryLabel}
                </span>
              </span>
            }
          />
        </div>
      ))}
    </div>
  );
}
