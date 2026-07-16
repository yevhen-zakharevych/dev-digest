import type {
  EvalAgentEvalSummary,
  EvalCase,
  EvalCaseInput,
  EvalCaseResult,
  EvalComparison,
  EvalDashboard,
  EvalDraftResult,
  EvalOwnerKind,
  EvalPromoteResult,
  EvalRunAllPreview,
  EvalRunDetail,
  EvalRunSummary,
  EvalTrendPoint,
  EvalWorkspaceDashboard,
  Finding,
  FindingCategory,
  FindingKind,
  Severity,
} from '@devdigest/shared';
import {
  EvalEffectiveConfig,
  EvalExpectedItem,
  EvalForbiddenRegion,
  type EvalExpectation,
  type EvalSourceFinding,
} from '@devdigest/shared';
import type { AgentRow } from '../../db/rows.js';
import type { Container } from '../../platform/container.js';
import { AppError, BadRequestError, NotFoundError, ValidationError } from '../../platform/errors.js';
import { resolveEffectiveConfig } from '../agents/effective-config.js';
import type { AgentsRepository } from '../agents/repository.js';
import { loadDiff } from '../reviews/diff-loader.js';
import type { ReviewRepository } from '../reviews/repository.js';
import { compareRuns } from './compare.js';
import { validateFreeze } from './diff-freeze.js';
import { canonicalStringify, computeFingerprint } from './fingerprint.js';
import {
  EvalRepository,
  type EvalCaseResultRow,
  type EvalCaseRow,
  type EvalDraftRow,
  type EvalRunRow,
  type EvalRunRowWithDrift,
} from './repository.js';
import { EvalRunExecutor, type Logger } from './run-executor.js';

/**
 * T11 — the eval APPLICATION layer. Orchestrates the pieces that already
 * exist and owns exactly one thing of its own: the RULES.
 *
 *   seed-from-finding  → decision defines the expectation (AC-2/3), freeze the
 *                        finding + the diff (AC-4/6), reject an unsatisfiable
 *                        freeze (AC-7), one case per finding (AC-8)
 *   case CRUD          → validate, re-validate the freeze and RE-COMPUTE the
 *                        fingerprint on every write (AC-5/7/14)
 *   run                → pin the effective config BY VALUE at start (AC-10),
 *                        fire-and-forget the executor (AC-11), guard in-flight
 *                        (AC-13)
 *   draft              → a single case, never a run (AC-47..50)
 *   dashboards         → derived from the latest eval RUN, never a draft (AC-46)
 *   compare / promote  → delegate to compare.ts / AgentsRepository.promoteConfig
 *
 * Layering (onion): this file talks to `EvalRepository`, `AgentsRepository`,
 * `ReviewRepository` and the pure modules. It knows nothing about HTTP — every
 * refusal is an `AppError` carrying its own status code, which the route layer
 * renders. NOTHING here is a 5xx: every named failure (no decision, duplicate
 * case, unsatisfiable diff, run in flight, no snapshot to promote, skill owner)
 * is a handled 4xx with a reason.
 *
 * WORKSPACE SCOPING (AC-39): `workspaceId` is the first argument of every public
 * method and is threaded into every repository call. A row in another workspace
 * is indistinguishable from a missing one — a 404, never another workspace's data.
 */

/** The user-editable half of a case — what a create/update actually writes. */
interface CaseWriteValues {
  name: string;
  expectation: EvalExpectation;
  inputDiff: string;
  inputFiles: unknown;
  inputMeta: unknown;
  expectedOutput: EvalExpectedItem[];
  forbiddenRegion: EvalForbiddenRegion | null;
  /** The USER's recorded reason (AC-4) — never the frozen `source_finding.rationale`. */
  notes: string | null;
}

export type UpdateCaseInput = Partial<
  Pick<EvalCaseInput, 'name' | 'expectation' | 'input_diff' | 'input_files' | 'input_meta' | 'expected_output' | 'forbidden_region' | 'notes'>
>;

export interface PromoteOptions {
  /** AC-28 — the user has seen the named regression and still wants it live. */
  acknowledgeRegression?: boolean;
  /** The run to measure the promoted one against. Defaults to the agent's previous completed run. */
  compareToRunId?: string;
}

/** A metric that moved the wrong way when promoting (AC-28). */
export interface EvalRegression {
  metric: 'recall' | 'precision' | 'citation_accuracy';
  delta: number;
}

/** Deltas below this are float noise, not movement. */
const EPSILON = 1e-9;

const METRIC_LABELS: Record<EvalRegression['metric'], string> = {
  recall: 'recall',
  precision: 'precision',
  citation_accuracy: 'citation accuracy',
};

export class EvalService {
  private repo: EvalRepository;
  private reviews: ReviewRepository;
  private agents: AgentsRepository;
  private executor: EvalRunExecutor;

  constructor(private container: Container) {
    this.repo = new EvalRepository(container.db);
    this.reviews = container.reviewRepo;
    this.agents = container.agentsRepo;
    this.executor = new EvalRunExecutor(container, this.repo);
  }

  // ===========================================================================
  // Cases — CRUD
  // ===========================================================================

  /** Every case of one owner. A DISABLED agent's cases list fine — read-only is a UI state, not an error (AC-53). */
  async listCases(
    workspaceId: string,
    ownerKind: EvalOwnerKind,
    ownerId: string,
  ): Promise<EvalCase[]> {
    this.assertAgentOwner(ownerKind);
    const agent = await this.requireAgent(workspaceId, ownerId);
    const rows = await this.repo.listCasesForOwner(workspaceId, 'agent', ownerId);
    const liveConfig = (await this.resolveConfig(agent)).config;
    return Promise.all(rows.map((row) => this.toCaseDto(workspaceId, row, liveConfig)));
  }

  async getCase(workspaceId: string, caseId: string): Promise<EvalCase> {
    const row = await this.requireCase(workspaceId, caseId);
    const liveConfig = await this.liveConfigForCase(workspaceId, row);
    return this.toCaseDto(workspaceId, row, liveConfig);
  }

