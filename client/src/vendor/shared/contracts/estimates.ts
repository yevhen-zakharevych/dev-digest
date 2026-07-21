import { z } from 'zod';

/**
 * T2 — Pre-run estimates read model (GET /agents/estimates?repoId=).
 *
 * One entry per agent that has at least one `done` run in the given repo.
 * `avg_duration_ms`/`avg_cost_usd` are `null` — never a fabricated `0` — when
 * the relevant sample is empty (AC-9). `sample_size` is the count of `done`
 * runs behind the duration mean (§4 Q9 of the multi-agent-review plan).
 */
export const AgentEstimate = z.object({
  agent_id: z.string(),
  avg_duration_ms: z.number().nullable(),
  avg_cost_usd: z.number().nullable(),
  sample_size: z.number().int(),
});
export type AgentEstimate = z.infer<typeof AgentEstimate>;
