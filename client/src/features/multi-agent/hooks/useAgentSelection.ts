/* features/multi-agent/hooks/useAgentSelection.ts — the stateful half of the
   agent picker, shared by both entry points (the PR-page `MultiAgentPicker` and
   the Configure-run page's `AgentSelection`).

   `AgentPickList` already lifted the presentational half here; this hook is the
   other half, which was originally duplicated verbatim in both call sites —
   the same three queries, the same `ReadonlySet` selection, the same 7-line
   `toggle`, and the same `mutateAsync` → navigate handler. Two route-local
   copies meant a change to the run contract had to be made twice, by whoever
   happened to own each route. */
"use client";

import React from "react";
import { useAgents } from "@/lib/hooks/agents";
import { useAgentEstimates, useCreateMultiRun } from "@/lib/hooks/multi-agent";
import type { Agent, AgentEstimate } from "@devdigest/shared";

export interface UseAgentSelectionResult {
  /** Every agent in the workspace; `[]` while loading. */
  agents: Agent[];
  /** Per-agent estimates, or `undefined` when the source failed (AC-10 — the
   *  caller must stay usable and render "—" hints rather than block). */
  estimates: AgentEstimate[] | undefined;
  selected: ReadonlySet<string>;
  count: number;
  toggle: (agentId: string) => void;
  clear: () => void;
  selectAll: () => void;
  /** Creates the multi-run, then invokes `onRan`. No-ops at zero selected. */
  run: () => Promise<void>;
  isPending: boolean;
}

export function useAgentSelection({
  repoId,
  prId,
  onRan,
}: {
  repoId: string;
  prId: string;
  /** Called only after the create succeeds — each entry point navigates its own way. */
  onRan: () => void;
}): UseAgentSelectionResult {
  const { data: agentsData } = useAgents();
  const { data: estimates } = useAgentEstimates(repoId);
  const createMultiRun = useCreateMultiRun();
  const [selected, setSelected] = React.useState<ReadonlySet<string>>(new Set());

  const agents = agentsData ?? [];
  const count = selected.size;

  const toggle = React.useCallback((agentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const clear = React.useCallback(() => setSelected(new Set()), []);

  const selectAll = React.useCallback(
    () => setSelected(new Set(agents.map((a) => a.id))),
    [agents],
  );

  const run = React.useCallback(async () => {
    if (selected.size === 0) return;
    await createMultiRun.mutateAsync({ prId, agentIds: Array.from(selected) });
    onRan();
  }, [createMultiRun, onRan, prId, selected]);

  return {
    agents,
    estimates,
    selected,
    count,
    toggle,
    clear,
    selectAll,
    run,
    isPending: createMultiRun.isPending,
  };
}
