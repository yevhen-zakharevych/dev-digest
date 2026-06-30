import { pgTable, uuid, text, jsonb, timestamp, doublePrecision, boolean, vector, index } from 'drizzle-orm/pg-core';
import { now } from './_shared';
import { workspaces } from './core';
import { repos } from './repos';

// ============================================================ Knowledge / RAG

export const memory = pgTable(
  'memory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scope: text('scope', { enum: ['repo', 'global', 'team'] }).notNull(),
    kind: text('kind', {
      enum: ['decision', 'convention', 'preference', 'fact', 'learning'],
    }).notNull(),
    content: text('content').notNull(),
    embedding: vector('embedding', { dimensions: 1536 }),
    confidence: doublePrecision('confidence'),
    sources: jsonb('sources'),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  },
  (t) => ({ wsIdx: index('memory_ws_idx').on(t.workspaceId) }),
);

/**
 * Convention candidates extracted from a repository (L0X — Conventions Extractor).
 *
 * One row per LLM-proposed rule. Verified against the on-disk clone before
 * insert: `evidence_path` always points at a real file inside the repo's
 * clone and `evidence_snippet` is the literal slice taken from that file
 * (LLM-supplied text is never persisted unverified).
 *
 * Lifecycle: status starts `pending`, the user flips to `accepted` or
 * `rejected` from the UI, accepted rows are merged into one Skill via
 * `POST /repos/:id/conventions/create-skill`. The legacy `accepted` boolean
 * is kept in lockstep with `status` for backward compatibility.
 *
 * `scan_id` links back to the `jobs` row that produced the candidate (the
 * SSE bus uses this same id, so progress events stream over `/runs/:id/events`).
 */
export const conventions = pgTable(
  'conventions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    repoId: uuid('repo_id').references(() => repos.id, { onDelete: 'cascade' }),
    scanId: uuid('scan_id'),
    rule: text('rule').notNull(),
    evidencePath: text('evidence_path'),
    evidenceSnippet: text('evidence_snippet'),
    confidence: doublePrecision('confidence'),
    status: text('status', { enum: ['pending', 'accepted', 'rejected'] })
      .notNull()
      .default('pending'),
    accepted: boolean('accepted').notNull().default(false),
    createdAt: now(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    repoStatusIdx: index('conventions_repo_status_idx').on(t.repoId, t.status),
  }),
);
