import { eq } from 'drizzle-orm';
import type { RiskBrief } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L06 — Why+Risk Brief data-access. The ONLY place that touches the `pr_brief`
 * table. One row per PR (PK `prId`); Regenerate replaces it (last-write-wins,
 * all-or-nothing). The table has NO `workspace_id` column — tenancy is enforced
 * upstream by resolving the PR within the caller's workspace
 * (`reviewRepo.getPull(workspaceId, prId)`) before any query reaches here, the
 * same pattern as `onboarding`/intent/blast (`server/INSIGHTS.md:264`).
 */

export type BriefRow = typeof t.prBrief.$inferSelect;

/** Values a SUCCESSFUL generation persists (a model failure persists nothing, AC-16). */
export interface UpsertBrief {
  prId: string;
  brief: RiskBrief;
  headSha: string;
  model: string;
  costUsd: number | null;
  tokensIn: number;
  tokensOut: number;
  generatedAt: Date;
}

export class BriefRepository {
  constructor(private db: Db) {}

  async get(prId: string): Promise<BriefRow | undefined> {
    const [row] = await this.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    return row;
  }

  /**
   * Upsert the brief keyed by PR (AC-13). Replaces any prior row against the
   * generated-against `headSha` (AC-15 last-write-wins). Only a successful
   * generation calls this.
   */
  async upsert(input: UpsertBrief): Promise<BriefRow> {
    const values = {
      prId: input.prId,
      json: input.brief,
      headSha: input.headSha,
      model: input.model,
      costUsd: input.costUsd,
      tokensIn: input.tokensIn,
      tokensOut: input.tokensOut,
      generatedAt: input.generatedAt,
    };
    const [row] = await this.db
      .insert(t.prBrief)
      .values(values)
      .onConflictDoUpdate({ target: t.prBrief.prId, set: values })
      .returning();
    return row!;
  }
}
