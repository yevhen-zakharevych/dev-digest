import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type {
  CiFailOn,
  EvalEffectiveConfig,
  EvalSkillVersionDivergence,
  Provider,
  ReviewStrategy,
} from '@devdigest/shared';
import { DEFAULT_AGENT_DESCRIPTION, INITIAL_AGENT_VERSION } from './constants.js';
import { resolveEffectiveConfig } from './effective-config.js';
import { isConfigChange } from './helpers.js';

/**
 * A2 — agents data-access. Owns `agents`, `agent_versions`, and the
 * `agent_skills` link table (shared with A1's skills repository, but A2 owns the
 * agent side: link/reorder/list for an agent). Workspace-scoped throughout.
 */

import type { AgentRow, AgentVersionRow } from '../../db/rows.js';
export type { AgentRow, AgentVersionRow };

export interface InsertAgent {
  workspaceId: string;
  name: string;
  description?: string;
  provider: Provider;
  model: string;
  systemPrompt: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
  createdBy?: string | null;
}

export interface UpdateAgent {
  name?: string;
  description?: string;
  provider?: Provider;
  model?: string;
  systemPrompt?: string;
  outputSchema?: unknown;
  strategy?: ReviewStrategy;
  ciFailOn?: CiFailOn;
  repoIntel?: boolean;
  enabled?: boolean;
}

/** A skill linked to an agent (with its order + per-link enabled), joined from agent_skills. */
export interface LinkedSkillRow {
  skill: typeof t.skills.$inferSelect;
  order: number;
  enabled: boolean;
}

/** Outcome of `promoteConfig` (AC-27). `config` is what is LIVE after the promote —
 *  re-resolved from the written rows, not the input echoed back. */
export interface PromoteConfigResult {
  agent: AgentRow;
  /** The NEW version appended at the head of the agent's history. */
  version: number;
  config: EvalEffectiveConfig;
  /** Pinned skills whose live body-version has moved on since the run (REC-3 / A-2). */
  skillVersionDivergence: EvalSkillVersionDivergence[];
}

/**
 * Outcome of `promoteConfig`. A repository reports WHAT happened; deciding that a
 * refusal is an HTTP 400 is the service's call — no repository in this codebase
 * imports `platform/errors` (8 services do). Shape follows the existing
 * `ResolveResult` idiom (`server/INSIGHTS.md:157`): intersection-then-union, which
 * still narrows on `.ok`.
 */
export type PromoteConfigOutcome =
  | ({ ok: true } & PromoteConfigResult)
  | { ok: false; reason: 'missing_skills'; missingSkills: { id: string; name: string }[] };

export class AgentsRepository {
  constructor(private db: Db) {}

  async list(workspaceId: string): Promise<AgentRow[]> {
    return this.db.select().from(t.agents).where(eq(t.agents.workspaceId, workspaceId));
  }

  async statsFor(agentIds: string[]): Promise<Map<string, { skillsCount: number }>> {
    const m = new Map<string, { skillsCount: number }>();
    if (agentIds.length === 0) return m;
    const rows = await this.db
      .select({
        agentId: t.agentSkills.agentId,
        skills: sql<number>`count(distinct ${t.agentSkills.skillId})::int`,
      })
      .from(t.agentSkills)
      .where(inArray(t.agentSkills.agentId, agentIds))
      .groupBy(t.agentSkills.agentId);
    for (const r of rows) m.set(r.agentId, { skillsCount: r.skills });
    for (const id of agentIds) if (!m.has(id)) m.set(id, { skillsCount: 0 });
    return m;
  }