  /**
   * Hand-written case. The full save rules apply (AC-4/AC-5/AC-7/AC-14) —
   * including the recorded reason, which a seeded case is allowed to fill in
   * later in the editor but a deliberate save is not (see `seedFromFinding`).
   */
  async createCase(workspaceId: string, input: EvalCaseInput): Promise<EvalCase> {
    this.assertAgentOwner(input.owner_kind);
    const agent = await this.requireAgent(workspaceId, input.owner_id);

    const values: CaseWriteValues = {
      name: input.name,
      expectation: input.expectation,
      inputDiff: input.input_diff,
      inputFiles: input.input_files ?? null,
      inputMeta: input.input_meta ?? null,
      expectedOutput: input.expected_output ?? [],
      forbiddenRegion: input.forbidden_region ?? null,
      notes: input.notes ?? null,
    };
    this.validateCase(values, { requireReason: true });

    const row = await this.repo.insertCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: input.owner_id,
      name: values.name,
      expectation: values.expectation,
      inputDiff: values.inputDiff,
      inputFiles: values.inputFiles,
      inputMeta: values.inputMeta,
      expectedOutput: values.expectedOutput,
      notes: values.notes,
      sourceFindingId: input.source_finding_id ?? null,
      forbiddenRegion: values.forbiddenRegion,
      inputFingerprint: fingerprintOf(values),
    });
    return this.toCaseDto(workspaceId, row, (await this.resolveConfig(agent)).config);
  }

  /**
   * Edit a case. The merged case is re-validated in full and its fingerprint is
   * RECOMPUTED (AC-14) — the fingerprint is the join key that decides whether
   * two runs are comparable at all, so a stale one would silently make an edited
   * case look comparable when it is not. The freeze is re-checked on every write
   * (AC-7), not only when the diff field is the one that moved: editing the
   * expected LINES can make a still-valid diff unable to satisfy them.
   */
  async updateCase(
    workspaceId: string,
    caseId: string,
    patch: UpdateCaseInput,
  ): Promise<EvalCase> {
    const existing = await this.requireCase(workspaceId, caseId);
    this.assertAgentOwner(existing.ownerKind);

    const merged: CaseWriteValues = {
      name: patch.name ?? existing.name,
      expectation: patch.expectation ?? existing.expectation,
      inputDiff: patch.input_diff ?? existing.inputDiff,
      inputFiles: patch.input_files !== undefined ? patch.input_files : existing.inputFiles,
      inputMeta: patch.input_meta !== undefined ? patch.input_meta : existing.inputMeta,
      expectedOutput:
        patch.expected_output ?? parseExpectedItems(existing.expectedOutput),
      forbiddenRegion:
        patch.forbidden_region !== undefined
          ? (patch.forbidden_region ?? null)
          : parseForbiddenRegion(existing.forbiddenRegion),
      notes: patch.notes !== undefined ? (patch.notes ?? null) : existing.notes,
    };
    this.validateCase(merged, { requireReason: true });

    const row = await this.repo.updateCase(workspaceId, caseId, {
      name: merged.name,
      expectation: merged.expectation,
      inputDiff: merged.inputDiff,
      inputFiles: merged.inputFiles,
      inputMeta: merged.inputMeta,
      expectedOutput: merged.expectedOutput,
      notes: merged.notes,
      forbiddenRegion: merged.forbiddenRegion,
      inputFingerprint: fingerprintOf(merged),
    });
    if (!row) throw new NotFoundError('Eval case not found');
    return this.toCaseDto(workspaceId, row, await this.liveConfigForCase(workspaceId, row));
  }

  async deleteCase(workspaceId: string, caseId: string): Promise<boolean> {
    return this.repo.deleteCase(workspaceId, caseId);
  }

  // ===========================================================================
  // Seed from finding — the feature's front door (AC-1..AC-8)
  // ===========================================================================

  /**
   * Turn a DECIDED finding into an eval case.
   *
   * The decision is what DEFINES the expectation, so:
   *   - neither accepted nor dismissed  ⇒ REJECT, naming the reason (AC-2).
   *     There is nothing to derive; this is a 400, never a 5xx.
   *   - accepted  ⇒ `must_find`, that finding as the single expected item (AC-3)
   *   - dismissed ⇒ `must_not_flag`, EMPTY expected output, that finding as the
   *                 forbidden region (AC-3)
   * The user is NEVER asked to choose.
   *
   * The case freezes a `source_finding` snapshot (title, rationale, severity,
   * category, kind, file, lines) so AC-4's *original rationale* and AC-17's
   * provenance chip have a data path that survives the finding being edited or
   * deleted (`source_finding_id` is `ON DELETE SET NULL`).
   *
   * `notes` — the USER's recorded reason (a DIFFERENT field from the frozen
   * `source_finding.rationale`, which is the agent's own text) — is deliberately
   * NOT required here: seeding creates the case and drops the user in the editor,
   * where AC-4's "a recorded reason is required to save" is enforced by
   * `updateCase`. Requiring it at seed time would make AC-3's observable
   * ("seeding from a dismissed finding yields a must_not_flag case") impossible.
   */
  async seedFromFinding(
    workspaceId: string,
    findingId: string,
  ): Promise<{ case: EvalCase; created: boolean }> {
    const ctx = await this.reviews.findingContext(findingId);
    // AC-39 — a finding in another workspace is indistinguishable from a
    // missing one. `findingContext` is not workspace-scoped, so this IS the
    // boundary check.
    if (!ctx || ctx.pull.workspaceId !== workspaceId) throw new NotFoundError('Finding not found');
    const { finding, review, pull } = ctx;

    // AC-8 — one case per source finding. The DB also enforces it (UNIQUE on
    // `source_finding_id`); this read is what turns the second invocation into
    // "here is the case you already have" instead of a constraint violation.
    const existing = await this.repo.findBySourceFinding(workspaceId, findingId);
    if (existing) {
      return {
        case: await this.toCaseDto(
          workspaceId,
          existing,
          await this.liveConfigForCase(workspaceId, existing),
        ),
        created: false,
      };
    }

    // AC-2 — the decision is the expectation. No decision, no case.
    const accepted = finding.acceptedAt !== null;
    const dismissed = finding.dismissedAt !== null;
    if (!accepted && !dismissed) {
      throw new AppError(
        'eval_finding_undecided',
        'This finding has been neither accepted nor dismissed. Accept it (⇒ the agent must find it) or dismiss it (⇒ the agent must not flag it) first — the decision is what defines the expectation.',
        400,
        { finding_id: findingId },
      );
    }

    if (!review.agentId) {
      throw new AppError(
        'eval_finding_no_agent',
        'This finding was not produced by an agent, so there is no agent to own the eval case.',
        400,
        { finding_id: findingId },
      );
    }
    const agent = await this.requireAgent(workspaceId, review.agentId);

    const repoRow = await this.reviews.getRepo(pull.repoId);
    if (!repoRow) throw new NotFoundError('Repo not found');
    // AC-6 — capture the diff ONCE, here, and freeze it. From now on the case
    // needs no repo, no clone and no GitHub call to run.
    const diff = await loadDiff(this.container, this.reviews, workspaceId, pull, repoRow);

    const sourceFinding: EvalSourceFinding = {
      finding_id: finding.id,
      title: finding.title,
      // The AGENT's original text (AC-4's "original rationale") — read-only, and
      // NOT the user's recorded reason (`notes`).
      rationale: finding.rationale,
      severity: finding.severity as Severity,
      category: finding.category as FindingCategory,
      kind: finding.kind as FindingKind,
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
    };
    const region = {
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
      kind: finding.kind as FindingKind,
    };

    const values: CaseWriteValues = {
      name: finding.title.slice(0, 120),
      expectation: accepted ? 'must_find' : 'must_not_flag',
      inputDiff: diff.raw,
      inputFiles: null,
      inputMeta: { title: pull.title, body: pull.body ?? '', number: pull.number, author: pull.author },
      // AC-3 — accepted ⇒ this finding is the expected item; dismissed ⇒ the
      // expected output is EMPTY and the finding becomes the forbidden region.
      expectedOutput: accepted
        ? [
            {
              ...region,
              severity: sourceFinding.severity,
              category: sourceFinding.category,
              title: sourceFinding.title,
            },
          ]
        : [],
      forbiddenRegion: accepted ? null : region,
      notes: null,
    };
    // AC-7 — the freeze must be able to satisfy the expectation, or NO case is
    // persisted. This is the whole reason the validator exists: the grounding
    // gate silently drops a finding whose lines miss a hunk (`server/INSIGHTS.md:50`),
    // so a case seeded off a patch-less file would be unsatisfiable BY
    // CONSTRUCTION and would read as a permanent recall regression against a
    // correct agent. `requireReason: false` — see the method doc.
    this.validateCase(values, { requireReason: false });

    const row = await this.repo.insertCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: agent.id,
      name: values.name,
      expectation: values.expectation,
      inputDiff: values.inputDiff,
      inputFiles: values.inputFiles,
      inputMeta: values.inputMeta,
      expectedOutput: values.expectedOutput,
      notes: values.notes,
      sourceFindingId: finding.id,
      sourceFinding,
      forbiddenRegion: values.forbiddenRegion,
      inputFingerprint: fingerprintOf(values),
    });

    return {
      case: await this.toCaseDto(workspaceId, row, (await this.resolveConfig(agent)).config),
      created: true,
    };
  }

  // ===========================================================================
  // Runs (AC-9..AC-14, AC-34, AC-44)
  // ===========================================================================

  /** What a run is about to spend: one model call per case (AC-34). */
  async runPreview(workspaceId: string, agentId: string): Promise<{ cases_total: number }> {
    await this.requireAgent(workspaceId, agentId);
    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    return { cases_total: cases.length };
  }

  /**
   * Start a batch run over the agent's WHOLE case set as it stands right now
   * (AC-44) and return IMMEDIATELY with a run id in a non-terminal status
   * (AC-11) — the executor is fire-and-forget, mirroring `reviews/service.ts:140`.
   * There is no job queue in this codebase and none is added here.
   *
   * The effective config is resolved AT THIS MOMENT and pinned BY VALUE on the
   * run row (AC-10). Never a version pointer: `setSkills` bumps no version and
   * writes no snapshot, so `(agent_id, version)` is NOT a behavioural identifier
   * (`server/INSIGHTS.md`, first Codebase Patterns entry). `agent_version` goes
   * on the row as a DISPLAY LABEL only.
   */
  async startRun(workspaceId: string, agentId: string, logger?: Logger): Promise<EvalRunDetail> {
    const agent = await this.requireAgent(workspaceId, agentId);
    this.assertRunnable(agent);
    await this.assertNoRunInFlight(workspaceId, agentId);

    const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agentId);
    if (cases.length === 0) {
      throw new AppError(
        'eval_no_cases',
        'This agent has no eval cases — there is nothing to run.',
        400,
        { agent_id: agentId },
      );
    }

    const { config, skillBodies } = await this.resolveConfig(agent);
    const run = await this.repo.createRun(workspaceId, {
      agentId,
      agentVersion: agent.version,
      effectiveConfig: config,
      casesTotal: cases.length,
    });

    // AC-11 — NEVER awaited. The HTTP response returns now with the run id in
    // `running`; the client polls `getRun` for "k of N".
    void this.executor
      .executeRun({ workspaceId, runId: run.id, config, skillBodies, cases, logger })
      .catch((err: unknown) => {
        logger?.error({ runId: run.id, err: (err as Error).message }, 'eval: run crashed');
      });

    return { ...this.toRunSummary({ ...run, setDrifted: false }), effective_config: config, results: [] };
  }

  /** Run history for one agent, newest first — drafts are NOT here (AC-47). */
  async listRuns(workspaceId: string, agentId: string): Promise<EvalRunSummary[]> {
    await this.requireAgent(workspaceId, agentId);
    const rows = await this.repo.listRunsForAgent(workspaceId, agentId);
    return rows.map((row) => this.toRunSummary(row));
  }

  /** One run + its pinned config + every per-case result — the AC-12 poll target. */
  async getRun(workspaceId: string, runId: string): Promise<EvalRunDetail> {
    const run = await this.requireRun(workspaceId, runId);
    return this.toRunDetail(workspaceId, run);
  }

  /**
   * Cancel an in-flight run (AC-12). Signals the live runner (which checks the
   * flag between cases AND before each model call, so a cancel aborts a call in
   * flight rather than paying for it) and marks the row cancelled — so cancel
   * also works for an ORPHANED run whose process died on a restart.
   *
   * Deliberately does NOT call `runBus.complete()`: `complete()` DELETES the
   * cancelled flag (`platform/sse.ts:76-83`), which would race the running
   * executor and silently un-cancel it. The executor calls `complete()` itself
   * in its own `finally`.
   */
  async cancelRun(workspaceId: string, runId: string): Promise<EvalRunSummary> {
    const run = await this.requireRun(workspaceId, runId);
    this.container.runBus.cancel(runId);
    const cancelled = await this.repo.cancelRun(workspaceId, runId);
    const row = cancelled ?? run;
    return this.toRunSummary({ ...row, setDrifted: false });
  }

  // ===========================================================================
  // Drafts — a single case, and NOT a run (AC-47..AC-50)
  // ===========================================================================

  /**
   * Run ONE case as a draft. A draft never enters the run history, the trend, or
   * any comparison (AC-47); it is persisted as its own `eval_drafts` row with its
   * OWN config snapshot, so staleness is derivable (AC-48); and its cost is
   * charged to the agent's DRAFT spend as a distinct component (AC-49) — a
   * blended total would never tie out against the run-history cost column, and
   * that discrepancy reads as a bug.
   */
  async startDraft(workspaceId: string, caseId: string, logger?: Logger): Promise<EvalDraftResult> {
    const row = await this.requireCase(workspaceId, caseId);
    this.assertAgentOwner(row.ownerKind);
    const agent = await this.requireAgent(workspaceId, row.ownerId);
    this.assertRunnable(agent);

    // AC-13 — no draft while the agent's RUN is in flight: that run has already
    // snapshotted a config, and a draft started now would race it.
    await this.assertNoRunInFlight(workspaceId, agent.id);
    if (await this.repo.hasRunningDraft(workspaceId, caseId)) {
      throw new AppError(
        'eval_draft_in_flight',
        'A draft is already running for this case. Wait for it to finish.',
        409,
        { case_id: caseId },
      );
    }

    const { config, skillBodies } = await this.resolveConfig(agent);
    let draft: EvalDraftRow;
    try {
      draft = await this.repo.insertDraft(workspaceId, {
        agentId: agent.id,
        caseId,
        effectiveConfig: config,
      });
    } catch (err) {
      // The partial unique index `(case_id) WHERE status='running'` is the REAL
      // guard — the read above can lose a race. Either way the user sees the
      // same named 409, never a 5xx.
      if (isUniqueViolation(err)) {
        throw new AppError(
          'eval_draft_in_flight',
          'A draft is already running for this case. Wait for it to finish.',
          409,
          { case_id: caseId },
        );
      }
      throw err;
    }

    void this.executor
      .executeDraft({ workspaceId, draftId: draft.id, case: row, config, skillBodies, logger })
      .catch((err: unknown) => {
        logger?.error({ draftId: draft.id, err: (err as Error).message }, 'eval: draft crashed');
      });

    return this.toDraftDto(draft, row, config);
  }

  /** The case's latest scratch result (AC-48) — the newest draft ROW, or null. */
  async getLatestDraft(workspaceId: string, caseId: string): Promise<EvalDraftResult | null> {
    const row = await this.requireCase(workspaceId, caseId);
    const draft = await this.repo.latestDraftForCase(workspaceId, caseId);
    if (!draft) return null;
    return this.toDraftDto(draft, row, await this.liveConfigForCase(workspaceId, row));
  }

  // ===========================================================================
  // Compare + promote (AC-24..AC-28, AC-51, AC-52)
  // ===========================================================================

  /** Compare exactly two runs OF THE SAME AGENT. Pure set math lives in `compare.ts`. */
  async compare(workspaceId: string, runIdA: string, runIdB: string): Promise<EvalComparison> {
    const base = await this.requireRun(workspaceId, runIdA);
    const candidate = await this.requireRun(workspaceId, runIdB);
    if (base.agentId !== candidate.agentId) {
      throw new AppError(
        'eval_compare_cross_agent',
        'A comparison is between two runs of the SAME agent — these two belong to different agents.',
        400,
      );
    }
    return this.compareRows(workspaceId, base, candidate);
  }

  /**
   * Make a run's pinned config the agent's LIVE config (AC-27).
   *
   * The version bump + the skill re-link + the snapshot ordering are ALL owned by
   * `AgentsRepository.promoteConfig` — it is not re-implemented here. This method
   * owns only the two rules that are the application's: refuse a run with no
   * snapshot (AC-52), and refuse a REGRESSION without an explicit acknowledgement
   * (AC-28), naming which metric it is.
   */
  async promote(
    workspaceId: string,
    runId: string,
    opts: PromoteOptions = {},
  ): Promise<EvalPromoteResult> {
    const run = await this.requireRun(workspaceId, runId);

    // AC-52 — nothing to promote without a value pin.
    const parsed = EvalEffectiveConfig.safeParse(run.effectiveConfig);
    if (!parsed.success) {
      throw new AppError(
        'eval_no_config_snapshot',
        'This run carries no usable effective-config snapshot, so there is nothing to promote. (Comparisons against it still render their metric deltas — only the prompt/skill diff is unavailable.)',
        400,
        { run_id: runId },
      );
    }
    const config = parsed.data;

    // AC-28 — "worse on ANY metric of the comparison" is measured against the
    // run this promote would replace: the agent's latest COMPLETED run other
    // than this one (or an explicitly named one).
    const baseline = opts.compareToRunId
      ? await this.requireRun(workspaceId, opts.compareToRunId)
      : await this.previousMeasuredRun(workspaceId, run.agentId, runId);
    if (baseline && baseline.agentId !== run.agentId) {
      throw new AppError(
        'eval_compare_cross_agent',
        'A run can only be measured against another run of the SAME agent.',
        400,
      );
    }

    if (baseline && !opts.acknowledgeRegression) {
      const comparison = await this.compareRows(workspaceId, baseline, run);
      const regressions = regressionsIn(comparison);
      if (comparison.comparable && regressions.length > 0) {
        throw new AppError(
          'eval_promote_regression',
          `Promoting this run is a regression on ${listMetrics(regressions.map((r) => r.metric))}: ${regressions
            .map((r) => `${METRIC_LABELS[r.metric]} ${formatPoints(r.delta)}`)
            .join(', ')} — measured over ${comparison.shared_case_count} shared case(s). Confirm explicitly to promote it anyway.`,
          409,
          { run_id: runId, regressions, comparison },
        );
      }
    }

    const result = await this.agents.promoteConfig(workspaceId, run.agentId, config);
    if (!result) throw new NotFoundError('Agent not found');
    if (!result.ok) {
      // The repository REPORTS that a pinned skill no longer exists; deciding
      // that this is a 400 is the application's call, not the data layer's.
      throw new BadRequestError(
        `Cannot promote: ${result.missingSkills.length} pinned skill(s) no longer exist: ${result.missingSkills
          .map((s) => s.name)
          .join(', ')}`,
        { missing_skill_ids: result.missingSkills.map((s) => s.id) },
      );
    }

    return {
      agent_id: result.agent.id,
      agent_version: result.version,
      effective_config: result.config,
      // REC-3 / A-2 — promote restores skill LINKS, not skill BODIES. A pinned
      // skill whose body has moved on since the run is NAMED, never silently
      // shipped as if the run had measured it.
      skill_version_divergence: result.skillVersionDivergence,
    };
  }

  // ===========================================================================
  // Dashboards (AC-29..AC-33, AC-46, AC-49, AC-50)
  // ===========================================================================

  /**
   * The per-agent dashboard. EVERY headline number here — the metric cards, the
   * authoritative "N / M passing", and the alert — comes from the LATEST EVAL
   * RUN and NEVER moves on a draft (AC-46/AC-50).
   *
   * The passing denominator is THAT RUN's own count, deliberately allowed to be
   * smaller than the current case count: a case the latest run never measured is
   * NOT-YET-MEASURED — neither a pass nor a fail (AC-50).
   *
   * Zero cases, or cases that were never run ⇒ NULL metrics, never 0% (AC-31/32):
   * "we did not measure" and "the agent scored zero" must never look the same.
   */
  async agentDashboard(workspaceId: string, agentId: string): Promise<EvalDashboard> {
    const agent = await this.requireAgent(workspaceId, agentId);
    const [cases, runs, spend] = await Promise.all([
      this.repo.listCasesForOwner(workspaceId, 'agent', agentId),
      this.repo.listRunsForAgent(workspaceId, agentId),
      this.repo.spendForAgent(workspaceId, agentId),
    ]);

    const measured = runs.filter(isMeasuredRun); // newest first; drafts are not runs
    const latest = measured[0];
    const previous = measured[1];

    // ONE comparison feeds both the delta and the alert — they must be the same
    // statement about the same two runs, never two independently-derived ones.
    const comparison =
      latest && previous ? await this.compareRows(workspaceId, previous, latest) : null;
    const alert = comparison ? alertText(comparison) : null;
    const delta = comparison ? deltaOf(comparison) : { recall: 0, precision: 0, citation_accuracy: 0 };

    return {
      owner_kind: 'agent',
      owner_id: agent.id,
      cases_total: cases.length,
      current: {
        recall: latest?.recall ?? null,
        precision: latest?.precision ?? null,
        citation_accuracy: latest?.citationAccuracy ?? null,
        // "N / M passing" — M is the LATEST RUN's scored count, not the live
        // case count (AC-50). Absent a run, both are 0 and every metric is null:
        // the client renders "never run" (AC-32), not "0%".
        traces_passed: latest?.tracesPassed ?? 0,
        traces_total: latest?.tracesTotal ?? 0,
        cost_usd: latest?.costUsd ?? null,
      },
      delta,
      trend: this.toTrend(runs),
      recent_runs: runs.map((row) => this.toRunSummary(row)),
      alert,
      spend: toSpend(spend),
    };
  }

  /** The fleet-wide dashboard: every agent's latest metrics + a cross-agent recent-runs table (AC-29). */
  async workspaceDashboard(workspaceId: string): Promise<EvalWorkspaceDashboard> {
    const agents = await this.agents.list(workspaceId);
    const recentRows = await this.repo.listRecentRuns(workspaceId);

    const summaries: EvalAgentEvalSummary[] = [];
    for (const agent of agents) {
      const [cases, runs, spend] = await Promise.all([
        this.repo.listCasesForOwner(workspaceId, 'agent', agent.id),
        this.repo.listRunsForAgent(workspaceId, agent.id),
        this.repo.spendForAgent(workspaceId, agent.id),
      ]);
      const latest = runs.filter(isMeasuredRun)[0];
      summaries.push({
        agent_id: agent.id,
        agent_name: agent.name,
        agent_version: agent.version,
        cases_total: cases.length,
        recall: latest?.recall ?? null,
        precision: latest?.precision ?? null,
        citation_accuracy: latest?.citationAccuracy ?? null,
        traces_passed: latest?.tracesPassed ?? 0,
        traces_total: latest?.tracesTotal ?? 0,
        spend: toSpend(spend),
      });
    }

    // AC-33 — the alert is about the workspace's most recent measured run, named
    // with its agent, against that agent's previous comparable run.
    let alert: string | null = null;
    const newest = recentRows.filter(isMeasuredRun)[0];
    if (newest) {
      const previous = await this.previousMeasuredRun(workspaceId, newest.agentId, newest.id);
      if (previous) {
        const name = agents.find((a) => a.id === newest.agentId)?.name;
        const moved = alertText(await this.compareRows(workspaceId, previous, newest));
        alert = moved && name ? `${name}: ${moved}` : moved;
      }
    }

    return { agents: summaries, recent_runs: recentRows.map((row) => this.toRunSummary(row)), alert };
  }

  /**
   * What "Run all agents" is about to do (AC-35). This button spends real money —
   * one model call per case — so the totals are named BEFORE it is pressed.
   * Zero-case agents are skipped (there is nothing to measure), as are disabled
   * agents (AC-53) and agents whose run is already in flight (AC-13).
   */
  async runAllPreview(workspaceId: string): Promise<EvalRunAllPreview> {
    const agents = await this.runnableAgents(workspaceId);
    return {
      agents_total: agents.length,
      cases_total: agents.reduce((sum, a) => sum + a.cases_total, 0),
      agents: agents.map((a) => ({
        agent_id: a.agent.id,
        agent_name: a.agent.name,
        cases_total: a.cases_total,
      })),
    };
  }

  /** Start one run per runnable agent (AC-35). Skipped agents are not an error. */
  async runAll(workspaceId: string, logger?: Logger): Promise<EvalRunSummary[]> {
    const agents = await this.runnableAgents(workspaceId);
    const started: EvalRunSummary[] = [];
    for (const { agent } of agents) {
      const detail = await this.startRun(workspaceId, agent.id, logger);
      const { effective_config: _config, results: _results, ...summary } = detail;
      started.push(summary);
    }
    return started;
  }

  // ===========================================================================
  // Guards
  // ===========================================================================

  /** AC-40 — v1 is agents-only. A `skill` owner is refused by NAME, not ignored. */
  private assertAgentOwner(ownerKind: EvalOwnerKind): asserts ownerKind is 'agent' {
    if (ownerKind !== 'agent') {
      throw new AppError(
        'eval_skill_owner_unsupported',
        "Eval v1 supports an `agent` owner only — `owner_kind: 'skill'` is not supported.",
        400,
        { owner_kind: ownerKind },
      );
    }
  }

  /**
   * AC-53 — a disabled agent's cases are READ-ONLY: no run, no draft. Reads and
   * case edits never error; only the two controls that would spend money and
   * measure a config the user has taken out of service are refused, by name.
   */
  private assertRunnable(agent: AgentRow): void {
    if (!agent.enabled) {
      throw new AppError(
        'eval_agent_disabled',
        `Agent "${agent.name}" is disabled — its eval cases are read-only. Enable it to run them.`,
        409,
        { agent_id: agent.id },
      );
    }
  }

  /** AC-13 — ≤1 in-flight run per agent, and the refusal NAMES the run in flight. */
  private async assertNoRunInFlight(workspaceId: string, agentId: string): Promise<void> {
    const inFlight = await this.repo.inFlightRunForAgent(workspaceId, agentId);
    if (inFlight) {
      throw new AppError(
        'eval_run_in_flight',
        `An eval run for this agent is already in flight (run ${inFlight.id}, started ${inFlight.startedAt.toISOString()}, ${inFlight.casesDone}/${inFlight.casesTotal} cases done). Wait for it to finish or cancel it.`,
        409,
        { run_id: inFlight.id, cases_done: inFlight.casesDone, cases_total: inFlight.casesTotal },
      );
    }
  }

  private async requireAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
    const agent = await this.agents.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  private async requireCase(workspaceId: string, caseId: string): Promise<EvalCaseRow> {
    const row = await this.repo.getCase(workspaceId, caseId);
    if (!row) throw new NotFoundError('Eval case not found');
    return row;
  }

  private async requireRun(workspaceId: string, runId: string): Promise<EvalRunRow> {
    const row = await this.repo.getRun(workspaceId, runId);
    if (!row) throw new NotFoundError('Eval run not found');
    return row;
  }

  /**
   * Full save validation.
   *
   * `requireReason` is the ONE difference between a user's deliberate save and
   * the seed path: AC-4's recorded reason is required to SAVE a `must_not_flag`
   * case, but the seed (AC-3) creates that case for the user before they have
   * written one. See `seedFromFinding`.
   */
  private validateCase(values: CaseWriteValues, opts: { requireReason: boolean }): void {
    if (!values.name.trim()) {
      throw new ValidationError('An eval case needs a name.', { field: 'name' });
    }
    if (!values.inputDiff.trim()) {
      throw new ValidationError(
        'An eval case must freeze a diff — without one there is nothing for the agent to review.',
        { field: 'input_diff' },
      );
    }

    if (values.expectation === 'must_find') {
      // AC-5 — at least one expected item, each with a file AND a line range.
      if (values.expectedOutput.length === 0) {
        throw new ValidationError(
          'A `must_find` case needs at least one expected item — otherwise there is nothing for it to assert.',
          { field: 'expected_output' },
        );
      }
      values.expectedOutput.forEach((item, i) => {
        if (!item.file.trim()) {
          throw new ValidationError(`Expected item ${i + 1} is missing a file.`, {
            field: `expected_output[${i}].file`,
          });
        }
        if (
          !Number.isInteger(item.start_line) ||
          !Number.isInteger(item.end_line) ||
          item.start_line < 1 ||
          item.end_line < item.start_line
        ) {
          throw new ValidationError(
            `Expected item ${i + 1} ("${item.file}") needs a valid line range (start ≥ 1, end ≥ start).`,
            { field: `expected_output[${i}].start_line` },
          );
        }
      });
    } else {
      // AC-4 — the USER's recorded reason. A DIFFERENT field from the frozen
      // `source_finding.rationale` (the agent's own original text): that one is
      // read-only provenance, this one is why the user says it is noise.
      if (opts.requireReason && !values.notes?.trim()) {
        throw new ValidationError(
          'A `must_not_flag` case needs a recorded reason for why this finding is noise. Fill in `notes` — this is your own reason, not the finding\'s original rationale.',
          { field: 'notes' },
        );
      }
      // `compare.ts` infers a result's expectation from "did it freeze any
      // expected item" (an invariant AC-3/AC-5 guarantee). Persisting a
      // `must_not_flag` case WITH expected items would quietly break every later
      // comparison, so it is refused here.
      if (values.expectedOutput.length > 0) {
        throw new ValidationError(
          'A `must_not_flag` case carries no expected items — its expectation is a forbidden region, not something to find.',
          { field: 'expected_output' },
        );
      }
    }

    // AC-7 — re-checked on EVERY write, not only a diff edit: moving the
    // expected LINES can make an unchanged diff unable to cover them. A case
    // whose frozen diff cannot satisfy its own expectation is unsatisfiable by
    // construction and would read as a permanent recall regression against a
    // correct agent (`server/INSIGHTS.md:50`).
    const freeze = validateFreeze(
      values.inputDiff,
      values.expectation,
      values.expectedOutput,
      values.forbiddenRegion,
    );
    if (!freeze.ok) {
      throw new ValidationError(
        `The frozen diff cannot satisfy this case's expectation, so the case was not saved: ${freeze.message}.`,
        freeze.reason === 'file_missing'
          ? { reason: freeze.reason, file: freeze.file }
          : {
              reason: freeze.reason,
              file: freeze.file,
              start_line: freeze.start_line,
              end_line: freeze.end_line,
            },
      );
    }
  }

  // ===========================================================================
  // Derivation helpers
  // ===========================================================================

  private async resolveConfig(agent: AgentRow) {
    const links = await this.agents.linkedSkills(agent.id);
    return resolveEffectiveConfig(agent, links);
  }

  /** The owner agent's CURRENT effective config — the yardstick a draft's staleness is measured against (AC-48). */
  private async liveConfigForCase(
    workspaceId: string,
    row: EvalCaseRow,
  ): Promise<EvalEffectiveConfig | null> {
    if (row.ownerKind !== 'agent') return null;
    const agent = await this.agents.getById(workspaceId, row.ownerId);
    if (!agent) return null;
    return (await this.resolveConfig(agent)).config;
  }

  /** Agents that "Run all" would actually run: ≥1 case, enabled, no run in flight. */
  private async runnableAgents(
    workspaceId: string,
  ): Promise<{ agent: AgentRow; cases_total: number }[]> {
    const agents = await this.agents.list(workspaceId);
    const out: { agent: AgentRow; cases_total: number }[] = [];
    for (const agent of agents) {
      if (!agent.enabled) continue; // AC-53
      const cases = await this.repo.listCasesForOwner(workspaceId, 'agent', agent.id);
      if (cases.length === 0) continue; // AC-35 — nothing to measure
      const inFlight = await this.repo.inFlightRunForAgent(workspaceId, agent.id);
      if (inFlight) continue; // AC-13 — skipped, not an error
      out.push({ agent, cases_total: cases.length });
    }
    return out;
  }

  /** The agent's newest run that actually measured something, excluding `excludeRunId`. */
  private async previousMeasuredRun(
    workspaceId: string,
    agentId: string,
    excludeRunId: string,
  ): Promise<EvalRunRow | undefined> {
    const runs = await this.repo.listRunsForAgent(workspaceId, agentId);
    return runs.filter((r) => r.id !== excludeRunId).find(isMeasuredRun);
  }

  private async compareRows(
    workspaceId: string,
    base: EvalRunRow,
    candidate: EvalRunRow,
  ): Promise<EvalComparison> {
    const [baseDetail, candidateDetail] = await Promise.all([
      this.toRunDetail(workspaceId, base),
      this.toRunDetail(workspaceId, candidate),
    ]);
    const strip = (d: EvalRunDetail): EvalRunSummary => {
      const { effective_config: _c, results: _r, ...summary } = d;
      return summary;
    };
    return compareRuns({
      base: strip(baseDetail),
      candidate: strip(candidateDetail),
      baseConfig: EvalEffectiveConfig.safeParse(base.effectiveConfig).data ?? null,
      candidateConfig: EvalEffectiveConfig.safeParse(candidate.effectiveConfig).data ?? null,
      baseResults: baseDetail.results,
      candidateResults: candidateDetail.results,
    });
  }

  // ===========================================================================
  // Row → DTO
  // ===========================================================================

  private async toCaseDto(
    workspaceId: string,
    row: EvalCaseRow,
    liveConfig: EvalEffectiveConfig | null,
  ): Promise<EvalCase> {
    const draft = await this.repo.latestDraftForCase(workspaceId, row.id);
    return {
      id: row.id,
      owner_kind: row.ownerKind,
      owner_id: row.ownerId,
      name: row.name,
      expectation: row.expectation,
      input_diff: row.inputDiff,
      input_files: row.inputFiles,
      input_meta: row.inputMeta,
      expected_output: parseExpectedItems(row.expectedOutput),
      forbidden_region: parseForbiddenRegion(row.forbiddenRegion),
      source_finding_id: row.sourceFindingId,
      // The FROZEN snapshot — survives the finding being edited or deleted, and
      // is the data path for AC-4's original rationale + AC-17's provenance chip.
      source_finding: (row.sourceFinding as EvalSourceFinding | null) ?? null,
      input_fingerprint: row.inputFingerprint,
      notes: row.notes,
      latest_draft: draft ? this.toDraftDto(draft, row, liveConfig) : null,
    };
  }

  /**
   * A draft is STALE (AC-48) when the config it ran against is no longer the
   * agent's live config, or when the case itself has been edited since (its
   * fingerprint moved) — either way, what it reports is no longer a statement
   * about what the agent would do now.
   */
  private toDraftDto(
    draft: EvalDraftRow,
    row: EvalCaseRow,
    liveConfig: EvalEffectiveConfig | null,
  ): EvalDraftResult {
    const draftConfig = EvalEffectiveConfig.safeParse(draft.effectiveConfig).data ?? null;
    const fingerprint = draft.inputFingerprint ?? row.inputFingerprint;
    const configMoved =
      draftConfig !== null &&
      liveConfig !== null &&
      canonicalStringify(draftConfig) !== canonicalStringify(liveConfig);
    return {
      case_id: row.id,
      ran_at: draft.ranAt.toISOString(),
      status: draft.status,
      effective_config: draftConfig ?? liveConfig ?? EMPTY_CONFIG,
      fingerprint,
      outcome: draft.outcome,
      expected_count: draft.expectedCount ?? 0,
      actual_count: draft.keptCount ?? 0,
      findings: parseFindings(draft.findings),
      duration_ms: draft.durationMs,
      cost_usd: draft.costUsd,
      stale: configMoved || fingerprint !== row.inputFingerprint,
    };
  }

  private toRunSummary(row: EvalRunRowWithDrift): EvalRunSummary {
    return {
      id: row.id,
      owner_kind: 'agent',
      owner_id: row.agentId,
      // Display label ONLY — never the comparability key (AC-10/AC-51).
      agent_version: row.agentVersion,
      status: row.status,
      started_at: row.startedAt.toISOString(),
      finished_at: row.finishedAt?.toISOString() ?? null,
      recall: row.recall,
      precision: row.precision,
      citation_accuracy: row.citationAccuracy,
      traces_passed: row.tracesPassed ?? 0,
      traces_total: row.tracesTotal ?? 0,
      errored_count: row.erroredCount,
      cost_usd: row.costUsd,
      duration_ms: row.durationMs,
      cases_total: row.casesTotal,
      set_drifted: row.setDrifted,
    };
  }

  private async toRunDetail(workspaceId: string, run: EvalRunRow): Promise<EvalRunDetail> {
    const [results, drifted] = await Promise.all([
      this.repo.resultsForRun(workspaceId, run.id),
      this.repo.listRunsForAgent(workspaceId, run.agentId),
    ]);
    const withDrift = drifted.find((r) => r.id === run.id);

    // The frozen expected items are NOT stored on `eval_case_results` (it keeps
    // counts only), so they are re-read from the live case when that case still
    // carries the fingerprint the run measured — i.e. when it has not been
    // edited since. See `expectedFor` for what happens when it has.
    const liveCases = new Map<string, EvalCaseRow>();
    for (const r of results) {
      if (r.caseId && !liveCases.has(r.caseId)) {
        const c = await this.repo.getCase(workspaceId, r.caseId);
        if (c) liveCases.set(r.caseId, c);
      }
    }

    return {
      ...this.toRunSummary({ ...run, setDrifted: withDrift?.setDrifted ?? false }),
      effective_config: EvalEffectiveConfig.safeParse(run.effectiveConfig).data ?? EMPTY_CONFIG,
      results: results.map((r) => toResultDto(r, liveCases)),
    };
  }

  /**
   * AC-45 — every run that measured something is plotted, drifted points are
   * marked, and a DRAFT is never here (a draft is not a run). A run whose every
   * case errored has NULL metrics by AC-37 and therefore no point to plot: it is
   * absent from the trend, not plotted as a zero.
   */
  private toTrend(runs: EvalRunRowWithDrift[]): EvalTrendPoint[] {
    return runs
      .filter(isMeasuredRun)
      .slice()
      .reverse() // chronological
      .map((row) => ({
        run_id: row.id,
        ran_at: (row.finishedAt ?? row.startedAt).toISOString(),
        recall: row.recall,
        precision: row.precision,
        citation_accuracy: row.citationAccuracy,
        pass_rate:
          row.tracesTotal && row.tracesTotal > 0 ? (row.tracesPassed ?? 0) / row.tracesTotal : null,
        cost_usd: row.costUsd,
        set_drifted: row.setDrifted,
      }));
  }
}

