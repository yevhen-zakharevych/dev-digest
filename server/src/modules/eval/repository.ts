import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../../db/client.js';
import * as t from '../../db/schema.js';
import type { EvalCaseOutcome, EvalOwnerKind, EvalRunStatus } from '@devdigest/shared';

/**
 * T8 — Eval data-access. Pure Drizzle over the four eval tables
 * (`eval_cases`, `eval_runs`, `eval_case_results`, `eval_drafts`). No HTTP,
 * no LLM, no business rules — those belong to `service.ts` / `run-executor.ts`.
 *
 * HARD RULE, every single method: `workspaceId` is the first argument and
 * every read/update/delete filters by it. A row belonging to another
 * workspace must be indistinguishable from a missing one — this is the
 * multi-tenancy boundary (AC-39).
 *
 * Row types are the Drizzle-inferred shapes (`typeof <table>.$inferSelect`),
 * defined locally rather than in `db/rows.ts` (this task's file scope is
 * `repository.ts` only). Callers (service, run-executor) import them from
 * here; the service layer is what maps them onto the `@devdigest/shared`
 * (snake_case) DTOs.
 */

export type EvalCaseRow = typeof t.evalCases.$inferSelect;
export type EvalRunRow = typeof t.evalRuns.$inferSelect;
export type EvalCaseResultRow = typeof t.evalCaseResults.$inferSelect;
export type EvalDraftRow = typeof t.evalDrafts.$inferSelect;

/** A run row plus whether its case set has since drifted (AC-44/AC-45). */
export type EvalRunRowWithDrift = EvalRunRow & { setDrifted: boolean };

export interface InsertEvalCaseValues {
  ownerKind: EvalOwnerKind;
  ownerId: string;
  name: string;
  expectation: 'must_find' | 'must_not_flag';
  inputDiff: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  notes?: string | null;
  /** Set only at seed time (`from-finding`); absent for a hand-written case. */
  sourceFindingId?: string | null;
  /** The frozen snapshot — the data path for AC-4's original rationale + AC-17's chip. */
  sourceFinding?: unknown;
  /** Only populated when `expectation === 'must_not_flag'`. */
  forbiddenRegion?: unknown;
  inputFingerprint: string;
}

export interface UpdateEvalCaseValues {
  name?: string;
  expectation?: 'must_find' | 'must_not_flag';
  inputDiff?: string;
  inputFiles?: unknown;
  inputMeta?: unknown;
  expectedOutput?: unknown;
  /** The user's OWN recorded reason (AC-4) — never the frozen `sourceFinding.rationale`. */
  notes?: string | null;
  forbiddenRegion?: unknown;
  /** Recomputed by the service on every edit (AC-14). */
  inputFingerprint?: string;
}

export interface InsertEvalRunValues {
  agentId: string;
  /** Display label only — never a comparability key (AC-10, AC-51). */
  agentVersion: number | null;
  /** The effective config pinned BY VALUE at run start (AC-10). */
  effectiveConfig: unknown;
  casesTotal: number;
}

export interface CompleteEvalRunValues {
  status: Exclude<EvalRunStatus, 'running'>;
  finishedAt?: Date;
  erroredCount?: number;
  tracesPassed?: number | null;
  tracesTotal?: number | null;
  /** All three nullable — an all-errored run reports NULL, never zeros (AC-37). */
  recall?: number | null;
  precision?: number | null;
  citationAccuracy?: number | null;
  durationMs?: number | null;
  costUsd?: number | null;
  error?: string | null;
}

export interface InsertEvalCaseResultValues {
  caseId: string | null;
  caseName: string;
  inputFingerprint: string;
  outcome: EvalCaseOutcome;
  error?: string | null;
  expectedCount?: number | null;
  matchedCount?: number | null;
  emittedCount?: number | null;
  keptCount?: number | null;
  findings?: unknown;
  unmatchedFindings?: unknown;
  durationMs?: number | null;
  costUsd?: number | null;
}

export interface InsertEvalDraftValues {
  agentId: string;
  caseId: string;
  effectiveConfig?: unknown;
}

