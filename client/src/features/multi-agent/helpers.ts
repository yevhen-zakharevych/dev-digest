/* features/multi-agent/helpers.ts — pure helpers shared by both agent-picker
   entry points (PR-page picker + Configure-run page): the per-agent hint
   string and the AC-8/AC-9 summary estimate. No I/O, no framework import —
   safe to unit test on fixed inputs. */
import { formatCost } from "@devdigest/ui";
import type { AgentEstimate } from "@devdigest/shared";

/** Render an elapsed-ms duration as a compact "8.2s" / "12s" string. */
export function formatSeconds(ms: number): string {
  const s = ms / 1000;
  return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
}

/**
 * An agent's own time+cost hint, e.g. "8.2s · $0.060". Both "no row at all"
 * for that agent and a row with a `null` `avg_duration_ms` mean "no history"
 * and render identically as "—" (AC-7) — never a fabricated `0s`/`$0`.
 */
export function formatAgentHint(estimate: AgentEstimate | undefined): string | null {
  if (!estimate || estimate.avg_duration_ms == null) return null;
  return `${formatSeconds(estimate.avg_duration_ms)} · ${formatCost(estimate.avg_cost_usd)}`;
}

/**
 * The duration-only variant of {@link formatAgentHint}, e.g. "8.2s". The
 * compact PR-page picker shows time per agent and folds cost into its summary
 * line (AC-1 asks only for a time hint there; AC-5's time+cost hint is the
 * Configure page). `null` means "no history" — the caller renders its own
 * localized label, never a fabricated `0s` (AC-7).
 */
export function formatAgentDuration(estimate: AgentEstimate | undefined): string | null {
  if (!estimate || estimate.avg_duration_ms == null) return null;
  return formatSeconds(estimate.avg_duration_ms);
}

/** Index estimates by agent id once, for O(1) per-row lookups. */
export function indexEstimates(estimates: AgentEstimate[] | undefined): Map<string, AgentEstimate> {
  return new Map((estimates ?? []).map((e) => [e.agent_id, e]));
}

export interface EstimateSummary {
  /** SUM of the selected agents' time hints (the fan-out is sequential); null
   *  when none of the selected agents has duration history. */
  timeMs: number | null;
  /** SUM of the selected agents' cost hints; null when none has a recorded
   *  cost. History-less agents contribute nothing to the sum. */
  costUsd: number | null;
  /** True when at least one selected agent has no duration history — the
   *  summary is then only approximate (AC-8). */
  approximate: boolean;
}

/**
 * Summary pre-run estimate for a set of selected agent ids (AC-8, AC-9).
 * - time = SUM of the selected agents' `avg_duration_ms`. The server runs the
 *   agents SEQUENTIALLY (`modules/reviews/run-executor.ts:129` awaits each in a
 *   plain `for` loop), so elapsed time adds up. Switch this back to MAX only
 *   when that loop actually runs jobs concurrently.
 * - cost = SUM of the selected agents' `avg_cost_usd` (history-less agents
 *   excluded from the sum).
 * - approximate = true when at least one selected agent lacks duration
 *   history (present in `estimates` with a null duration, or absent
 *   entirely — both mean "no history", AC-7).
 * When EVERY selected agent lacks history both `timeMs` and `costUsd` are
 * null — never a fabricated or zero estimate (AC-9). Order-independent by
 * construction (a plain fold over the selection).
 */
export function computeEstimateSummary(
  selectedIds: Iterable<string>,
  estimates: AgentEstimate[] | undefined,
): EstimateSummary {
  const byId = indexEstimates(estimates);
  let timeMs: number | null = null;
  let costUsd: number | null = null;
  let approximate = false;

  for (const id of selectedIds) {
    const est = byId.get(id);
    const duration = est?.avg_duration_ms ?? null;
    const cost = est?.avg_cost_usd ?? null;

    if (duration == null) {
      approximate = true;
    } else {
      timeMs = (timeMs ?? 0) + duration;
    }
    if (cost != null) {
      costUsd = (costUsd ?? 0) + cost;
    }
  }

  return { timeMs, costUsd, approximate };
}
