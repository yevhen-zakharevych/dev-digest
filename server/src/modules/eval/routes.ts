import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { EvalCaseInput } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { EvalService } from './service.js';

/**
 * T17 — eval module HTTP transport. ZERO business logic: every named refusal
 * (skill owner, undecided finding, unsatisfiable diff, run/draft in flight,
 * disabled agent, no config snapshot, unacknowledged regression) is raised by
 * `EvalService` as an `AppError` carrying its own status + code, and the
 * global error handler (`app.ts:120-168`) renders it verbatim — this file
 * never re-derives, reclassifies, or downgrades one of those to a 5xx.
 *
 * Every handler resolves `{ workspaceId }` via `getContext()` (AC-39) and
 * threads it into the service call first — a case/run/agent outside the
 * caller's workspace resolves as a 404 there (the service's `requireX`
 * helpers), never here, and never as "found but forbidden". Every case is
 * created under `owner_kind: 'agent'` ONLY: the route is always
 * `/agents/:id/eval/cases`, so there is no way to submit a `skill` owner
 * through this surface at all (AC-40) — the service's own `assertAgentOwner`
 * guard is the second line of defense, exercised by the batch/dashboard
 * reads that also hard-code `'agent'`.
 *
 * REST surface — pinned in docs/plans/L06-eval-pipeline.md §7.6:
 *   GET/POST       /agents/:id/eval/cases
 *   GET/PUT/DELETE /eval/cases/:id
 *   POST           /eval/cases/from-finding      {finding_id} → {case, created}
 *   POST           /eval/cases/:id/draft         [rate-limited]
 *   GET            /eval/cases/:id/draft
 *   POST           /agents/:id/eval/runs         [rate-limited] → run in `running`
 *   GET            /agents/:id/eval/runs
 *   GET            /eval/runs/:id
 *   POST           /eval/runs/:id/cancel
 *   GET            /eval/compare?a=&b=
 *   POST           /eval/runs/:id/promote
 *   GET            /agents/:id/eval/dashboard
 *   GET            /eval/dashboard
 *   GET            /eval/run-all/preview
 *   POST           /eval/run-all                 [rate-limited]
 */

// AC-41 — copied verbatim from the review-run route (`reviews/routes.ts:33`).
// These three are LLM-calling, cost-incurring endpoints; `run-all` fans out
// one model call per case per agent, so an unthrottled double-click is real
// money.
const RUN_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/** Owner is the `:id` URL segment (always `agent`) — dropped from the body,
 *  same shape as the client's `CreateEvalCaseInput` (`hooks/evals.ts:38`). */
const CreateEvalCaseBody = EvalCaseInput.omit({ owner_kind: true, owner_id: true });

/** The user-editable half of a case — mirrors `EvalService.UpdateCaseInput`. */
const UpdateEvalCaseBody = EvalCaseInput.pick({
  name: true,
  expectation: true,
  input_diff: true,
  input_files: true,
  input_meta: true,
  expected_output: true,
  forbidden_region: true,
  notes: true,
}).partial();

const SeedFromFindingBody = z.object({ finding_id: z.string().uuid() });

const PromoteBody = z.object({ acknowledge_regression: z.boolean().optional() });

const CompareQuery = z.object({ a: z.string().uuid(), b: z.string().uuid() });

export default async function evalRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new EvalService(container);

  // ===========================================================================
  // Cases
  // ===========================================================================

  app.get('/agents/:id/eval/cases', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listCases(workspaceId, 'agent', req.params.id);
  });

  app.post(
    '/agents/:id/eval/cases',
    { schema: { params: IdParams, body: CreateEvalCaseBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const created = await service.createCase(workspaceId, {
        ...req.body,
        owner_kind: 'agent',
        owner_id: req.params.id,
      });
      reply.status(201);
      return created;
    },
  );

  app.get('/eval/cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getCase(workspaceId, req.params.id);
  });

  app.put(
    '/eval/cases/:id',
    { schema: { params: IdParams, body: UpdateEvalCaseBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.updateCase(workspaceId, req.params.id, req.body);
    },
  );

  app.delete('/eval/cases/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    const ok = await service.deleteCase(workspaceId, req.params.id);
    // AC-39 — a case outside this workspace is indistinguishable from a
    // missing one: 404, not a silent `{ ok: false }`.
    if (!ok) throw new NotFoundError('Eval case not found');
    return { ok: true };
  });

  // ===========================================================================
  // Seed from a decided finding (AC-1/2/3/7/8) — the feature's front door
  // ===========================================================================

  app.post(
    '/eval/cases/from-finding',
    { schema: { body: SeedFromFindingBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.seedFromFinding(workspaceId, req.body.finding_id);
    },
  );

  // ===========================================================================
  // Drafts — a single case, never a run (AC-47/48, AC-13)
  // ===========================================================================

  app.post(
    '/eval/cases/:id/draft',
    { schema: { params: IdParams }, config: { rateLimit: RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      // AC-11/A-1 — asynchronous like a run: fire-and-forget inside the
      // service, ack immediately. Never awaited beyond the service call.
      await service.startDraft(workspaceId, req.params.id, req.log);
      return { ok: true };
    },
  );

  app.get('/eval/cases/:id/draft', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getLatestDraft(workspaceId, req.params.id);
  });

  // ===========================================================================
  // Runs — the batch (AC-9..14, AC-34, AC-44)
  // ===========================================================================

  app.post(
    '/agents/:id/eval/runs',
    { schema: { params: IdParams }, config: { rateLimit: RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      // AC-11 — `startRun` inserts the run row, fires the executor
      // fire-and-forget, and resolves with the run in a non-terminal status.
      // NEVER await the run itself here.
      return service.startRun(workspaceId, req.params.id, req.log);
    },
  );

  app.get('/agents/:id/eval/runs', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.listRuns(workspaceId, req.params.id);
  });

  app.get('/eval/runs/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.getRun(workspaceId, req.params.id);
  });

  app.post('/eval/runs/:id/cancel', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    await service.cancelRun(workspaceId, req.params.id);
    return { ok: true };
  });

  // ===========================================================================
  // Compare + promote (AC-24..28, AC-51, AC-52)
  // ===========================================================================

  app.get('/eval/compare', { schema: { querystring: CompareQuery } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.compare(workspaceId, req.query.a, req.query.b);
  });

  app.post(
    '/eval/runs/:id/promote',
    { schema: { params: IdParams, body: PromoteBody } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.promote(workspaceId, req.params.id, {
        acknowledgeRegression: req.body.acknowledge_regression,
      });
    },
  );

  // ===========================================================================
  // Dashboards (AC-29..33, AC-46, AC-49, AC-50)
  // ===========================================================================

  app.get('/agents/:id/eval/dashboard', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.agentDashboard(workspaceId, req.params.id);
  });

  app.get('/eval/dashboard', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.workspaceDashboard(workspaceId);
  });

  // ===========================================================================
  // Run all agents (AC-35) — the preview names totals BEFORE a single model
  // call is issued; the POST is the tightest-throttled route in the feature.
  // ===========================================================================

  app.get('/eval/run-all/preview', async (req) => {
    const { workspaceId } = await getContext(container, req);
    return service.runAllPreview(workspaceId);
  });

  app.post(
    '/eval/run-all',
    { config: { rateLimit: RUN_RATE_LIMIT } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      await service.runAll(workspaceId, req.log);
      return { ok: true };
    },
  );
}