// =============================================================================
// Pure helpers
// =============================================================================

/** A run "measured something" iff it completed and carries at least one metric (AC-31/32/37). */
function isMeasuredRun(row: EvalRunRow): boolean {
  if (row.status !== 'done') return false;
  return row.recall !== null || row.precision !== null || row.citationAccuracy !== null;
}

/** AC-14 — recomputed on EVERY write; a stale fingerprint silently fakes comparability. */
function fingerprintOf(values: CaseWriteValues): string {
  return computeFingerprint({
    diff: values.inputDiff,
    prMeta: values.inputMeta,
    expectation: values.expectation,
    expectedItems: values.expectedOutput,
    forbiddenRegion: values.forbiddenRegion,
  });
}

function parseExpectedItems(value: unknown): EvalExpectedItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const parsed = EvalExpectedItem.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
}

function parseForbiddenRegion(value: unknown): EvalForbiddenRegion | null {
  if (value === null || value === undefined) return null;
  return EvalForbiddenRegion.safeParse(value).data ?? null;
}

function parseFindings(value: unknown): Finding[] {
  return Array.isArray(value) ? (value as Finding[]) : [];
}

/**
 * `eval_case_results` persists the two COUNTS (`expected_count`,
 * `matched_count`), not the frozen expected ITEMS or the matched indices — yet
 * `EvalCaseResult` (and `compare.ts`'s metric arithmetic, which reads
 * `expected.length` and `matched_expected_indices.length`) needs arrays.
 *
 * So the arrays are reconstructed here with their LENGTHS taken from the stored
 * counts — which keeps every comparison's recall exactly right no matter what
 * has happened to the case since — and their CONTENT taken from the live case
 * only when that case still carries the fingerprint the run measured. A case
 * edited or deleted since the run cannot have its items recovered, so the
 * placeholder says exactly that rather than inventing a file and a line.
 */
