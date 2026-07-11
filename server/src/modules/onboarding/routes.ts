import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { OnboardingResponse } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { OnboardingService } from './service.js';
import { ONBOARDING_GENERATE_RATE_LIMIT } from './constants.js';

/**
 * L05 — Onboarding Generator module.
 *
 *   GET  /repos/:repoId/onboarding           → OnboardingResponse | null (no model call)
 *   POST /repos/:repoId/onboarding/generate  → 202 { scanId }  (full index → enqueue + SSE)
 *                                              OR 200 OnboardingResponse (degraded skeleton)
 *
 * The generate route is rate-limited (AC-23) as an LLM-calling, cost-incurring
 * endpoint. Progress for the async (full) path streams over the existing
 * `GET /runs/:id/events` SSE endpoint — the `scanId` doubles as the SSE runId.
 */

const RepoParam = z.object({ repoId: z.string().uuid() });
const GenerateBody = z.object({ force: z.boolean().optional() });
const ScanAccepted = z.object({ scanId: z.string() });

export default async function onboardingRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Register the generation job handler once at module load (conventions shape).
  const service = new OnboardingService(app.container);
  service.registerGenerationJobHandler();

  // ---- Read the persisted artifact (zero model calls) --------------------
  app.get(
    '/repos/:repoId/onboarding',
    {
      schema: {
        params: RepoParam,
        response: { 200: OnboardingResponse.nullable() },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.getForRepo(workspaceId, req.params.repoId);
    },
  );

  // ---- Generate / Regenerate ---------------------------------------------
  app.post(
    '/repos/:repoId/onboarding/generate',
    {
      schema: {
        params: RepoParam,
        body: GenerateBody,
        response: { 200: OnboardingResponse, 202: ScanAccepted },
      },
      config: { rateLimit: ONBOARDING_GENERATE_RATE_LIMIT },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const outcome = await service.startGeneration(
        workspaceId,
        req.params.repoId,
        req.body.force ?? false,
      );
      if (outcome.kind === 'degraded') {
        reply.status(200);
        return outcome.response;
      }
      reply.status(202);
      return { scanId: outcome.scanId };
    },
  );
}
