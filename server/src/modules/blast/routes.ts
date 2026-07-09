import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { BlastRadius } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { BlastService } from './service.js';

/**
 * blast module (L04).
 *   GET /pulls/:id/blast → PR impact map: changed symbols → callers →
 *                           impacted HTTP endpoints/crons. Compute-on-read
 *                           from the repo-intel index, NO LLM call.
 *                           Mirrors `GET /pulls/:id/smart-diff`
 *                           (`modules/reviews/routes.ts:161`).
 */
export default async function blastRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new BlastService(container);

  app.get(
    '/pulls/:id/blast',
    { schema: { params: IdParams, response: { 200: BlastRadius } } },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.getBlastRadius(workspaceId, req.params.id);
    },
  );
}
