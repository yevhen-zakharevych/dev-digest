import { describe, it, expect } from 'vitest';
import Fastify, { type RouteOptions } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import type { Container } from '../../platform/container.js';
import ciRoutes, { CI_REFRESH_RATE_LIMIT, CI_WRITE_RATE_LIMIT } from './routes.js';

/**
 * AC-47 — per-route rate limits, asserted as route CONFIG.
 *
 * This is deliberately a UNIT test and not an `.it.test.ts`: the global limiter
 * is disabled under `NODE_ENV=test` (`src/app.ts`), so an integration test
 * cannot trip the limit at all — it would pass identically with every
 * `config.rateLimit` deleted. Reading the registered route options back through
 * an `onRoute` hook is the only observable that actually fails when a limit goes
 * missing.
 *
 * No database and no container: `ciRoutes` constructs its services with the
 * container but neither touches it until a request arrives.
 */
async function collectRoutes(): Promise<RouteOptions[]> {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('container', {} as Container);
  const routes: RouteOptions[] = [];
  app.addHook('onRoute', (route) => {
    routes.push(route);
  });
  await app.register(ciRoutes);
  await app.ready();
  await app.close();
  return routes;
}

function rateLimitOf(routes: RouteOptions[], method: string, url: string): unknown {
  const route = routes.find((r) => r.url === url && [r.method].flat().includes(method));
  expect(route, `${method} ${url} is not registered`).toBeDefined();
  return (route!.config as { rateLimit?: unknown } | undefined)?.rateLimit;
}

describe('CI routes — registration + rate limits (AC-47)', () => {
  it('registers exactly the six routes the plan names', async () => {
    const routes = await collectRoutes();
    const surface = routes
      // Fastify auto-registers a HEAD shadow for every GET; not part of the surface.
      .filter((r) => ![r.method].flat().includes('HEAD'))
      .map((r) => `${[r.method].flat().join(',')} ${r.url}`)
      .sort();
    expect(surface).toEqual([
      'GET /agents/:id/ci/installations',
      'GET /ci/runs',
      'POST /agents/:id/ci/preview',
      'POST /agents/:id/export-ci',
      'POST /ci/installations/:id/update-config',
      'POST /ci/runs/refresh',
    ]);
  });

  it('export is limited to 10/min (AC-47)', async () => {
    const routes = await collectRoutes();
    expect(rateLimitOf(routes, 'POST', '/agents/:id/export-ci')).toEqual({
      max: 10,
      timeWindow: '1 minute',
    });
    expect(CI_WRITE_RATE_LIMIT).toEqual({ max: 10, timeWindow: '1 minute' });
  });

  it('update-config carries the export limit too (OQ-7 — it also writes to GitHub)', async () => {
    const routes = await collectRoutes();
    expect(rateLimitOf(routes, 'POST', '/ci/installations/:id/update-config')).toEqual({
      max: 10,
      timeWindow: '1 minute',
    });
  });

  it('refresh is limited to 6/min (AC-47)', async () => {
    const routes = await collectRoutes();
    expect(rateLimitOf(routes, 'POST', '/ci/runs/refresh')).toEqual({
      max: 6,
      timeWindow: '1 minute',
    });
    expect(CI_REFRESH_RATE_LIMIT).toEqual({ max: 6, timeWindow: '1 minute' });
  });

  it('the cheap DB reads take the global default (no per-route override)', async () => {
    const routes = await collectRoutes();
    expect(rateLimitOf(routes, 'GET', '/ci/runs')).toBeUndefined();
    expect(rateLimitOf(routes, 'GET', '/agents/:id/ci/installations')).toBeUndefined();
  });

  it('preview is tightened despite writing nothing — it reads the whole runner bundle', async () => {
    // Not a write, but every call pulls a multi-megabyte bundle off disk into memory, so
    // the 120/min global default made it a cheap amplifier.
    const routes = await collectRoutes();
    expect(rateLimitOf(routes, 'POST', '/agents/:id/ci/preview')).toEqual({
      max: 10,
      timeWindow: '1 minute',
    });
  });
});
