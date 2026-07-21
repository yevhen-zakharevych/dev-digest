/**
 * Export-to-CI + CI Runs HTTP transport. ZERO business logic.
 *
 * Every refusal (bad repo, unsupported target/action, empty triggers, oversized
 * workflow override, unknown agent/installation, GitHub rejection) is raised by
 * `CiService`/`CiRunsService` as an `AppError` carrying its own status, and the
 * global error handler renders it verbatim — this file never catches, never
 * reclassifies, never downgrades one to a 5xx.
 *
 * REST surface — pinned in docs/plans/export-to-ci.md §7.4:
 *   POST /agents/:id/ci/preview            → CiFile[]                        (AC-5, AC-6, AC-8, AC-9)
 *   POST /agents/:id/export-ci             → CiExport                 [10/min] (AC-10 … AC-12, AC-24 … AC-28)
 *   GET  /agents/:id/ci/installations      → (CiInstallation & last_run)[]    (AC-43)
 *   POST /ci/installations/:id/update-config → { pr_url, files }     [10/min] (AC-30, AC-31)
 *   GET  /ci/runs                          → (CiRun & { repo })[]             (AC-38, AC-40)
 *   POST /ci/runs/refresh                  → { runs, failed }        [ 6/min] (AC-32 … AC-37)
 *
 * AC-46 — every handler resolves the workspace through `getContext` and passes
 * it into the service first; an agent, installation or run belonging to another
 * workspace resolves as 404 there, never as "found but forbidden" and never as
 * data.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CiExportInput, CiExport, CiFile, CiInstallation, CiRun } from '@devdigest/shared';
import { getContext } from '../_shared/context.js';
import { IdParams } from '../_shared/schemas.js';
import { CiService } from './service.js';
import { CiRunsService } from './ingest.js';

/**
 * AC-47 — export ≤ 10/min per workspace, refresh ≤ 6/min. OQ-7 applies the
 * export ceiling to update-config too, which also writes to GitHub (AC-47 sets
 * ceilings, not floors, so a tighter limit cannot violate it).
 *
 * NOTE the global limiter is disabled under `NODE_ENV=test` (`app.ts`), so these
 * are asserted as route CONFIG, never by trying to trip them in a test.
 */
export const CI_WRITE_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
export const CI_REFRESH_RATE_LIMIT = { max: 6, timeWindow: '1 minute' } as const;

/**
 * AC-11 — the export/preview body is STRICT.
 *
 * `CiExportInput` is a plain `z.object`, which SILENTLY STRIPS unknown keys: a
 * request carrying `path`, `files` or any other invented field would otherwise
 * be accepted with a 200 and the extra content quietly dropped. AC-11 requires a
 * rejection, so the strict variant is applied here at the transport edge —
 * narrowing the shared contract itself would be a second dual-vendored edit.
 *
 * The contract deliberately has no path field at all; every generated path comes
 * from `modules/ci/constants.ts`.
 */
const CiExportBody = CiExportInput.strict();

/** AC-43 — composed at the route from two already-vendored contracts, not a new symbol. */
const CiInstallationWithLastRun = CiInstallation.extend({ last_run: CiRun.nullable() });

/** AC-40 — the run plus its installation's repository slug (see `CiRepository.listRuns`). */
const CiRunWithRepo = CiRun.extend({ repo: z.string() });

/** AC-37 — the repositories that could not be refreshed, named. */
const CiRefreshResponse = z.object({
  runs: z.array(CiRunWithRepo),
  failed: z.array(z.object({ repo: z.string(), message: z.string() })),
});

/** AC-30 — the reused PR (or none) plus the config files actually committed. */
const CiUpdateConfigResponse = z.object({
  pr_url: z.string().nullable(),
  files: z.array(CiFile),
});

export default async function ciRoutes(appBase: FastifyInstance) {
  const app = appBase.withTypeProvider<ZodTypeProvider>();
  const service = new CiService(app.container);
  const runs = new CiRunsService(app.container);

  // ---- Preview (no write of any kind) ------------------------------------
  app.post(
    '/agents/:id/ci/preview',
    {
      schema: { params: IdParams, body: CiExportBody, response: { 200: z.array(CiFile) } },
      // Writes nothing, but is NOT free: every call reads the whole multi-megabyte runner
      // bundle off disk into memory. Left on the 120/min global default it is a cheap
      // amplifier, so it gets the same ceiling as the writing routes.
      config: { rateLimit: CI_WRITE_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.preview(workspaceId, req.params.id, req.body);
    },
  );

  // ---- Export / install --------------------------------------------------
  app.post(
    '/agents/:id/export-ci',
    {
      schema: { params: IdParams, body: CiExportBody, response: { 200: CiExport } },
      config: { rateLimit: CI_WRITE_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.export(workspaceId, req.params.id, req.body);
    },
  );

  // ---- Installations of one agent (the CI tab) ---------------------------
  app.get(
    '/agents/:id/ci/installations',
    {
      schema: {
        params: IdParams,
        response: { 200: z.array(CiInstallationWithLastRun) },
      },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.listInstallations(workspaceId, req.params.id);
    },
  );

  // ---- Update one installation's config ----------------------------------
  app.post(
    '/ci/installations/:id/update-config',
    {
      schema: { params: IdParams, response: { 200: CiUpdateConfigResponse } },
      config: { rateLimit: CI_WRITE_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return service.updateConfig(workspaceId, req.params.id);
    },
  );

  // ---- CI Runs -----------------------------------------------------------
  app.get(
    '/ci/runs',
    { schema: { response: { 200: z.array(CiRunWithRepo) } } },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return runs.list(workspaceId);
    },
  );

  app.post(
    '/ci/runs/refresh',
    {
      schema: { response: { 200: CiRefreshResponse } },
      config: { rateLimit: CI_REFRESH_RATE_LIMIT },
    },
    async (req) => {
      const { workspaceId } = await getContext(app.container, req);
      return runs.refresh(workspaceId);
    },
  );
}