function toResultDto(row: EvalCaseResultRow, liveCases: Map<string, EvalCaseRow>): EvalCaseResult {
  const expectedCount = row.expectedCount ?? 0;
  const live = row.caseId ? liveCases.get(row.caseId) : undefined;
  const recoverable = live && live.inputFingerprint === row.inputFingerprint;
  const items = recoverable ? parseExpectedItems(live.expectedOutput) : [];

  const expected: EvalExpectedItem[] = Array.from({ length: expectedCount }, (_, i) => items[i] ?? UNRECOVERABLE_EXPECTED);
  const matchedCount = Math.min(row.matchedCount ?? 0, expectedCount);

  return {
    case_id: row.caseId ?? '',
    case_name: row.caseName,
    fingerprint: row.inputFingerprint,
    outcome: row.outcome,
    error_reason: row.error,
    expected,
    // Which indices matched is not persisted either — only how many. The count
    // is what every metric divides by; the indices are cosmetic.
    matched_expected_indices: Array.from({ length: matchedCount }, (_, i) => i),
    findings: parseFindings(row.findings),
    unmatched_finding_ids: Array.isArray(row.unmatchedFindings)
      ? (row.unmatchedFindings as string[])
      : [],
    emitted_count: row.emittedCount ?? 0,
    kept_count: row.keptCount ?? 0,
    duration_ms: row.durationMs,
    cost_usd: row.costUsd,
  };
}