export interface CompleteEvalDraftValues {
  status: Exclude<EvalRunStatus, 'running'>;
  inputFingerprint?: string | null;
  outcome?: EvalCaseOutcome | null;
  error?: string | null;
  expectedCount?: number | null;
  matchedCount?: number | null;
  emittedCount?: number | null;
  keptCount?: number | null;
  findings?: unknown;
  durationMs?: number | null;
  costUsd?: number | null;
}

export class EvalRepository {
  constructor(private db: Db) {}

  // ==========================================================================
  // eval_cases — CRUD
  // ==========================================================================

  /** Cases for one owner (agent — a `skill` owner is rejected by the route, AC-40). */
  async listCasesForOwner(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCaseRow[]> {
    return this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, ownerKind),
          eq(t.evalCases.ownerId, ownerId),
        ),
      );
  }

  /**
   * A single case, always carrying its frozen `source_finding` snapshot —
   * every case read returns it as-is (it's a plain column on the row), which
   * is the data path for AC-4's original rationale and AC-17's provenance
   * chip. `notes` (the user's own recorded reason) is a separate column on
   * the same row — never conflate the two.
   */
  async getCase(workspaceId: string, caseId: string): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)));
    return row;
  }

  /** Dedupe check for seed-from-finding (AC-8) — `source_finding_id` is UNIQUE in the DB. */
  async findBySourceFinding(
    workspaceId: string,
    sourceFindingId: string,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.sourceFindingId, sourceFindingId),
        ),
      );
    return row;
  }

  async insertCase(workspaceId: string, values: InsertEvalCaseValues): Promise<EvalCaseRow> {
    const [row] = await this.db
      .insert(t.evalCases)
      .values({
        workspaceId,
        ownerKind: values.ownerKind,
        ownerId: values.ownerId,
        name: values.name,
        expectation: values.expectation,
        inputDiff: values.inputDiff,
        inputFiles: (values.inputFiles as object | undefined) ?? null,
        inputMeta: (values.inputMeta as object | undefined) ?? null,
        expectedOutput: (values.expectedOutput as object | undefined) ?? [],
        notes: values.notes ?? null,
        sourceFindingId: values.sourceFindingId ?? null,
        sourceFinding: (values.sourceFinding as object | undefined) ?? null,
        forbiddenRegion: (values.forbiddenRegion as object | undefined) ?? null,
        inputFingerprint: values.inputFingerprint,
      })
      .returning();
    return row!;
  }

  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateEvalCaseValues,
  ): Promise<EvalCaseRow | undefined> {
    const [row] = await this.db
      .update(t.evalCases)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.expectation !== undefined ? { expectation: patch.expectation } : {}),
        ...(patch.inputDiff !== undefined ? { inputDiff: patch.inputDiff } : {}),
        ...(patch.inputFiles !== undefined
          ? { inputFiles: patch.inputFiles as object | null }
          : {}),
        ...(patch.inputMeta !== undefined ? { inputMeta: patch.inputMeta as object | null } : {}),
        ...(patch.expectedOutput !== undefined
          ? { expectedOutput: patch.expectedOutput as object }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.forbiddenRegion !== undefined
          ? { forbiddenRegion: patch.forbiddenRegion as object | null }
          : {}),
        ...(patch.inputFingerprint !== undefined
          ? { inputFingerprint: patch.inputFingerprint }
          : {}),
      })
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning();
    return row;
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    const rows = await this.db
      .delete(t.evalCases)
      .where(and(eq(t.evalCases.workspaceId, workspaceId), eq(t.evalCases.id, caseId)))
      .returning({ id: t.evalCases.id });
    return rows.length > 0;
  }

  // NOTE: there is deliberately NO `deleteByOwner` here. `eval_cases.owner_id`
  // is polymorphic (`owner_kind` is 'skill' | 'agent') and therefore FK-less, so
  // Postgres cannot cascade an agent delete to its cases (AC-53) — the cascade
  // is inlined in `AgentsRepository.deleteById` instead. That looks like the
  // wrong home until you try the alternative: having `agents` call into
  // `EvalRepository` would create an `eval → agents → eval` module cycle, since
  // the eval service already depends on the agents repository. Do not "fix" this
  // by adding a method here and wiring it from `agents` — that IS the cycle.

  // ==========================================================================
  // eval_runs — the batch entity (AC-9)
  // ==========================================================================

  async createRun(workspaceId: string, values: InsertEvalRunValues): Promise<EvalRunRow> {
    const [row] = await this.db
      .insert(t.evalRuns)
      .values({
        workspaceId,
        agentId: values.agentId,
        agentVersion: values.agentVersion,
        effectiveConfig: values.effectiveConfig as object,
        status: 'running',
        casesTotal: values.casesTotal,
        casesDone: 0,
        erroredCount: 0,
      })
      .returning();
    return row!;
  }

  async getRun(workspaceId: string, runId: string): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.id, runId)));
    return row;
  }

  /**
   * Persisted "k of N" progress (AC-11/AC-12) — bumping this on the run row
   * (rather than an in-memory counter) is what survives a page reload.
   */
  async incrementCasesDone(workspaceId: string, runId: string, by = 1): Promise<void> {
    await this.db
      .update(t.evalRuns)
      .set({ casesDone: sql`${t.evalRuns.casesDone} + ${by}` })
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.id, runId)));
  }

  async completeRun(
    workspaceId: string,
    runId: string,
    values: CompleteEvalRunValues,
  ): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .update(t.evalRuns)
      .set({
        status: values.status,
        finishedAt: values.finishedAt ?? new Date(),
        ...(values.erroredCount !== undefined ? { erroredCount: values.erroredCount } : {}),
        tracesPassed: values.tracesPassed ?? null,
        tracesTotal: values.tracesTotal ?? null,
        recall: values.recall ?? null,
        precision: values.precision ?? null,
        citationAccuracy: values.citationAccuracy ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
        error: values.error ?? null,
      })
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.id, runId)))
      .returning();
    return row;
  }

  /** Marks a still-running run cancelled (no-op / returns undefined otherwise) — AC-12. */
  async cancelRun(workspaceId: string, runId: string): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .update(t.evalRuns)
      .set({ status: 'cancelled', finishedAt: new Date() })
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.id, runId),
          eq(t.evalRuns.status, 'running'),
        ),
      )
      .returning();
    return row;
  }

  /** The in-flight run for an agent, if any — the ≤1-in-flight-run guard (AC-13). */
  async inFlightRunForAgent(workspaceId: string, agentId: string): Promise<EvalRunRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalRuns)
      .where(
        and(
          eq(t.evalRuns.workspaceId, workspaceId),
          eq(t.evalRuns.agentId, agentId),
          eq(t.evalRuns.status, 'running'),
        ),
      );
    return row;
  }

  /** Run history for one agent, newest first, each flagged `setDrifted` (AC-44/AC-45). */
  async listRunsForAgent(workspaceId: string, agentId: string): Promise<EvalRunRowWithDrift[]> {
    const runs = await this.db
      .select()
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.agentId, agentId)))
      .orderBy(desc(t.evalRuns.startedAt));
    return this.attachDrift(workspaceId, runs);
  }

  /** The workspace-wide recent-runs table spanning every agent (AC-29), each flagged `setDrifted`. */
  async listRecentRuns(workspaceId: string, limit = 50): Promise<EvalRunRowWithDrift[]> {
    const runs = await this.db
      .select()
      .from(t.evalRuns)
      .where(eq(t.evalRuns.workspaceId, workspaceId))
      .orderBy(desc(t.evalRuns.startedAt))
      .limit(limit);
    return this.attachDrift(workspaceId, runs);
  }

  /**
   * Flags each run with whether its case set has since drifted from the
   * owner's CURRENT live set (AC-44): a case in the run was edited (its
   * current fingerprint no longer matches what the run measured), deleted
   * (its `eval_case_results.case_id` was nulled by the FK's `ON DELETE SET
   * NULL`), or the owner's live case count no longer equals what the run
   * measured (added/removed). Every run is returned — none are hidden
   * (AC-45); a run's own reported case count and metrics are never mutated
   * by drift, only this flag is attached.
   */
  private async attachDrift(
    workspaceId: string,
    runs: EvalRunRow[],
  ): Promise<EvalRunRowWithDrift[]> {
    if (runs.length === 0) return [];

    const agentIds = [...new Set(runs.map((r) => r.agentId))];
    const liveCases = await this.db
      .select({
        ownerId: t.evalCases.ownerId,
        id: t.evalCases.id,
        fingerprint: t.evalCases.inputFingerprint,
      })
      .from(t.evalCases)
      .where(
        and(
          eq(t.evalCases.workspaceId, workspaceId),
          eq(t.evalCases.ownerKind, 'agent'),
          inArray(t.evalCases.ownerId, agentIds),
        ),
      );
    // agentId -> (caseId -> current fingerprint)
    const liveByAgent = new Map<string, Map<string, string>>();
    for (const c of liveCases) {
      const m = liveByAgent.get(c.ownerId) ?? new Map<string, string>();
      m.set(c.id, c.fingerprint);
      liveByAgent.set(c.ownerId, m);
    }

    const results = await this.db
      .select({
        runId: t.evalCaseResults.runId,
        caseId: t.evalCaseResults.caseId,
        fingerprint: t.evalCaseResults.inputFingerprint,
      })
      .from(t.evalCaseResults)
      .where(
        inArray(
          t.evalCaseResults.runId,
          runs.map((r) => r.id),
        ),
      );
    const resultsByRun = new Map<string, { caseId: string | null; fingerprint: string }[]>();
    for (const r of results) {
      const list = resultsByRun.get(r.runId) ?? [];
      list.push({ caseId: r.caseId, fingerprint: r.fingerprint });
      resultsByRun.set(r.runId, list);
    }

    return runs.map((run) => {
      const live = liveByAgent.get(run.agentId) ?? new Map<string, string>();
      const ran = resultsByRun.get(run.id) ?? [];
      // A nulled `case_id` means that specific case was hard-deleted since
      // this run — a drift signal even when the live count happens to
      // coincide (the deleted case is absent from BOTH sides).
      const anyDeleted = ran.some((r) => r.caseId === null);
      const anyEdited = ran.some(
        (r) => r.caseId !== null && live.get(r.caseId) !== r.fingerprint,
      );
      const countDiverged = live.size !== run.casesTotal;
      return { ...run, setDrifted: anyDeleted || anyEdited || countDiverged };
    });
  }

  // ==========================================================================
  // eval_case_results — per-case rows of a batch run
  // ==========================================================================

  async insertCaseResult(
    workspaceId: string,
    runId: string,
    values: InsertEvalCaseResultValues,
  ): Promise<EvalCaseResultRow> {
    // Verify the run belongs to this workspace before writing under it — a
    // result never attaches to another workspace's run (AC-39). The table
    // itself carries no `workspace_id` column (it inherits scope from its
    // parent run), so this existence check IS the boundary.
    const run = await this.getRun(workspaceId, runId);
    // Defense-in-depth on an INTERNAL invariant, not a user-facing rejection:
    // the only caller is the executor, writing under a run the service created
    // moments earlier in this same workspace. If this ever trips, the server is
    // broken — so a 5xx is the honest answer and this stays a plain `Error`.
    // Every USER-facing cross-workspace access is a 404 raised in the service
    // (AC-39); repositories in this codebase do not raise HTTP errors, and this
    // one must not start (8 services import `platform/errors`; no repository does).
    if (!run) throw new Error(`eval run ${runId} not found in workspace ${workspaceId}`);

    const [row] = await this.db
      .insert(t.evalCaseResults)
      .values({
        runId,
        caseId: values.caseId,
        caseName: values.caseName,
        inputFingerprint: values.inputFingerprint,
        outcome: values.outcome,
        error: values.error ?? null,
        expectedCount: values.expectedCount ?? null,
        matchedCount: values.matchedCount ?? null,
        emittedCount: values.emittedCount ?? null,
        keptCount: values.keptCount ?? null,
        findings: (values.findings as object | undefined) ?? null,
        unmatchedFindings: (values.unmatchedFindings as object | undefined) ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
      })
      .returning();
    return row!;
  }

  /** Every per-case result of a run (the `EvalRunDetail.results` source), workspace-scoped via the run. */
  async resultsForRun(workspaceId: string, runId: string): Promise<EvalCaseResultRow[]> {
    const run = await this.getRun(workspaceId, runId);
    if (!run) return [];
    return this.db.select().from(t.evalCaseResults).where(eq(t.evalCaseResults.runId, runId));
  }

  // ==========================================================================
  // eval_drafts — one row PER draft, never one slot per case (AC-47/AC-49)
  // ==========================================================================

  /** Creates a `running` draft row. The partial unique index on `(case_id) WHERE status='running'` is the DB-level ≤1-in-flight-draft-per-case guard (AC-13). */
  async insertDraft(workspaceId: string, values: InsertEvalDraftValues): Promise<EvalDraftRow> {
    const [row] = await this.db
      .insert(t.evalDrafts)
      .values({
        workspaceId,
        agentId: values.agentId,
        caseId: values.caseId,
        status: 'running',
        effectiveConfig: (values.effectiveConfig as object | undefined) ?? null,
      })
      .returning();
    return row!;
  }

  async completeDraft(
    workspaceId: string,
    draftId: string,
    values: CompleteEvalDraftValues,
  ): Promise<EvalDraftRow | undefined> {
    const [row] = await this.db
      .update(t.evalDrafts)
      .set({
        status: values.status,
        inputFingerprint: values.inputFingerprint ?? null,
        outcome: values.outcome ?? null,
        error: values.error ?? null,
        expectedCount: values.expectedCount ?? null,
        matchedCount: values.matchedCount ?? null,
        emittedCount: values.emittedCount ?? null,
        keptCount: values.keptCount ?? null,
        findings: (values.findings as object | undefined) ?? null,
        durationMs: values.durationMs ?? null,
        costUsd: values.costUsd ?? null,
      })
      .where(and(eq(t.evalDrafts.workspaceId, workspaceId), eq(t.evalDrafts.id, draftId)))
      .returning();
    return row;
  }

  /**
   * The case's "latest scratch result" (AC-48) = the newest draft ROW, not a
   * single slot — draft spend needs `SUM(cost_usd)` across every draft
   * (AC-49), which a single overwritten slot could never reconstruct.
   */
  async latestDraftForCase(workspaceId: string, caseId: string): Promise<EvalDraftRow | undefined> {
    const [row] = await this.db
      .select()
      .from(t.evalDrafts)
      .where(and(eq(t.evalDrafts.workspaceId, workspaceId), eq(t.evalDrafts.caseId, caseId)))
      .orderBy(desc(t.evalDrafts.ranAt))
      .limit(1);
    return row;
  }

  /** ≤1-in-flight-draft-per-case guard, read side (AC-13). */
  async hasRunningDraft(workspaceId: string, caseId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: t.evalDrafts.id })
      .from(t.evalDrafts)
      .where(
        and(
          eq(t.evalDrafts.workspaceId, workspaceId),
          eq(t.evalDrafts.caseId, caseId),
          eq(t.evalDrafts.status, 'running'),
        ),
      )
      .limit(1);
    return row !== undefined;
  }

  // ==========================================================================
  // Spend (AC-49)
  // ==========================================================================

  /**
   * An agent's eval spend, decomposed into two figures that reconcile by
   * construction: `runUsd` sums `eval_runs.cost_usd`, `draftUsd` sums
   * `eval_drafts.cost_usd`. Never blended into one total here — a single
   * number would never tie out against the run-history cost column, and
   * that discrepancy would read as a bug (AC-49).
   */
  async spendForAgent(
    workspaceId: string,
    agentId: string,
  ): Promise<{ runUsd: number; draftUsd: number }> {
    const [runRow] = await this.db
      .select({ total: sql<number>`coalesce(sum(${t.evalRuns.costUsd}), 0)` })
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, workspaceId), eq(t.evalRuns.agentId, agentId)));
    const [draftRow] = await this.db
      .select({ total: sql<number>`coalesce(sum(${t.evalDrafts.costUsd}), 0)` })
      .from(t.evalDrafts)
      .where(and(eq(t.evalDrafts.workspaceId, workspaceId), eq(t.evalDrafts.agentId, agentId)));
    return { runUsd: Number(runRow?.total ?? 0), draftUsd: Number(draftRow?.total ?? 0) };
  }
}
