import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BriefResponse, GenerateBriefRequest } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BriefService } from './service.js';
import { BRIEF_GENERATE_RATE_LIMIT } from './constants.js';

/**
 * L06 — Why+Risk Brief module.
 *
 *   GET  /pulls/:id/brief   → BriefResponse (fresh|stale|not_generated|degraded); NO model call
 *   POST /pulls/:id/brief   → generate/Regenerate ({ force }); ONE structured call; SYNCHRONOUS
 *
 * Transport only — zero business logic. Both routes resolve the workspace via
 * `getContext` and scope the PR through the service's `getPull` (cross-workspace
 * PR ⇒ 404, AC-19). The generate route carries a per-route rate-limit override
 * (AC-20); the read route is unthrottled. Synchronous on the POST — no job, no
 * SSE (mirrors `POST /pulls/:id/intent`).
 */
export default async function briefRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BriefService(container);

  // ---- Read the persisted brief (zero model calls) -----------------------
  app.get(
    '/pulls/:id/brief',
    { schema: { params: IdParams, response: { 200: BriefResponse } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBrief(workspaceId, req.params.id);
    },
  );

  // ---- Generate / Regenerate (single model call, rate-limited) -----------
  app.post(
    '/pulls/:id/brief',
    {
      schema: { params: IdParams, body: GenerateBriefRequest, response: { 200: BriefResponse } },
      config: { rateLimit: BRIEF_GENERATE_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.generateBrief(workspaceId, req.params.id, req.body.force ?? false, req.log);
    },
  );
}