/** Stands in for an expected item whose case was edited or deleted since the run — never a fabricated file. */
const UNRECOVERABLE_EXPECTED: EvalExpectedItem = {
  file: '(unavailable — the case changed since this run)',
  start_line: 0,
  end_line: 0,
  kind: 'finding',
};

/** Only ever reached by a row whose `effective_config` jsonb is unreadable (the column is NOT NULL). */
const EMPTY_CONFIG: EvalEffectiveConfig = {
  system_prompt: '',
  provider: 'openrouter',
  model: '',
  strategy: 'auto',
  repo_intel: false,
  skills: [],
};

function toSpend(spend: { runUsd: number; draftUsd: number }) {
  // Two components that reconcile by construction (AC-49): the run-history cost
  // column sums to `run_usd`, and the difference from the total is exactly what
  // the drafts cost. A single blended number could never be tied out.
  return {
    total_usd: spend.runUsd + spend.draftUsd,
    run_usd: spend.runUsd,
    draft_usd: spend.draftUsd,
  };
}

/**
 * AC-33 — the alert NAMES which metric moved and in WHICH direction against the
 * previous comparable run. AC-38 — a delta is never presented alone: the
 * shared-case count and the flipped cases travel with it, so the reader can see
 * that a 4-point delta IS one case flipping rather than a trend.
 *
 * Not comparable (no fingerprint-identical shared case, AC-26) ⇒ no alert: there
 * is no movement to claim, and claiming one would be a lie.
 */
