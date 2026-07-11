import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  DocumentContent,
  DocumentQuery,
  ProjectContextDocs,
  SaveDocumentBody,
} from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { RepoParams } from '../_shared/schemas.js';
import { ContextService } from './service.js';
import { CONTEXT_ROUTE_RATE_LIMIT } from './constants.js';

/**
 * context module — Project Context discovery + guarded doc read/write.
 *   GET /repos/:repoId/project-context      → discovered docs + summary footer
 *   GET /repos/:repoId/project-context/doc  → raw markdown of one document
 *   PUT /repos/:repoId/project-context/doc  → save edited markdown (no git/LLM)
 *
 * Routes deliberately live under `/project-context`, NOT `/context` — the
 * repo has an orphaned, unwired semantic-indexing scaffold
 * (`db/schema/context.ts`, `SpecFile`/`IndexStatus`) that this feature must
 * never collide with or repurpose.
 *
 * Every route is workspace-scoped via `getContext`: a repo outside the
 * caller's workspace resolves as NOT-FOUND (404), never forbidden. The two
 * filesystem-touching routes (discovery walk, doc save) carry a per-route
 * rate limit at least as tight as the 120/min global default.
 */
export default async function contextRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const { container } = app;
  const service = new ContextService(container);

  app.get(
    '/repos/:repoId/project-context',
    {
      schema: { params: RepoParams, response: { 200: ProjectContextDocs } },
      config: { rateLimit: CONTEXT_ROUTE_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.discover(workspaceId, req.params.repoId);
    },
  );

  app.get(
    '/repos/:repoId/project-context/doc',
    {
      schema: {
        params: RepoParams,
        querystring: DocumentQuery,
        response: { 200: DocumentContent },
      },
      // FIX 5: this route reads a caller-supplied path off disk, same as the
      // save route below — it must carry the same per-route ceiling rather
      // than fall back to the 120/min global default.
      config: { rateLimit: CONTEXT_ROUTE_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.readDocument(workspaceId, req.params.repoId, req.query.path);
    },
  );

  app.put(
    '/repos/:repoId/project-context/doc',
    {
      schema: {
        params: RepoParams,
        body: SaveDocumentBody,
        response: { 200: DocumentContent },
      },
      config: { rateLimit: CONTEXT_ROUTE_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(container, req);
      return service.saveDocument(workspaceId, req.params.repoId, req.body);
    },
  );
}
