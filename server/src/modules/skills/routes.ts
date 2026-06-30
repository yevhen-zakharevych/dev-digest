import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { RestoreSkillBody, SkillType } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { NotFoundError, BadRequestError } from '../../platform/errors.js';
import { SkillsService } from './service.js';

/**
 * L02 — skills module.
 *   GET    /skills              → list (workspace-scoped)
 *   GET    /skills/:id          → one
 *   POST   /skills              → create
 *   PUT    /skills/:id          → update / toggle enabled / edit body (versioned)
 *   DELETE /skills/:id          → delete (cascade unlinks from agents)
 *   POST   /skills/import       → multipart md/zip → ImportPreview (no write)
 *   POST   /skills/import/save  → persist a confirmed preview
 */

const CreateSkillBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});

const UpdateSkillBody = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  type: SkillType.optional(),
  body: z.string().min(1).optional(),
  enabled: z.boolean().optional(),
});

const ImportPreviewBody = z.object({
  name: z.string().min(1),
  description: z.string(),
  type: SkillType,
  body: z.string().min(1),
  skippedFiles: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
});

export default async function skillsRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new SkillsService(app.container);

  app.get('/skills', async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    return service.list(workspaceId);
  });

  app.get('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.get(workspaceId, req.params.id);
    if (!skill) throw new NotFoundError('Skill not found');
    return skill;
  });

  app.post('/skills', { schema: { body: CreateSkillBody } }, async (req, reply) => {
    const { workspaceId } = await getContext(app.container, req);
    const skill = await service.create(workspaceId, req.body);
    reply.status(201);
    return skill;
  });

  app.put(
    '/skills/:id',
    { schema: { params: IdParams, body: UpdateSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.update(workspaceId, req.params.id, req.body);
      if (!skill) throw new NotFoundError('Skill not found');
      return skill;
    },
  );

  app.delete('/skills/:id', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const ok = await service.delete(workspaceId, req.params.id);
    if (!ok) throw new NotFoundError('Skill not found');
    return { ok: true };
  });

  app.get('/skills/:id/versions', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const versions = await service.listVersions(workspaceId, req.params.id);
    if (!versions) throw new NotFoundError('Skill not found');
    return versions;
  });

  // Import — multipart upload returns a preview (no write). Frontend reviews,
  // then calls /skills/import/save with the confirmed/edited body. Executable
  // entries in a zip are LISTED in skippedFiles but never extracted/persisted.
  app.post('/skills/import', async (req) => {
    await getContext(app.container, req);
    const data = await req.file();
    if (!data) throw new BadRequestError('No file uploaded');
    const buf = await data.toBuffer();
    const filename = data.filename || 'skill.md';
    const lower = filename.toLowerCase();
    if (lower.endsWith('.zip')) {
      return service.previewZip(buf);
    }
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) {
      return service.previewMarkdown(filename, buf.toString('utf8'));
    }
    throw new BadRequestError('Only .md, .markdown or .zip files are supported');
  });

  app.post(
    '/skills/:id/restore',
    { schema: { params: IdParams, body: RestoreSkillBody } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.restore(workspaceId, req.params.id, req.body.version);
      if (!skill) throw new NotFoundError('Skill or version not found');
      return skill;
    },
  );

  app.get('/skills/:id/stats', { schema: { params: IdParams } }, async (req) => {
    const { workspaceId } = await getContext(app.container, req);
    const stats = await service.getStats(workspaceId, req.params.id);
    if (!stats) throw new NotFoundError('Skill not found');
    return stats;
  });

  app.post(
    '/skills/import/save',
    { schema: { body: ImportPreviewBody } },
    async (req, reply) => {
      const { workspaceId } = await getContext(app.container, req);
      const skill = await service.createFromImport(workspaceId, req.body);
      reply.status(201);
      return skill;
    },
  );
}
