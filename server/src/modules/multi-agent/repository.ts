import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { AgentColumn, AgentColumnFinding, Severity } from '@devdigest/shared';

/**
 * Multi-Agent Review data-access. Owns the `multi_agent_runs` write path and the
 * read-model gather (linked `agent_runs` → their `reviews` → those reviews'
 * `findings`). Every query is scoped by `workspaceId` (AC-25).
 *
 * The gather is a READ overlay: it performs no write, merges no findings and
 * drops none — per-agent finding counts are identical before and after (AC-12).
 */

export interface MultiRunRow {
  id: string;
  prId: string;
  ranAt: Date;
}

/** `agent_runs.status` is free-form `text()` (db/schema/runs.ts) while
 *  `AgentColumn.status` is a 4-literal enum. An unmapped value does NOT surface
 *  as a UI glitch — `fastify-type-provider-zod` fails RESPONSE serialization and
 *  the whole page 500s. Everything outside this set (including null) is mapped
 *  to `running` (§4 Q8). */
const COLUMN_STATUSES = new Set<AgentColumn['status']>([
  'done',
  'failed',
  'running',
  'cancelled',
]);

/** Same trap one level down: `findings.severity` is `text().notNull()` with no
 *  DB-level enum, but `AgentColumnFinding.severity` is the 3-literal `Severity`.
 *  Rows are written from a Zod-validated `Finding` so this should be
 *  unreachable — degrade one finding's label rather than 500 the whole read. */
const SEVERITIES = new Set<Severity>(['CRITICAL', 'WARNING', 'SUGGESTION']);
const SEVERITY_FALLBACK: Severity = 'WARNING';

function toColumnStatus(raw: string | null): AgentColumn['status'] {
  return raw !== null && COLUMN_STATUSES.has(raw as AgentColumn['status'])
    ? (raw as AgentColumn['status'])
    : 'running';
}

function toSeverity(raw: string): Severity {
  return SEVERITIES.has(raw as Severity) ? (raw as Severity) : SEVERITY_FALLBACK;
}

export class MultiAgentRepository {
  constructor(private db: Db) {}

  /** Persist the grouping row. The launched `agent_runs` link back to it at
   *  their own insert time, so this row is never left holding a dangling set. */
  async createMultiRun(workspaceId: string, prId: string): Promise<MultiRunRow> {
    const [row] = await this.db
      .insert(t.multiAgentRuns)
      .values({ workspaceId, prId })
      .returning({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        ranAt: t.multiAgentRuns.ranAt,
      });
    return row!;
  }

  /**
   * The multi-run the results page shows for a PR: the most recent by `ranAt`
   * (AC-13). A newer multi-run supersedes the previous one purely by being newer
   * — nothing is deleted, so the earlier run set stays readable in the PR's
   * ordinary run history.
   */
  async latestMultiRun(workspaceId: string, prId: string): Promise<MultiRunRow | undefined> {
    const [row] = await this.db
      .select({
        id: t.multiAgentRuns.id,
        prId: t.multiAgentRuns.prId,
        ranAt: t.multiAgentRuns.ranAt,
      })
      .from(t.multiAgentRuns)
      .where(
        and(
          eq(t.multiAgentRuns.workspaceId, workspaceId),
          eq(t.multiAgentRuns.prId, prId),
        ),
      )
      // `id` is the tiebreak: two multi-runs created in the same millisecond
      // would otherwise resolve in an arbitrary order.
      .orderBy(desc(t.multiAgentRuns.ranAt), desc(t.multiAgentRuns.id))
      .limit(1);
    return row;
  }

  /**
   * One `AgentColumn` per `agent_run` linked to the multi-run.
   *
   * `provider` / `model` / `status` / `duration_ms` / `cost_usd` come from
   * `agent_runs`; `verdict` / `summary` / `score` / `findings` come from the
   * run's review. `reviews.runId` has **no FK and no unique index**
   * (server/INSIGHTS.md:30) — never assume one review per run — so the run's
   * most recent `kind='review'` wins, falling back to its most recent review of
   * any kind, and a run with none renders null/empty rather than dropping its
   * column (§4 Q2).
   */
  async columnsForMultiRun(workspaceId: string, multiRunId: string): Promise<AgentColumn[]> {
    const runs = await this.db
      .select({ run: t.agentRuns, agentName: t.agents.name })
      .from(t.agentRuns)
      .leftJoin(t.agents, eq(t.agents.id, t.agentRuns.agentId))
      .where(
        and(
          eq(t.agentRuns.workspaceId, workspaceId),
          eq(t.agentRuns.multiAgentRunId, multiRunId),
        ),
      )
      .orderBy(t.agentRuns.ranAt, t.agentRuns.id);
    if (runs.length === 0) return [];

    const runIds = runs.map((r) => r.run.id);
    const reviews = await this.db
      .select()
      .from(t.reviews)
      .where(
        and(eq(t.reviews.workspaceId, workspaceId), inArray(t.reviews.runId, runIds)),
      )
      .orderBy(desc(t.reviews.createdAt), desc(t.reviews.id));

    const chosen = new Map<string, (typeof reviews)[number]>();
    for (const review of reviews) {
      if (!review.runId) continue;
      const current = chosen.get(review.runId);
      // `reviews` is already newest-first, so the FIRST row seen for a run is
      // its newest of any kind; a later `kind='review'` only wins if the
      // incumbent is not itself a 'review'.
      if (!current) chosen.set(review.runId, review);
      else if (current.kind !== 'review' && review.kind === 'review') {
        chosen.set(review.runId, review);
      }
    }

    const reviewIds = [...chosen.values()].map((r) => r.id);
    const findingRows = reviewIds.length
      ? await this.db
          .select()
          .from(t.findings)
          .where(inArray(t.findings.reviewId, reviewIds))
          .orderBy(t.findings.file, t.findings.startLine, t.findings.id)
      : [];
    const findingsByReview = new Map<string, AgentColumnFinding[]>();
    for (const f of findingRows) {
      const list = findingsByReview.get(f.reviewId) ?? [];
      list.push({
        id: f.id,
        severity: toSeverity(f.severity),
        category: f.category,
        title: f.title,
        file: f.file,
        start_line: f.startLine,
        kind: f.kind,
      });
      findingsByReview.set(f.reviewId, list);
    }

    return runs.map(({ run, agentName }) => {
      const review = run.id ? chosen.get(run.id) : undefined;
      return {
        run_id: run.id,
        // A run whose agent was deleted keeps its history with `agent_id` NULL
        // (runs.ts `set null`); the column still renders, attributed to "".
        agent_id: run.agentId ?? '',
        agent_name: agentName ?? '',
        provider: run.provider,
        model: run.model,
        status: toColumnStatus(run.status),
        verdict: review?.verdict ?? null,
        score: review?.score ?? null,
        summary: review?.summary ?? null,
        duration_ms: run.durationMs,
        cost_usd: run.costUsd,
        findings: review ? (findingsByReview.get(review.id) ?? []) : [],
      };
    });
  }
}
