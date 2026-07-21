/**
 * CI data access — `ci_installations` + `ci_runs`.
 *
 * Every read is workspace-scoped through the `ci_installations → agents` join
 * (AC-38, AC-46); there is deliberately no unscoped `getById`. The one
 * exception is `findInstallationForAgent`, which takes an agent id the SERVICE
 * has already resolved inside the workspace — the scope is upstream, not absent.
 *
 * Layer rule: a repository REPORTS, it does not decide. Nothing here imports
 * `platform/errors` (no repository in this codebase does) — `undefined` and
 * plain outcome objects come back, and `service.ts` / `ingest.ts` turn them into
 * `NotFoundError` / `BadRequestError` / `ExternalServiceError`.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { CiTarget } from '@devdigest/shared';

export type CiInstallationRow = typeof t.ciInstallations.$inferSelect;
export type CiRunRow = typeof t.ciRuns.$inferSelect;

/**
 * A run plus the repository slug of the installation it belongs to.
 *
 * `CiRun` carries only `ci_installation_id`, but the CI Runs table shows the
 * repository (AC-40). The slug is composed onto the row here — where the join
 * that enforces AC-38 already has it — rather than by adding a field to the
 * `CiRun` contract (that would be a second dual-vendored edit, and the spec
 * budgets exactly one). It is a value the SERVER owns: it comes from the
 * installation row the user created, never from third-party CI output.
 */
export interface CiRunWithRepo {
  run: CiRunRow;
  repo: string;
}

/** An installation plus the agent id/name needed to regenerate its bundle. */
export interface CiInstallationWithAgent {
  installation: CiInstallationRow;
  agentId: string;
}

/** Everything ingest persists for one workflow run. Never partially applied. */
export interface UpsertRunValues {
  prNumber: number | null;
  ranAt: Date | null;
  status: string;
  findingsCount: number | null;
  costUsd: number | null;
  /** From the workflow-run listing (`htmlUrl`) — NOT from the result artifact. */
  githubUrl: string;
  source: string;
  agent: string | null;
  durationS: number | null;
}

export class CiRepository {
  constructor(private db: Db) {}

  // ---- ci_installations ---------------------------------------------------

  /** Installations of one agent, oldest first. Workspace-scoped via the agents join. */
  async listInstallationsForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.agentId, agentId)))
      .orderBy(t.ciInstallations.installedAt);
    return rows.map((r) => r.installation);
  }

  /** Every installation reachable from this workspace — the refresh fan-out set (AC-32). */
  async listInstallationsForWorkspace(workspaceId: string): Promise<CiInstallationRow[]> {
    const rows = await this.db
      .select({ installation: t.ciInstallations })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(t.ciInstallations.installedAt);
    return rows.map((r) => r.installation);
  }

  /** One installation addressed by its own id, scoped to the workspace (AC-31, AC-46). */
  async getInstallation(
    workspaceId: string,
    id: string,
  ): Promise<CiInstallationWithAgent | undefined> {
    const [row] = await this.db
      .select({ installation: t.ciInstallations, agentId: t.agents.id })
      .from(t.ciInstallations)
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(and(eq(t.agents.workspaceId, workspaceId), eq(t.ciInstallations.id, id)));
    return row;
  }

  /** The (agent, repo) installation, if one exists. The agent id is pre-scoped by the caller. */
  async findInstallationForAgent(
    agentId: string,
    repo: string,
  ): Promise<CiInstallationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.ciInstallations)
      .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)));
    return row;
  }

  /**
   * AC-27 — exactly one row per (agent, repository). A re-export UPDATES the
   * existing row (refreshing `target_type` + `installed_at`) instead of
   * inserting a second one. There is no unique index to hang
   * `onConflictDoUpdate` on (the spec's rollout authorises additive nullable
   * columns only), so the read-then-write is deliberate and runs inside one
   * transaction; AC-47's 10/min export limit bounds the residual race.
   */
  async upsertInstallation(
    agentId: string,
    repo: string,
    targetType: CiTarget,
  ): Promise<CiInstallationRow> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(t.ciInstallations)
        .where(and(eq(t.ciInstallations.agentId, agentId), eq(t.ciInstallations.repo, repo)));
      if (existing) {
        const [updated] = await tx
          .update(t.ciInstallations)
          .set({ targetType, installedAt: new Date() })
          .where(eq(t.ciInstallations.id, existing.id))
          .returning();
        return updated!;
      }
      const [inserted] = await tx
        .insert(t.ciInstallations)
        .values({ agentId, repo, targetType })
        .returning();
      return inserted!;
    });
  }

  // ---- ci_runs ------------------------------------------------------------

  /**
   * Runs reachable installation → agent → workspace, newest first (AC-38).
   * The INNER joins are the scoping: a run with a null installation reference
   * (or one belonging to another tenant) cannot appear in this result at all.
   */
  async listRuns(workspaceId: string): Promise<CiRunWithRepo[]> {
    return this.db
      .select({ run: t.ciRuns, repo: t.ciInstallations.repo })
      .from(t.ciRuns)
      .innerJoin(t.ciInstallations, eq(t.ciRuns.ciInstallationId, t.ciInstallations.id))
      .innerJoin(t.agents, eq(t.ciInstallations.agentId, t.agents.id))
      .where(eq(t.agents.workspaceId, workspaceId))
      .orderBy(desc(t.ciRuns.ranAt));
  }

  /** Most recent ingested run per installation (AC-43). Installations with none are absent. */
  async latestRunPerInstallation(installationIds: string[]): Promise<Map<string, CiRunRow>> {
    const latest = new Map<string, CiRunRow>();
    if (installationIds.length === 0) return latest;
    const rows = await this.db
      .select()
      .from(t.ciRuns)
      .where(inArray(t.ciRuns.ciInstallationId, installationIds))
      .orderBy(desc(t.ciRuns.ranAt));
    for (const row of rows) {
      const key = row.ciInstallationId;
      if (key && !latest.has(key)) latest.set(key, row);
    }
    return latest;
  }

  /**
   * AC-34 — re-ingesting a workflow run UPDATES the existing record, keyed by
   * (installation, workflow-run URL). Refreshing the same run three times
   * leaves the row count unchanged with the newest values in place.
   *
   * `installationId` is required, not optional: AC-38 forbids creating a run
   * that is not attached to an installation, and the column being nullable in
   * the schema does not make a null value acceptable here.
   */
  async upsertRun(
    installationId: string,
    githubUrl: string,
    values: UpsertRunValues,
  ): Promise<CiRunRow> {
    return this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: t.ciRuns.id })
        .from(t.ciRuns)
        .where(
          and(
            eq(t.ciRuns.ciInstallationId, installationId),
            eq(t.ciRuns.githubUrl, githubUrl),
          ),
        );
      if (existing) {
        const [updated] = await tx
          .update(t.ciRuns)
          .set(values)
          .where(eq(t.ciRuns.id, existing.id))
          .returning();
        return updated!;
      }
      const [inserted] = await tx
        .insert(t.ciRuns)
        .values({ ciInstallationId: installationId, ...values })
        .returning();
      return inserted!;
    });
  }
}
