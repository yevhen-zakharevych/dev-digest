import { and, asc, desc, eq, sql, inArray, gte } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { SkillRow, SkillVersionRow } from '../../db/rows.js';
import type { SkillSource, SkillType } from '@devdigest/shared';

export type { SkillRow, SkillVersionRow };

/** A skill row enriched with per-skill aggregates for the /skills list card. */
export interface SkillStats {
  agentsCount: number;
}

/**
 * L02 — skills data-access. Owns `skills` + `skill_versions`. Workspace-scoped.
 *
 * Version semantics mirror agents: any change to the skill `body` bumps `version`
 * and snapshots the new body into `skill_versions`. Renames/description/type/
 * enabled toggles do NOT bump (consistent with what the run-prompt reads).
 */

export interface InsertSkill {
  workspaceId: string;
  name: string;
  description: string;
  type: SkillType;
  source: SkillSource;
  body: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export interface UpdateSkill {
  name?: string;
  description?: string;
  type?: SkillType;
  body?: string;
  enabled?: boolean;
  evidenceFiles?: string[];
}

export class SkillsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<SkillRow[]> {
    return this.db
      .select()
      .from(t.skills)
      .where(eq(t.skills.workspaceId, workspaceId))
      .orderBy(asc(t.skills.name));
  }

  async getById(workspaceId: string, id: string): Promise<SkillRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)));
    return row;
  }

  async insert(values: InsertSkill): Promise<SkillRow> {
    const [row] = await this.db
      .insert(t.skills)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description,
        type: values.type,
        source: values.source,
        body: values.body,
        enabled: values.enabled ?? true,
        version: 1,
        evidenceFiles: values.evidenceFiles ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, 1);
    return row!;
  }

  async update(
    workspaceId: string,
    id: string,
    patch: UpdateSkill,
  ): Promise<SkillRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    const bodyChanged = patch.body !== undefined && patch.body !== existing.body;
    const nextVersion = bodyChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.skills)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.type !== undefined ? { type: patch.type } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.evidenceFiles !== undefined
          ? { evidenceFiles: patch.evidenceFiles }
          : {}),
        ...(bodyChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning();

    if (bodyChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.skills)
      .where(and(eq(t.skills.workspaceId, workspaceId), eq(t.skills.id, id)))
      .returning({ id: t.skills.id });
    return rows.length > 0;
  }

  async listVersions(skillId: string): Promise<SkillVersionRow[]> {
    return this.db
      .select()
      .from(t.skillVersions)
      .where(eq(t.skillVersions.skillId, skillId))
      .orderBy(desc(t.skillVersions.version));
  }

  /**
   * Per-skill aggregates surfaced on the /skills card.
   * Right now: just the linked-agents count (DISTINCT on agent_id, since the
   * link is keyed by (agent_id, skill_id) the count is exact). Pull rate +
   * accept rate are L06/L07 (need agent_runs + findings outcomes).
   */
  async statsFor(skillIds: string[]): Promise<Map<string, SkillStats>> {
    const m = new Map<string, SkillStats>();
    if (skillIds.length === 0) return m;
    const rows = await this.db
      .select({
        skillId: t.agentSkills.skillId,
        agents: sql<number>`count(distinct ${t.agentSkills.agentId})::int`,
      })
      .from(t.agentSkills)
      .where(inArray(t.agentSkills.skillId, skillIds))
      .groupBy(t.agentSkills.skillId);
    for (const r of rows) m.set(r.skillId, { agentsCount: r.agents });
    // Skills with zero linked agents won't appear in the join — fill them in.
    for (const id of skillIds) if (!m.has(id)) m.set(id, { agentsCount: 0 });
    return m;
  }

  async getVersion(skillId: string, version: number): Promise<SkillVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.skillVersions)
      .where(and(eq(t.skillVersions.skillId, skillId), eq(t.skillVersions.version, version)));
    return row;
  }

  async detailStatsFor(
    workspaceId: string,
    skillId: string,
  ): Promise<{
    agents: { id: string; name: string }[];
    findingsTotal: number;
    findingsAccepted: number;
    findingsByCategory: { label: string; value: number }[];
  }> {
    // Agents linked to this skill
    const agentRows = await this.db
      .select({ id: t.agents.id, name: t.agents.name })
      .from(t.agentSkills)
      .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
      .where(
        and(eq(t.agentSkills.skillId, skillId), eq(t.agents.workspaceId, workspaceId)),
      );

    const agentIds = agentRows.map((a) => a.id);

    if (agentIds.length === 0) {
      return { agents: agentRows, findingsTotal: 0, findingsAccepted: 0, findingsByCategory: [] };
    }

    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    // Reviews by those agents in the last 30 days
    const reviewIds = await this.db
      .select({ id: t.reviews.id })
      .from(t.reviews)
      .where(
        and(
          inArray(t.reviews.agentId, agentIds),
          gte(t.reviews.createdAt, since),
        ),
      );

    if (reviewIds.length === 0) {
      return { agents: agentRows, findingsTotal: 0, findingsAccepted: 0, findingsByCategory: [] };
    }

    const reviewIdList = reviewIds.map((r) => r.id);

    // Findings aggregated by category
    const categoryRows = await this.db
      .select({
        category: t.findings.category,
        total: sql<number>`count(*)::int`,
        accepted: sql<number>`count(${t.findings.acceptedAt})::int`,
      })
      .from(t.findings)
      .where(inArray(t.findings.reviewId, reviewIdList))
      .groupBy(t.findings.category);

    const findingsTotal = categoryRows.reduce((s, r) => s + r.total, 0);
    const findingsAccepted = categoryRows.reduce((s, r) => s + r.accepted, 0);
    const findingsByCategory = categoryRows.map((r) => ({ label: r.category, value: r.total }));

    return { agents: agentRows, findingsTotal, findingsAccepted, findingsByCategory };
  }

  private async snapshotVersion(row: SkillRow, version: number): Promise<void> {
    await this.db
      .insert(t.skillVersions)
      .values({ skillId: row.id, version, body: row.body })
      .onConflictDoNothing();
  }
}
