import { eq } from 'drizzle-orm';
import type { OnboardingSection } from '@devdigest/shared';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * L05 — Onboarding data-access layer. The ONLY place that touches the
 * `onboarding` table. One row per repo (PK `repoId`); Regenerate replaces it
 * (last-write-wins, all-or-nothing). The table has no `workspace_id` column —
 * tenancy is enforced upstream by resolving the repo within the caller's
 * workspace before any query reaches here (see service).
 */

export type OnboardingRow = typeof t.onboarding.$inferSelect;

/** Values a SUCCESSFUL generation persists (Gap-4: only success writes). */
export interface UpsertOnboarding {
  repoId: string;
  sections: OnboardingSection[];
  indexedSha: string;
  filesIndexed: number;
  model: string | null;
  costUsd: number | null;
  generatedAt: Date;
}

export class OnboardingRepository {
  constructor(private db: Db) {}

  async get(repoId: string): Promise<OnboardingRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.onboarding)
      .where(eq(t.onboarding.repoId, repoId));
    return row;
  }

  /**
   * Upsert the artifact keyed by repo (AC-13). Only a successful full
   * generation calls this; the degraded/failed paths never persist.
   */
  async upsert(input: UpsertOnboarding): Promise<OnboardingRow> {
    const values = {
      repoId: input.repoId,
      json: input.sections,
      indexedSha: input.indexedSha,
      filesIndexed: input.filesIndexed,
      status: 'full',
      degraded: false,
      degradedReason: null,
      model: input.model,
      costUsd: input.costUsd,
      generatedAt: input.generatedAt,
    };
    const [row] = await this.db
      .insert(t.onboarding)
      .values(values)
      .onConflictDoUpdate({ target: t.onboarding.repoId, set: values })
      .returning();
    return row!;
  }
}
