import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockGitClient, MockGitHubClient } from '../../adapters/mocks.js';
import { AgentsRepository } from './repository.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-estimates] Docker not available — skipping integration tests.');
}

/**
 * T2 — GET /agents/estimates?repoId= (AC-7, AC-9, AC-10, AC-25).
 *
 * Covers: the deterministic mean/sample-size arithmetic over a fixed set of
 * seeded `agent_runs` (criterion 6 — one of the few things the spec allows
 * asserting exactly), the exclusion of failed/cancelled/running runs and
 * null-cost runs from the respective means (§4 Q9), the "no fabricated
 * zero" rule for a history-less agent (AC-9), and workspace scoping (AC-25):
 * a repoId that lives in a different workspace than the caller yields an
 * empty list, never that workspace's numbers.
 */
d('GET /agents/estimates', () => {
  let pg: PgFixture;
  let defaultWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    defaultWorkspaceId = ws!.id;
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

  let repoSeq = 0;
  async function makeRepoAndPr(workspaceId: string) {
    const { db } = pg.handle;
    const name = `estimates-repo-${repoSeq++}`;
    const [repo] = await db
      .insert(t.repos)
      .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 1,
        title: 'PR',
        author: 'someone',
        branch: 'feat/x',
        base: 'main',
        headSha: 'abc123',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  async function insertRun(
    workspaceId: string,
    prId: string,
    agentId: string,
    values: { status: 'done' | 'failed' | 'cancelled' | 'running'; durationMs?: number | null; costUsd?: number | null },
  ) {
    const { db } = pg.handle;
    await db.insert(t.agentRuns).values({
      workspaceId,
      agentId,
      prId,
      provider: 'openai',
      model: 'gpt-4o-mini',
      status: values.status,
      durationMs: values.durationMs ?? (values.status === 'done' ? 0 : 0),
      costUsd: values.costUsd ?? null,
      source: 'local',
    });
  }

  it('averages durationMs/costUsd over `done` runs only; sample_size = count of done runs', async () => {
    const { db } = pg.handle;
    const { repo, pr } = await makeRepoAndPr(defaultWorkspaceId);
    const agentsRepo = new AgentsRepository(db);
    const agent = await agentsRepo.insert({
      workspaceId: defaultWorkspaceId,
      name: 'Estimate Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review.',
    });

    // Two done runs with cost (10000ms/$1, 20000ms/$3) -> avg duration 15000, avg cost 2.
    await insertRun(defaultWorkspaceId, pr.id, agent.id, {
      status: 'done',
      durationMs: 10_000,
      costUsd: 1,
    });
    await insertRun(defaultWorkspaceId, pr.id, agent.id, {
      status: 'done',
      durationMs: 20_000,
      costUsd: 3,
    });
    // A done run with a null cost (contributes to the duration mean, not the cost mean).
    await insertRun(defaultWorkspaceId, pr.id, agent.id, {
      status: 'done',
      durationMs: 30_000,
      costUsd: null,
    });
    // Failed/cancelled/running runs are excluded entirely, even with a duration/cost.
    await insertRun(defaultWorkspaceId, pr.id, agent.id, {
      status: 'failed',
      durationMs: 0,
      costUsd: null,
    });
    await insertRun(defaultWorkspaceId, pr.id, agent.id, {
      status: 'cancelled',
      durationMs: 0,
      costUsd: null,
    });
    await insertRun(defaultWorkspaceId, pr.id, agent.id, {
      status: 'running',
      durationMs: null,
      costUsd: null,
    });

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/agents/estimates?repoId=${repo.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      agent_id: string;
      avg_duration_ms: number | null;
      avg_cost_usd: number | null;
      sample_size: number;
    }[];
    const row = body.find((r) => r.agent_id === agent.id);
    expect(row).toBeDefined();
    // (10000 + 20000 + 30000) / 3 done runs
    expect(row!.avg_duration_ms).toBe(20_000);
    // (1 + 3) / 2 done runs with non-null cost
    expect(row!.avg_cost_usd).toBe(2);
    expect(row!.sample_size).toBe(3);
    await app.close();
  });

  it('an agent with no `done` run in the repo yields no fabricated zero (no row, or nulls)', async () => {
    const { db } = pg.handle;
    const { repo, pr } = await makeRepoAndPr(defaultWorkspaceId);
    const agentsRepo = new AgentsRepository(db);
    const agent = await agentsRepo.insert({
      workspaceId: defaultWorkspaceId,
      name: 'History-less Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review.',
    });
    // Only a running run — no `done` history at all.
    await insertRun(defaultWorkspaceId, pr.id, agent.id, { status: 'running' });

    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: `/agents/estimates?repoId=${repo.id}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agent_id: string; avg_duration_ms: number | null }[];
    const row = body.find((r) => r.agent_id === agent.id);
    // Either absent, or present with null averages — never a fabricated 0.
    if (row) {
      expect(row.avg_duration_ms).toBeNull();
    } else {
      expect(row).toBeUndefined();
    }
    await app.close();
  });

  it('repoId is required and validated as a uuid', async () => {
    const app = await makeApp();
    const missing = await app.inject({ method: 'GET', url: '/agents/estimates' });
    expect(missing.statusCode).toBe(422);
    const invalid = await app.inject({ method: 'GET', url: '/agents/estimates?repoId=not-a-uuid' });
    expect(invalid.statusCode).toBe(422);
    await app.close();
  });

  it('is workspace-scoped: a repoId from another workspace yields an empty list, never that workspace\'s numbers', async () => {
    const { db } = pg.handle;
    const [otherWs] = await db.insert(t.workspaces).values({ name: 'other-estimates' }).returning();
    const { repo: otherRepo, pr: otherPr } = await makeRepoAndPr(otherWs!.id);
    const agentsRepo = new AgentsRepository(db);
    const otherAgent = await agentsRepo.insert({
      workspaceId: otherWs!.id,
      name: 'Foreign Agent',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review.',
    });
    await insertRun(otherWs!.id, otherPr.id, otherAgent.id, {
      status: 'done',
      durationMs: 5_000,
      costUsd: 1,
    });

    // The request context always resolves to the DEFAULT workspace
    // (LocalNoAuthProvider) — asking for the OTHER workspace's repoId must
    // not leak its agent's numbers.
    const app = await makeApp();
    const res = await app.inject({
      method: 'GET',
      url: `/agents/estimates?repoId=${otherRepo.id}`,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { agent_id: string }[];
    expect(body.find((r) => r.agent_id === otherAgent.id)).toBeUndefined();
    await app.close();
  });

  it('GET /agents is unaffected — remains a separate endpoint (AC-10)', async () => {
    const app = await makeApp();
    const res = await app.inject({ method: 'GET', url: '/agents' });
    expect(res.statusCode).toBe(200);
    await app.close();
  });
});
