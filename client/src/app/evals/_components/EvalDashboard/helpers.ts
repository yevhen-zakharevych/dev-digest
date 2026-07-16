import type { EvalAgentEvalSummary } from "@devdigest/shared";

export type AgentEvalState = "no-cases" | "never-run" | "measured";

/**
 * Rule 1 of the feature (see task card): an absent measurement and a
 * measured zero must never look the same.
 * - zero cases  -> "no-cases" (AC-31): never render any metric as 0%.
 * - cases, never run -> "never-run" (AC-32): metrics "-", no trend point.
 * - otherwise -> "measured": render the agent's real (possibly null-for-one
 *   metric, e.g. an all-negative set has no recall) numbers.
 */
export function agentEvalState(a: Pick<EvalAgentEvalSummary, "cases_total" | "traces_total">): AgentEvalState {
  if (a.cases_total === 0) return "no-cases";
  if (a.traces_total === 0) return "never-run";
  return "measured";
}
