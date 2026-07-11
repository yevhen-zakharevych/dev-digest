import { and, eq } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';

/**
 * Project-context data reads that don't belong to any other module's
 * repository: the batched "which agents would inject this doc" query behind
 * `DiscoveredDocument.used_by_agents` (AC-13).
 *
 * Deliberately TWO queries total per discovery call (agents + enabled links),
 * never one query per document — the assembly happens in-memory below.
 */
export class ContextRepository {
  constructor(private db: Db) {}

  /**
   * Map every path attached anywhere in this workspace to the COUNT of agents
   * that would inject it on a run: those attaching it directly on
   * `agents.attached_docs`, plus those inheriting it through a linked skill
   * whose link is enabled AND whose skill is enabled — the same effective set
   * the run executor loads (`run-executor.ts`: `l.enabled && l.skill.enabled`).
   * A disabled link or a disabled skill contributes nothing, matching AC-18's
   * effective-set semantics.
   *
   * `discoveredPaths` restricts the returned map to paths the CALLER'S repo
   * actually discovered (FIX 2) — an attach list stores bare repo-relative
   * paths with no repo binding anywhere in the schema (`agents.attached_docs`,
   * `skills.attached_docs`), so this is the closest correctness guarantee the
   * current data model allows: a repo's discovery never reports usage for a
   * path it did not itself discover. It does NOT fully disambiguate two
   * different repos that both happen to contain a file at the identical
   * repo-relative path — that would require adding a repo id to the attach
   * list, out of scope here.
   */
  async usedByAgentsCounts(
    workspaceId: string,
    discoveredPaths: readonly string[],
  ): Promise<Map<string, number>> {
    if (discoveredPaths.length === 0) return new Map();
    const discovered = new Set(discoveredPaths);
    const [agentRows, linkRows] = await Promise.all([
      this.db
        .select({ id: t.agents.id, attachedDocs: t.agents.attachedDocs })
        .from(t.agents)
        .where(eq(t.agents.workspaceId, workspaceId)),
      this.db
        .select({ agentId: t.agentSkills.agentId, attachedDocs: t.skills.attachedDocs })
        .from(t.agentSkills)
        .innerJoin(t.agents, eq(t.agentSkills.agentId, t.agents.id))
        .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
        .where(
          and(
            eq(t.agents.workspaceId, workspaceId),
            eq(t.agentSkills.enabled, true),
            eq(t.skills.enabled, true),
          ),
        ),
    ]);

    const agentsByPath = new Map<string, Set<string>>();
    const add = (agentId: string, paths: string[] | null | undefined) => {
      for (const path of paths ?? []) {
        if (!discovered.has(path)) continue; // FIX 2: only this repo's own docs
        let agentIds = agentsByPath.get(path);
        if (!agentIds) {
          agentIds = new Set();
          agentsByPath.set(path, agentIds);
        }
        agentIds.add(agentId);
      }
    };
    for (const row of agentRows) add(row.id, row.attachedDocs);
    for (const row of linkRows) add(row.agentId, row.attachedDocs);

    const counts = new Map<string, number>();
    for (const [path, agentIds] of agentsByPath) counts.set(path, agentIds.size);
    return counts;
  }
}
