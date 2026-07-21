import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CreateMultiRunBody, CreateMultiRunResponse, MultiAgentRun } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { MultiAgentService } from './service.js';

/**
 * multi-agent module.
 *   POST /pulls/:id/multi-agent-runs        {agentIds} → create + launch a multi-run
 *   GET  /pulls/:id/multi-agent-runs/latest            → the latest MultiAgentRun | null
 *
 * The param **must** be `:id`, matching the `/pulls/:id/*` family that
 * `modules/reviews/routes.ts` already declares: find-my-way refuses two
 * different param names at the same path position and throws at BOOT, not at
 * request time, so `:prId` here would take the whole server down.
 */
export default async function multiAgentRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new MultiAgentService(container);

  // ---- Create a multi-run (fan-out trigger) --------------------------------
  // Same tight per-route limit as the review trigger it delegates to: one call
  // fans out to N cost-incurring LLM runs (AC-26).
  app.post(
    '/pulls/:id/multi-agent-runs',
    {
      schema: {
        params: IdParams,
        body: CreateMultiRunBody,
        response: { 201: CreateMultiRunResponse },
      },
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(container, req);
      const result = await service.createMultiRun(
        workspaceId,
        req.params.id,
        req.body.agentIds,
        req.log,
      );
      reply.status(201);
      return result;
    },
  );

  // ---- Read the latest multi-run for a PR ---------------------------------
  // No rate-limit override (AC-26 exempts the read): it is a cheap DB compose
  // with no model call, and the results page polls it while runs are in flight.
  // A PR with no multi-run yet is `null` with a 200 — the AC-14 empty state —
  // not a 404. Nullable-200 precedent: reviews/routes.ts GET /pulls/:id/intent.
  app.get(
    '/pulls/:id/multi-agent-runs/latest',
    { schema: { params: IdParams, response: { 200: MultiAgentRun.nullable() } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.latestForPr(workspaceId, req.params.id);
    },
  );
}
