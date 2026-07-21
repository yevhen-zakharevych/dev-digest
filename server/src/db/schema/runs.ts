import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { agents } from './agents';
import { pullRequests } from './pulls';

// ============================================================ Observability

export const agentRuns = pgTable('agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId: uuid('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  prId: uuid('pr_id').references(() => pullRequests.id, { onDelete: 'set null' }),
  /** The multi-agent review this run was launched by, when any. NULL on every
   *  run created by the single-agent `POST /pulls/:id/review` path and on every
   *  row predating the column — those never appear on the Multi-Agent page.
   *  `set null` keeps the run (and its trace/cost history) if the grouping row
   *  is ever removed. */
  multiAgentRunId: uuid('multi_agent_run_id').references(() => multiAgentRuns.id, {
    onDelete: 'set null',
  }),
  /** PR head SHA at the moment this run was created — groups runs into "review
   *  cycles" (one cycle per pushed commit). Used to scope cost/findings sums on
   *  the PR list to the latest cycle. Null on legacy rows from before the
   *  column existed. */
  headSha: text('head_sha'),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
  provider: text('provider'),
  model: text('model'),
  durationMs: integer('duration_ms'),
  tokensIn: integer('tokens_in'),
  tokensOut: integer('tokens_out'),
  /** USD cost of the run; null when no usage was captured (e.g. provider 429 before token use). */
  costUsd: doublePrecision('cost_usd'),
  status: text('status'),
  /** Failure reason when status='failed' (LLM/API error, timeout, quota, …). */
  error: text('error'),
  source: text('source', { enum: ['local', 'ci'] }).notNull().default('local'),
  findingsCount: integer('findings_count'),
  grounding: text('grounding'),
  /** Review score (0-100) for this run; null on failed/cancelled runs. */
  score: integer('score'),
  /** Findings that tripped the agent's gate (severity ≥ ciFailOn). */
  blockers: integer('blockers'),
}, (t) => ({
  /** PLAIN (never partial) index — Postgres does not auto-index FK columns, and
   *  the multi-agent read model gathers a run set by this column on every poll.
   *  A partial `WHERE multi_agent_run_id IS NOT NULL` index would be tighter but
   *  drizzle-kit emits an unbound `$1` for predicate indexes (server/INSIGHTS.md:34). */
  multiRunIdx: index('agent_runs_multi_run_idx').on(t.multiAgentRunId),
}));

/** Whole trace of one run as a SINGLE jsonb document. */
export const runTraces = pgTable('run_traces', {
  runId: uuid('run_id')
    .primaryKey()
    .references(() => agentRuns.id, { onDelete: 'cascade' }),
  trace: jsonb('trace').notNull(),
});

export const multiAgentRuns = pgTable('multi_agent_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
});
