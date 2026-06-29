import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  ConventionStatus,
  UpdateConventionBody,
  CreateSkillFromConventionsBody,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError } from '../../platform/errors.js';
import { ConventionsService } from './service.js';

/**
 * L0X — Conventions Extractor module.
 *
 *   POST /repos/:repoId/conventions/extract                  → enqueue scan (202)
 *   GET  /repos/:repoId/conventions                          → list (filter by status)
 *   GET  /repos/:repoId/conventions/scans/latest             → most recent scan summary
 *   GET  /repos/:repoId/conventions/create-skill/preview     → seed for the modal
 *   POST /repos/:repoId/conventions/create-skill             → merge accepted → Skill
 *   PATCH /conventions/:id                                   → accept/reject/edit rule
 *
 * Live progress is streamed over the existing `GET /runs/:id/events` SSE
 * endpoint — `scanId` doubles as the SSE runId because the bus is generic.
 */

const RepoParam = z.object({ repoId: z.string().uuid() });
const ListQuery = z.object({
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : ['pending', 'accepted']))
    .pipe(z.array(ConventionStatus).nonempty()),
});
const PreviewQuery = z.object({
  candidate_ids: z
    .string()
    .min(1)
    .transform((s) => s.split(',').filter(Boolean)),
});

export default async function conventionsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  // Register the job handler exactly once at module load — see repo-intel
  // routes for the same shape. The JobRunner stores the handler closure, so
  // the local `service` is captured for the lifetime of the process.
  const service = new ConventionsService(app.container);
  service.registerExtractionJobHandler();

  // ---- Extract -----------------------------------------------------------
  app.post(
    '/repos/:repoId/conventions/extract',
    {
      schema: { params: RepoParam },
      config: { rateLimit: { max: 6, timeWindow: '1 minute' } },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const result = await service.startExtraction(workspaceId, req.params.repoId);
      reply.status(202);
      return result;
    },
  );

  // ---- List candidates ---------------------------------------------------
  app.get(
    '/repos/:repoId/conventions',
    { schema: { params: RepoParam, querystring: ListQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listForRepo(workspaceId, req.params.repoId, req.query.status);
    },
  );

  // ---- Latest scan summary -----------------------------------------------
  app.get(
    '/repos/:repoId/conventions/scans/latest',
    { schema: { params: RepoParam } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.latestScan(workspaceId, req.params.repoId);
    },
  );

  // ---- Create-skill preview (seed for the modal) -------------------------
  app.get(
    '/repos/:repoId/conventions/create-skill/preview',
    { schema: { params: RepoParam, querystring: PreviewQuery } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.skillPreview(
        workspaceId,
        req.params.repoId,
        req.query.candidate_ids,
      );
    },
  );

  // ---- Create the skill from accepted candidates -------------------------
  app.post(
    '/repos/:repoId/conventions/create-skill',
    {
      schema: { params: RepoParam, body: CreateSkillFromConventionsBody },
    },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.createSkillFromAccepted(
        workspaceId,
        req.params.repoId,
        {
          candidateIds: req.body.candidate_ids,
          name: req.body.name,
          description: req.body.description,
          body: req.body.body,
          ...(req.body.enabled !== undefined ? { enabled: req.body.enabled } : {}),
        },
      );
      reply.status(201);
      return skill;
    },
  );

  // ---- Patch a single candidate -----------------------------------------
  app.patch(
    '/conventions/:id',
    { schema: { params: IdParams, body: UpdateConventionBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const row = await service.updateCandidate(workspaceId, req.params.id, req.body);
      if (!row) throw new NotFoundError('Convention not found');
      return row;
    },
  );
}