  async listEnabled(workspaceId: string): Promise<AgentRow[]> {
    return this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.enabled, true)));
  }

  async getById(workspaceId: string, id: string): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agents)
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)));
    return row;
  }

  /**
   * Delete an agent (scoped to workspace). Versions/skill-links cascade;
   * agent_runs keep their history with agent_id set null. Returns false if
   * no such agent existed in the workspace.
   *
   * AC-53 — the eval cases owned by the agent are deleted **application-side,
   * in the same transaction**. `eval_cases.owner_id` is polymorphic
   * (`owner_kind` is `'skill' | 'agent'`) and therefore carries **no FK**, so
   * Postgres will not cascade it: without this, deleting an agent would leave
   * orphaned cases that are still readable. Eval runs and drafts *do* have a
   * real `agent_id` FK and cascade for free (and take their per-case results
   * with them), which is why they are deleted first — by the agent row's own
   * cascade — before the cases they point at.
   */
  async deleteById(workspaceId: string, id: string): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .delete(t.agents)
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
        .returning({ id: t.agents.id });
      if (rows.length === 0) return false;

      await tx
        .delete(t.evalCases)
        .where(
          and(
            eq(t.evalCases.workspaceId, workspaceId),
            eq(t.evalCases.ownerKind, 'agent'),
            eq(t.evalCases.ownerId, id),
          ),
        );
      return true;
    });
  }

  /** Insert an agent AND record version 1 in agent_versions (immutable snapshot). */
  async insert(values: InsertAgent): Promise<AgentRow> {
    const [row] = await this.db
      .insert(t.agents)
      .values({
        workspaceId: values.workspaceId,
        name: values.name,
        description: values.description ?? DEFAULT_AGENT_DESCRIPTION,
        provider: values.provider,
        model: values.model,
        systemPrompt: values.systemPrompt,
        outputSchema: (values.outputSchema as object | undefined) ?? null,
        ...(values.strategy !== undefined ? { strategy: values.strategy } : {}),
        ...(values.ciFailOn !== undefined ? { ciFailOn: values.ciFailOn } : {}),
        ...(values.repoIntel !== undefined ? { repoIntel: values.repoIntel } : {}),
        enabled: values.enabled ?? true,
        version: INITIAL_AGENT_VERSION,
        createdBy: values.createdBy ?? null,
      })
      .returning();
    await this.snapshotVersion(row!, INITIAL_AGENT_VERSION);
    return row!;
  }

  /**
   * Update an agent. Any config change bumps the version and snapshots the new
   * config into agent_versions (reproducibility for eval).
   */
  async update(
    workspaceId: string,
    id: string,
    patch: UpdateAgent,
  ): Promise<AgentRow | undefined> {
    const existing = await this.getById(workspaceId, id);
    if (!existing) return undefined;

    // A config-affecting change (anything except just toggling enabled) bumps version.
    const configChanged = isConfigChange(existing, patch);
    const nextVersion = configChanged ? existing.version + 1 : existing.version;

    const [row] = await this.db
      .update(t.agents)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.provider !== undefined ? { provider: patch.provider } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
        ...(patch.outputSchema !== undefined
          ? { outputSchema: patch.outputSchema as object }
          : {}),
        ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
        ...(patch.ciFailOn !== undefined ? { ciFailOn: patch.ciFailOn } : {}),
        ...(patch.repoIntel !== undefined ? { repoIntel: patch.repoIntel } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(configChanged ? { version: nextVersion } : {}),
      })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, id)))
      .returning();

    if (configChanged && row) await this.snapshotVersion(row, nextVersion);
    return row;
  }

  private async snapshotVersion(row: AgentRow, version: number): Promise<void> {
    const skills = await this.skillIdsForAgent(row.id);
    await this.db
      .insert(t.agentVersions)
      .values({
        agentId: row.id,
        version,
        configJson: {
          provider: row.provider,
          model: row.model,
          system_prompt: row.systemPrompt,
          output_schema: row.outputSchema,
          strategy: row.strategy,
          ci_fail_on: row.ciFailOn,
          repo_intel: row.repoIntel,
          skills,
        },
      })
      .onConflictDoNothing();
  }

  // ---- agent_versions (immutable config snapshots) ------------------------

  /** All config snapshots for an agent, newest version first. */
  async listVersions(agentId: string): Promise<AgentVersionRow[]> {
    return this.db
      .select()
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId))
      .orderBy(desc(t.agentVersions.version));
  }

  /** A single config snapshot, or undefined if that version was never recorded. */
  async getVersion(agentId: string, version: number): Promise<AgentVersionRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.agentVersions)
      .where(and(eq(t.agentVersions.agentId, agentId), eq(t.agentVersions.version, version)));
    return row;
  }

  // ---- agent_skills link table (A2 owns the agent side) -------------------

  /** Skills linked to an agent, in `order` ascending. */
  async linkedSkills(agentId: string): Promise<LinkedSkillRow[]> {
    const rows = await this.db
      .select({
        skill: t.skills,
        order: t.agentSkills.order,
        enabled: t.agentSkills.enabled,
      })
      .from(t.agentSkills)
      .innerJoin(t.skills, eq(t.agentSkills.skillId, t.skills.id))
      .where(eq(t.agentSkills.agentId, agentId))
      .orderBy(asc(t.agentSkills.order));
    return rows.map((r) => ({ skill: r.skill, order: r.order, enabled: r.enabled }));
  }

  async skillIdsForAgent(agentId: string): Promise<string[]> {
    const links = await this.linkedSkills(agentId);
    return links.map((l) => l.skill.id);
  }

  /** Link a skill to an agent at a given order (idempotent: upserts order). */
  async linkSkill(
    agentId: string,
    skillId: string,
    order: number,
    enabled = true,
  ): Promise<void> {
    await this.db
      .insert(t.agentSkills)
      .values({ agentId, skillId, order, enabled })
      .onConflictDoUpdate({
        target: [t.agentSkills.agentId, t.agentSkills.skillId],
        set: { order, enabled },
      });
  }

  async unlinkSkill(agentId: string, skillId: string): Promise<void> {
    await this.db
      .delete(t.agentSkills)
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)));
  }

  /** Toggle the per-link enabled flag (the skill stays in the set). */
  async setLinkEnabled(agentId: string, skillId: string, enabled: boolean): Promise<boolean> {
    const rows = await this.db
      .update(t.agentSkills)
      .set({ enabled })
      .where(and(eq(t.agentSkills.agentId, agentId), eq(t.agentSkills.skillId, skillId)))
      .returning({ skillId: t.agentSkills.skillId });
    return rows.length > 0;
  }

  /**
   * Replace the full set of linked skills for an agent with `skillIds`, assigning
   * order = index. Used by the "Skills" editor tab (attach/reorder). Skills not in
   * the list are unlinked. Preserves the previous `enabled` per skill_id when a
   * skill is already linked — the operation is reorder-only.
   */
  async setSkills(agentId: string, skillIds: string[]): Promise<void> {
    const existing = await this.linkedSkills(agentId);
    const prevEnabled = new Map(existing.map((l) => [l.skill.id, l.enabled]));
    await this.db.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
    if (skillIds.length === 0) return;
    await this.db
      .insert(t.agentSkills)
      .values(
        skillIds.map((skillId, i) => ({
          agentId,
          skillId,
          order: i,
          enabled: prevEnabled.get(skillId) ?? true,
        })),
      );
  }

  // ---- promote (eval → live config) ---------------------------------------

  /**
   * AC-27 — make a run's pinned **effective config** the agent's **live**
   * config: the prompt/provider/model/strategy/`repo_intel` fields **and** the
   * skill links it pins, appending a **new** version at the head of the
   * (append-only) history. No existing version is ever deleted or rewritten.
   *
   * Three things here are load-bearing, and all three are wrong in the obvious
   * implementation — silently, and green:
   *
   * 1. **Order: links FIRST, snapshot AFTER.** `snapshotVersion` reads the
   *    agent's *current* skill links (`skillIdsForAgent`, above). `update()`
   *    calls it internally, so the natural `update()`-then-`setSkills()` would
   *    write a snapshot describing the **pre-promote** skill set — a version
   *    that exists but lies about what is in it.
   * 2. **The bump is UNCONDITIONAL, and promote owns it.** `isConfigChange()`
   *    compares only the eight `agents`-row fields and `UpdateAgent` has no
   *    `skills` field at all, so a promote differing from the live agent
   *    **only in its skill set** would pass `update()` with nothing changed →
   *    no version, no snapshot → AC-27's observable fails in exactly the
   *    skill-regression scenario this feature exists to catch. `isConfigChange`
   *    is deliberately NOT weakened: that would change every ordinary agent
   *    update repo-wide.
   * 3. **Link `enabled` comes from the PIN, not from today's links.**
   *    `setSkills` deliberately *preserves* the live per-link `enabled` flag
   *    (it is a reorder-only helper). Reusing it would re-link a pinned skill
   *    whose live link is disabled as **still disabled** — the skill would not
   *    reach the prompt, and the "restored" config would not equal the one the
   *    run measured. Promote therefore writes the links itself.
   *
   * All of it in ONE transaction. Returns `undefined` when no such agent exists
   * in the workspace (route → 404).
   *
   * `skillVersionDivergence` reports any pinned skill whose **live version has
   * moved on** since the run (a body edit bumps the skill's own version only).
   * Promote restores skill **links**, not skill **bodies** — the divergence is
   * surfaced rather than silently shipping content no eval run ever measured.
   */
  async promoteConfig(
    workspaceId: string,
    agentId: string,
    cfg: EvalEffectiveConfig,
  ): Promise<PromoteConfigOutcome | undefined> {
    return this.db.transaction(async (tx) => {
      // The tx handle is API-compatible with `Db`; the cast lets the whole
      // promote reuse the repository's own readers/snapshot inside the tx.
      const txRepo = new AgentsRepository(tx as unknown as Db);

      const existing = await txRepo.getById(workspaceId, agentId);
      if (!existing) return undefined;

      // Pinned skills as they live TODAY (workspace-scoped). A skill deleted
      // since the run cannot be re-linked — fail loudly here rather than let
      // the agent_skills FK blow up as a 500, or (worse) silently drop it and
      // report a "promoted" config the agent does not actually have.
      const pinned = [...cfg.skills].sort((a, b) => a.order - b.order);
      const liveSkills = pinned.length
        ? await tx
            .select()
            .from(t.skills)
            .where(
              and(
                eq(t.skills.workspaceId, workspaceId),
                inArray(
                  t.skills.id,
                  pinned.map((s) => s.id),
                ),
              ),
            )
        : [];
      const liveById = new Map(liveSkills.map((s) => [s.id, s]));
      const missing = pinned.filter((s) => !liveById.has(s.id));
      if (missing.length > 0) {
        // Report, do not decide the HTTP status. Returning (rather than throwing)
        // still aborts before any write, so nothing is committed — and the check
        // stays INSIDE the transaction, which hoisting it to the service would
        // not (that would open a TOCTOU window between the check and the writes).
        return {
          ok: false as const,
          reason: 'missing_skills' as const,
          missingSkills: missing.map((s) => ({ id: s.id, name: s.name })),
        };
      }

      // (1) SKILL LINKS FIRST — so the snapshot taken below sees the PROMOTED
      //     set. `enabled` is taken from the pin (see #3 above), and `order` is
      //     re-indexed 0..n-1 in the pin's own order, matching `setSkills`.
      await tx.delete(t.agentSkills).where(eq(t.agentSkills.agentId, agentId));
      if (pinned.length > 0) {
        await tx.insert(t.agentSkills).values(
          pinned.map((s, i) => ({
            agentId,
            skillId: s.id,
            order: i,
            enabled: s.enabled,
          })),
        );
      }

      // (2) UNCONDITIONAL version bump — never routed through `update()`.
      //     Head of the history, not merely `agents.version + 1`: the two are
      //     equal today, but taking the max makes the new version provably new
      //     (and keeps `snapshotVersion`'s `onConflictDoNothing` from silently
      //     swallowing the snapshot).
      const [head] = await tx
        .select({ version: t.agentVersions.version })
        .from(t.agentVersions)
        .where(eq(t.agentVersions.agentId, agentId))
        .orderBy(desc(t.agentVersions.version))
        .limit(1);
      const nextVersion = Math.max(existing.version, head?.version ?? 0) + 1;

      const [row] = await tx
        .update(t.agents)
        .set({
          systemPrompt: cfg.system_prompt,
          provider: cfg.provider,
          model: cfg.model,
          strategy: cfg.strategy,
          repoIntel: cfg.repo_intel,
          version: nextVersion,
        })
        .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
        .returning();

      // (3) Snapshot AFTER the links — captures the promoted skill set.
      await txRepo.snapshotVersion(row!, nextVersion);

      // What is live NOW (re-resolved, not assumed): the honest answer to
      // "what did promote actually make live", including any skill whose body
      // version moved on since the run.
      const links = await txRepo.linkedSkills(agentId);
      const { config } = resolveEffectiveConfig(row!, links);

      const skillVersionDivergence: EvalSkillVersionDivergence[] = pinned.flatMap((pin) => {
        const live = liveById.get(pin.id)!;
        return live.version === pin.version
          ? []
          : [
              {
                skill_id: pin.id,
                name: live.name,
                pinned_version: pin.version,
                live_version: live.version,
              },
            ];
      });

      return { ok: true as const, agent: row!, version: nextVersion, config, skillVersionDivergence };
    });
  }

  // ---- attached_docs (project-context docs, mutable config) ---------------

  /**
   * Replace the ordered list of attached-doc paths for an agent (attach /
   * detach / reorder — an empty array detaches all). Order is the injection
   * order (AC-10); paths only, never document text (AC-9). Writes the column
   * directly, bypassing `update()`/`isConfigChange` on purpose — this must NOT
   * bump `agents.version` or write an `agent_versions` snapshot row (AC-14),
   * mirroring how `setSkills` above bypasses the same versioning path for the
   * agent_skills link table. Returns undefined if no such agent exists in the
   * workspace (route → 404).
   */
  async setAttachedDocs(
    workspaceId: string,
    agentId: string,
    paths: string[],
  ): Promise<AgentRow | undefined> {
    const [row] = await this.db
      .update(t.agents)
      .set({ attachedDocs: paths })
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.agents.id, agentId)))
      .returning();
    return row;
  }
}
