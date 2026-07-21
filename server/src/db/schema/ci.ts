import { pgTable, uuid, text, integer, timestamp, doublePrecision } from 'drizzle-orm/pg-core';
import { agents } from './agents';

export const ciInstallations = pgTable('ci_installations', {
  id: uuid('id').primaryKey().defaultRandom(),
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  targetType: text('target_type', { enum: ['gha', 'circle', 'jenkins', 'cli'] }).notNull(),
  installedAt: timestamp('installed_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ciRuns = pgTable('ci_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  ciInstallationId: uuid('ci_installation_id').references(() => ciInstallations.id, {
    onDelete: 'set null',
  }),
  prNumber: integer('pr_number'),
  ranAt: timestamp('ran_at', { withTimezone: true }),
  status: text('status'),
  findingsCount: integer('findings_count'),
  costUsd: doublePrecision('cost_usd'),
  githubUrl: text('github_url'),
  source: text('source'),
  // `agent` and `duration_s` close a pre-existing gap: the `CiRun` contract already
  // declared both (`contracts/eval-ci.ts`) while this table carried neither, so the API
  // could not serve what the CI Runs row displays. Additive and nullable — a run whose
  // result artifact was missing or invalid persists NO field from it, including these.
  agent: text('agent'),
  durationS: doublePrecision('duration_s'),
});
