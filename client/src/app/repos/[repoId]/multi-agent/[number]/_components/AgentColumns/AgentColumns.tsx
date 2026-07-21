/* AgentColumns — the Columns mode of the Multi-Agent Review results page.

   v1 has ONE display mode (spec Revision log, 2026-07-21 v1 simplification):
   there is deliberately no Columns↔Tabs toggle here, and the unused
   `runs.page.view.*` keys stay in place untouched. */
"use client";

import React from "react";
import type { AgentColumn } from "@devdigest/shared";
import { AgentColumnCard } from "../AgentColumnCard/AgentColumnCard";
import { s } from "./styles";

export function AgentColumns({
  columns,
  repoId,
  prNumber,
  selectedFindingId,
  onSelectFinding,
}: {
  columns: AgentColumn[];
  repoId: string;
  prNumber: string;
  selectedFindingId: string | null;
  onSelectFinding: (findingId: string) => void;
}) {
  return (
    <div style={s.grid} data-testid="agent-columns">
      {columns.map((column) => (
        <AgentColumnCard
          key={column.run_id}
          column={column}
          traceHref={`/repos/${repoId}/pulls/${prNumber}?trace=${encodeURIComponent(column.run_id)}`}
          selectedFindingId={selectedFindingId}
          onSelectFinding={onSelectFinding}
        />
      ))}
    </div>
  );
}
