import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { SkillsRepository } from '../src/modules/skills/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills-attached-docs] Docker not available — skipping integration tests.');
}

/**
 * T5 — Skill attach-docs (repo/service/routes). `PUT /skills/:id/docs` sets the
 * ordered `attached_docs` path list a skill contributes to every agent that
 * loads it. Covers: order-preserving persist + clear, independence from
 * `evidence_files`, AC-14 (no version bump / no `skill_versions` snapshot),
 * and cross-workspace 404.
 */
d('PUT /skills/:id/docs', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const skillBody = {
    name: 'attach-docs-target',
    description: 'A skill used to test project-context doc attachment.',
    type: 'convention' as const,
    body: '# Rule\nSome rule body.',
  };

  it('attach persists ordered paths and the DTO returns them; detach clears', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: skillBody });
    const id = created.json().id as string;
    expect(created.json().attached_docs).toEqual([]);

    const paths = ['docs/architecture/invariants.md', 'specs/2026-07-10-project-context.md'];
    const attach = await app.inject({
      method: 'PUT',
      url: `/skills/${id}/docs`,
      payload: { paths },
    });
    expect(attach.statusCode).toBe(200);
    expect(attach.json().attached_docs).toEqual(paths);

    // GET reflects the same ordered list.
    const got = await app.inject({ method: 'GET', url: `/skills/${id}` });
    expect(got.json().attached_docs).toEqual(paths);

    // Detach clears the list.
    const detach = await app.inject({
      method: 'PUT',
      url: `/skills/${id}/docs`,
      payload: { paths: [] },
    });
    expect(detach.statusCode).toBe(200);
    expect(detach.json().attached_docs).toEqual([]);

    await app.close();
  });

  it('attach does not touch evidence_files — the two fields are independent', async () => {
    const app = await makeApp();
    const repo = new SkillsRepository(pg.handle.db);
    const [{ id: wsId }] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));

    // Insert a skill with pre-set evidence_files, as the Conventions Extractor would.
    const row = await repo.insert({
      workspaceId: wsId!,
      name: 'evidence-independence',
      description: 'desc',
      type: 'convention',
      source: 'extracted',
      body: 'body',
      evidenceFiles: ['src/core/handler.ts'],
    });

    const attach = await app.inject({
      method: 'PUT',
      url: `/skills/${row.id}/docs`,
      payload: { paths: ['docs/guide.md'] },
    });
    expect(attach.statusCode).toBe(200);
    expect(attach.json().evidence_files).toEqual(['src/core/handler.ts']);
    expect(attach.json().attached_docs).toEqual(['docs/guide.md']);

    await app.close();
  });

  it('AC-14: attaching/detaching does not bump version or write a skill_versions snapshot', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: skillBody });
    const id = created.json().id as string;
    expect(created.json().version).toBe(1);

    const versionsBefore = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    const countBefore = (versionsBefore.json() as unknown[]).length;

    const attach = await app.inject({
      method: 'PUT',
      url: `/skills/${id}/docs`,
      payload: { paths: ['docs/a.md', 'docs/b.md'] },
    });
    expect(attach.statusCode).toBe(200);
    expect(attach.json().version).toBe(1);

    const detach = await app.inject({
      method: 'PUT',
      url: `/skills/${id}/docs`,
      payload: { paths: [] },
    });
    expect(detach.statusCode).toBe(200);
    expect(detach.json().version).toBe(1);

    const versionsAfter = await app.inject({ method: 'GET', url: `/skills/${id}/versions` });
    expect((versionsAfter.json() as unknown[]).length).toBe(countBefore);

    await app.close();
  });

  it('a skill in a different workspace 404s, not 403', async () => {
    const app = await makeApp();
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-attach-docs' }).returning();
    const repo = new SkillsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'foreign-skill',
      description: 'desc',
      type: 'custom',
      source: 'manual',
      body: 'body',
    });

    const res = await app.inject({
      method: 'PUT',
      url: `/skills/${foreign.id}/docs`,
      payload: { paths: ['docs/should-not-attach.md'] },
    });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
