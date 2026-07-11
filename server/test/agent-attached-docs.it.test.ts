import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agent-attached-docs] Docker not available — skipping integration tests.');
}

/**
 * T4 — attach/detach/reorder project-context documents on an agent
 * (`PUT /agents/:id/docs`). AC-9: persists ORDERED repo-relative path
 * strings only, never document text. AC-14: this is mutable config — it must
 * NOT bump `agents.version` or write a new `agent_versions` snapshot row
 * (contrast with a config-affecting `PUT /agents/:id`, covered in
 * agents-versions.it.test.ts).
 */
d('PUT /agents/:id/docs', () => {
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

  const createBody = {
    name: 'Docs Agent',
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    system_prompt: 'Review the diff.',
  };

  async function createAgent(app: Awaited<ReturnType<typeof makeApp>>) {
    const created = await app.inject({ method: 'POST', url: '/agents', payload: createBody });
    expect(created.statusCode).toBe(201);
    return created.json().id as string;
  }

  async function versionRowCount(agentId: string): Promise<number> {
    const rows = await pg.handle.db
      .select({ version: t.agentVersions.version })
      .from(t.agentVersions)
      .where(eq(t.agentVersions.agentId, agentId));
    return rows.length;
  }

  it('attaches paths in order and the DTO returns them', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);

    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/docs`,
      payload: { paths: ['docs/architecture/invariants.md', 'specs/intent-layer.md'] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().attached_docs).toEqual([
      'docs/architecture/invariants.md',
      'specs/intent-layer.md',
    ]);

    const fetched = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
    expect(fetched.json().attached_docs).toEqual([
      'docs/architecture/invariants.md',
      'specs/intent-layer.md',
    ]);
    await app.close();
  });

  it('reordering persists the new order', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/docs`,
      payload: { paths: ['a.md', 'b.md'] },
    });
    const reordered = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/docs`,
      payload: { paths: ['b.md', 'a.md'] },
    });
    expect(reordered.statusCode).toBe(200);
    expect(reordered.json().attached_docs).toEqual(['b.md', 'a.md']);
    await app.close();
  });

  it('detaching with an empty array clears attached_docs', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/docs`,
      payload: { paths: ['a.md', 'b.md'] },
    });
    const cleared = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/docs`,
      payload: { paths: [] },
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().attached_docs).toEqual([]);
    await app.close();
  });

  it('AC-14: agent.version is unchanged and no new agent_versions row is written', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);

    expect(await versionRowCount(agentId)).toBe(1);
    const created = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
    expect(created.json().version).toBe(1);

    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/docs`,
      payload: { paths: ['a.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/docs`,
      payload: { paths: ['b.md', 'a.md'] },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/docs`,
      payload: { paths: [] },
    });

    const after = await app.inject({ method: 'GET', url: `/agents/${agentId}` });
    expect(after.json().version).toBe(1);
    expect(await versionRowCount(agentId)).toBe(1);
    await app.close();
  });

  it('a cross-workspace agent resolves as 404, not 403', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-docs' }).returning();
    const repo = new AgentsRepository(db);
    const foreign = await repo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });

    const app = await makeApp();
    const res = await app.inject({
      method: 'PUT',
      url: `/agents/${foreign.id}/docs`,
      payload: { paths: ['a.md'] },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