function alertText(comparison: EvalComparison): string | null {
  if (!comparison.comparable) return null;

  const moved = (['recall', 'precision', 'citation_accuracy'] as const)
    .map((metric) => ({ metric, delta: comparison.delta[metric] }))
    .filter(
      (m): m is { metric: EvalRegression['metric']; delta: number } =>
        m.delta !== null && Math.abs(m.delta) > EPSILON,
    );
  if (moved.length === 0) return null;

  const phrases = moved.map(
    (m) => `${METRIC_LABELS[m.metric]} ${m.delta > 0 ? 'rose' : 'fell'} ${formatPoints(m.delta)}`,
  );
  const flipped =
    comparison.flipped_cases.length > 0
      ? `; ${comparison.flipped_cases.length} case(s) flipped: ${comparison.flipped_cases
          .map(
            (c) =>
              `"${c.case_name}" (${c.direction === 'now_passing' ? 'now passing' : 'now failing'})`,
          )
          .join(', ')}`
      : '';
  return `Latest run vs the previous run: ${phrases.join(', ')} — over ${comparison.shared_case_count} shared case(s)${flipped}.`;
}

function deltaOf(comparison: EvalComparison): EvalDashboard['delta'] {
  return {
    recall: comparison.delta.recall ?? 0,
    precision: comparison.delta.precision ?? 0,
    citation_accuracy: comparison.delta.citation_accuracy ?? 0,
  };
}

/** Every metric on which the CANDIDATE side of the comparison is worse (AC-28). */
function regressionsIn(comparison: EvalComparison): EvalRegression[] {
  return (['recall', 'precision', 'citation_accuracy'] as const).flatMap((metric) => {
    const delta = comparison.delta[metric];
    return delta !== null && delta < -EPSILON ? [{ metric, delta }] : [];
  });
}

function formatPoints(delta: number): string {
  return `${Math.abs(delta * 100).toFixed(1)} pts`;
}

function listMetrics(metrics: EvalRegression['metric'][]): string {
  const labels = metrics.map((m) => METRIC_LABELS[m]);
  if (labels.length <= 1) return labels[0] ?? '';
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/** Postgres unique-violation (23505) — the draft guard's DB-level backstop. */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === '23505';
}
