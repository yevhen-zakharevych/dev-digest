import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { ConventionStatus } from '@devdigest/shared';

/**
 * L0X — Conventions data-access layer. The ONLY place that touches the
 * `conventions` table. Every query is workspace-scoped (tenancy guard).
 *
 * Status / accepted columns are kept in lockstep: writers go through
 * `setStatus`, which mirrors `accepted` automatically.
 */

export type ConventionRow = typeof t.conventions.$inferSelect;

export interface InsertConvention {
  workspaceId: string;
  repoId: string;
  scanId: string;
  rule: string;
  evidencePath: string;
  evidenceSnippet: string;
  confidence: number;
}

export class ConventionsRepository {
  constructor(private db: Db) {}

  async listByRepo(
    workspaceId: string,
    repoId: string,
    statuses: ConventionStatus[],
  ): Promise<ConventionRow[]> {
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.status, statuses),
        ),
      )
      .orderBy(desc(t.conventions.createdAt));
  }

  async getById(workspaceId: string, id: string): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.conventions)
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)));
    return row;
  }

  async getByIds(
    workspaceId: string,
    repoId: string,
    ids: string[],
  ): Promise<ConventionRow[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(t.conventions)
      .where(
        and(
          eq(t.conventions.workspaceId, workspaceId),
          eq(t.conventions.repoId, repoId),
          inArray(t.conventions.id, ids),
        ),
      );
  }

  async insertMany(values: InsertConvention[]): Promise<ConventionRow[]> {
    if (values.length === 0) return [];
    return this.db
      .insert(t.conventions)
      .values(
        values.map((v) => ({
          workspaceId: v.workspaceId,
          repoId: v.repoId,
          scanId: v.scanId,
          rule: v.rule,
          evidencePath: v.evidencePath,
          evidenceSnippet: v.evidenceSnippet,
          confidence: v.confidence,
          status: 'pending' as const,
          accepted: false,
        })),
      )
      .returning();
  }

  async setStatus(
    workspaceId: string,
    id: string,
    status: ConventionStatus,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ status, accepted: status === 'accepted', updatedAt: new Date() })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }

  async updateRule(
    workspaceId: string,
    id: string,
    rule: string,
  ): Promise<ConventionRow | undefined> {
    const [row] = await this.db
      .update(t.conventions)
      .set({ rule, updatedAt: new Date() })
      .where(and(eq(t.conventions.workspaceId, workspaceId), eq(t.conventions.id, id)))
      .returning();
    return row;
  }
}
