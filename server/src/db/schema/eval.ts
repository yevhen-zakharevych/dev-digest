import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  doublePrecision,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { workspaces } from './core';
import { pullRequests } from './pulls';
import { findings } from './reviews';
import { agents } from './agents';

// ============================================================ Eval / Conformance / Compose
//
// A case freezes the two model-reaching inputs (diff + PR meta) and an
// expectation. A run is the batch entity: one execution over the whole case
// set, owning aggregate metrics + a value-pinned effective config (never a
// version pointer — see `agent_versions` in server/INSIGHTS.md). A draft is
// a single-case, ad-hoc scratch execution — NOT a run: never in run history,
// never on the trend, never comparable (AC-47).

export const evalCases = pgTable(
  'eval_cases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    ownerKind: text('owner_kind', { enum: ['skill', 'agent'] }).notNull(),
    ownerId: uuid('owner_id').notNull(),
    name: text('name').notNull(),
    // Frozen diff — the case is unusable without it, hence notNull (was nullable).
    inputDiff: text('input_diff').notNull(),
    inputFiles: jsonb('input_files'),
    inputMeta: jsonb('input_meta'),
    expectedOutput: jsonb('expected_output'),
    // The user's OWN recorded reason for the case (required to save a
    // must_not_flag case). Distinct from `sourceFinding.rationale` below —
    // never conflate the two.
    notes: text('notes'),
    expectation: text('expectation', { enum: ['must_find', 'must_not_flag'] }).notNull(),
    // One case per source finding (AC-8) — enforced here, not by a
    // race-prone read-then-write in the service layer.
    sourceFindingId: uuid('source_finding_id')
      .unique()
      .references(() => findings.id, { onDelete: 'set null' }),
    // Frozen snapshot of the seeding finding (title, rationale, severity,
    // category, kind, file, lines) — survives the finding being edited or
    // deleted. Data path for AC-4's "original rationale" and AC-17's
    // display-only provenance chip.
    sourceFinding: jsonb('source_finding'),
    // Only populated when expectation = 'must_not_flag'.
    forbiddenRegion: jsonb('forbidden_region'),
    // Content hash over frozen inputs + expectation (AC-14/AC-26 comparability).
    inputFingerprint: text('input_fingerprint').notNull(),
  },
  (t) => ({
    ownerIdx: index('eval_cases_owner_idx').on(t.ownerKind, t.ownerId),
  }),
);

export const evalRuns = pgTable('eval_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  // Cascade: deleting an agent cascade-deletes its runs for free (AC-53).
  agentId: uuid('agent_id')
    .notNull()
    .references(() => agents.id, { onDelete: 'cascade' }),
  // Display label only — NEVER a comparability key. Comparability is
  // decided on `effectiveConfig` (AC-51).
  agentVersion: integer('agent_version'),
  // The effective config pinned BY VALUE at run start: prompt, provider,
  // model, strategy, repo_intel, resolved skills with versions (AC-10).
  effectiveConfig: jsonb('effective_config').notNull(),
  status: text('status', { enum: ['running', 'done', 'failed', 'cancelled'] }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  casesTotal: integer('cases_total').notNull(),
  // Persisted (not just in-memory) so "k of N" progress survives a page
  // reload (AC-11/AC-12).
  casesDone: integer('cases_done').notNull().default(0),
  // Model failures on individual cases are contained here and excluded
  // from every denominator (AC-36).
  erroredCount: integer('errored_count').notNull().default(0),
  tracesPassed: integer('traces_passed'),
  tracesTotal: integer('traces_total'),
  // All three metrics are nullable: an all-errored run reports NULL, never
  // zeros (AC-37).
  recall: doublePrecision('recall'),
  precision: doublePrecision('precision'),
  citationAccuracy: doublePrecision('citation_accuracy'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
  error: text('error'),
});

export const evalCaseResults = pgTable('eval_case_results', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id')
    .notNull()
    .references(() => evalRuns.id, { onDelete: 'cascade' }),
  // ON DELETE SET NULL + a name snapshot: a run outlives its cases.
  caseId: uuid('case_id').references(() => evalCases.id, { onDelete: 'set null' }),
  caseName: text('case_name').notNull(),
  inputFingerprint: text('input_fingerprint').notNull(),
  // `errored` distinct from `failed` is the entire point of AC-36.
  outcome: text('outcome', { enum: ['passed', 'failed', 'errored'] }).notNull(),
  error: text('error'),
  expectedCount: integer('expected_count'),
  matchedCount: integer('matched_count'),
  emittedCount: integer('emitted_count'),
  keptCount: integer('kept_count'),
  findings: jsonb('findings'),
  unmatchedFindings: jsonb('unmatched_findings'),
  durationMs: integer('duration_ms'),
  costUsd: doublePrecision('cost_usd'),
});

export const evalDrafts = pgTable(
  'eval_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    agentId: uuid('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    caseId: uuid('case_id')
      .notNull()
      .references(() => evalCases.id, { onDelete: 'cascade' }),
    ranAt: timestamp('ran_at', { withTimezone: true }).defaultNow().notNull(),
    status: text('status', { enum: ['running', 'done', 'failed', 'cancelled'] }).notNull(),
    // Config snapshot at draft time — a since-changed live config marks the
    // draft stale (AC-48).
    effectiveConfig: jsonb('effective_config'),
    inputFingerprint: text('input_fingerprint'),
    outcome: text('outcome', { enum: ['passed', 'failed', 'errored'] }),
    error: text('error'),
    expectedCount: integer('expected_count'),
    matchedCount: integer('matched_count'),
    emittedCount: integer('emitted_count'),
    keptCount: integer('kept_count'),
    findings: jsonb('findings'),
    durationMs: integer('duration_ms'),
    costUsd: doublePrecision('cost_usd'),
  },
  (t) => ({
    // One row PER draft (not one slot per case) so draft spend is
    // SUM(cost_usd) — AC-49. This partial unique index is the DB-enforced
    // ≤1-in-flight-draft-per-case guard (AC-13).
    oneRunningDraftPerCase: uniqueIndex('eval_drafts_case_running_uq')
      .on(t.caseId)
      .where(sql`${t.status} = 'running'`),
  }),
);

export const conformanceChecks = pgTable('conformance_checks', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  specId: text('spec_id').notNull(),
  completenessPct: doublePrecision('completeness_pct'),
  items: jsonb('items'),
});

export const composedReviews = pgTable('composed_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  prId: uuid('pr_id')
    .notNull()
    .references(() => pullRequests.id, { onDelete: 'cascade' }),
  body: text('body').notNull(),
  verdict: text('verdict'),
  postedAt: timestamp('posted_at', { withTimezone: true }),
  githubReviewId: text('github_review_id'),
});
