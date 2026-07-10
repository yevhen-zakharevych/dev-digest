import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { GitHubClient, LLMProvider } from '@devdigest/shared';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../../adapters/mocks.js';
import type { BlastResult, RepoIntel } from '../repo-intel/types.js';
import { BRIEF_GENERATE_RATE_LIMIT } from './constants.js';

/**
 * L06 — Why+Risk Brief service, end-to-end (DB-backed).
 *
 * Covers AC-2 (absent intent still generates), AC-4 (linked issue omitted —
 * both the no-`#N`-in-body branch and the referenced-but-GitHub-fetch-fails
 * branch), AC-5/6 (one structured call + cost recorded, zero on read), AC-7 (grounding
 * drops a hallucinated ref), AC-13/14/15 (persist + fresh/stale + Regenerate),
 * AC-16 (model failure → degraded, prior brief preserved, nothing partial
 * persisted), AC-17 (never-generated → not_generated), AC-19 (cross-workspace
 * 404 via a SEPARATE seeded workspace), AC-20 (rate-limit config exists).
 * Deterministic assertions only — never on LLM `what`/`why`/reason prose.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[brief] Docker not available — skipping integration tests.');
}

const HEAD_1 = 'a1b2c3d4e5f6'; // the seeded PR #482 head SHA
const HEAD_2 = 'sha-advanced-2';

/** A raw model brief: one grounded ref + one hallucinated ref (dropped by grounding). */
const briefFixture = {
  what: 'Adds token-bucket rate limiting to public endpoints.',
  why: 'Prevent abuse from unauthenticated clients.',
  risk_level: 'HIGH', // out-of-vocab casing → normalized to `high` (AC-8)
  risks: [
    {
      title: 'Config change risk',
      explanation: 'A new limiter config is introduced.',
      severity: 'medium',
      references: [
        { file: 'src/config.ts', line: 4 }, // grounded (a PR changed file)
        { file: 'src/does-not-exist.ts', line: 1 }, // hallucinated → dropped (AC-7)
      ],
    },
  ],
  review_focus: [
    { file: 'src/config.ts', line: 4, reason: 'new limiter config' }, // grounded
    { file: 'src/phantom.ts', line: 9, reason: 'invented' }, // dropped (AC-7)
  ],
};

const blastResult: BlastResult = {
  changedSymbols: [{ file: 'src/middleware/ratelimit.ts', name: 'rateLimit', kind: 'function' }],
  callers: [
    { file: 'src/api/public/webhooks.ts', symbol: 'handler', viaSymbol: 'rateLimit', line: 42, rank: 1 },
  ],
  impactedEndpoints: ['POST /webhooks'],
  factsByFile: { 'src/api/public/webhooks.ts': { endpoints: ['POST /webhooks'], crons: [] } },
};

function makeRepoIntel(): RepoIntel {
  const notImpl = (name: string) => () => {
    throw new Error(`RepoIntel.${name} not stubbed`);
  };
  return {
    indexRepo: notImpl('indexRepo'),
    refreshIndex: notImpl('refreshIndex'),
    getIndexState: notImpl('getIndexState'),
    async getBlastRadius() {
      return blastResult;
    },
    getRepoMap: notImpl('getRepoMap'),
    getFileRank: notImpl('getFileRank'),
    getSymbolsInFiles: notImpl('getSymbolsInFiles'),
    getCallerSignatures: notImpl('getCallerSignatures'),
    getUnresolvedReferences: notImpl('getUnresolvedReferences'),
    getConventionSamples: notImpl('getConventionSamples'),
    getTopFilesByRank: notImpl('getTopFilesByRank'),
    getCriticalPaths: notImpl('getCriticalPaths'),
    getIndexedFiles: notImpl('getIndexedFiles'),
    getFanCounts: notImpl('getFanCounts'),
  } as RepoIntel;
}

const throwingLlm: LLMProvider = {
  id: 'openai',
  async listModels() {
    return [];
  },
  async complete() {
    throw new Error('not used');
  },
  async completeStructured() {
    throw new Error('provider boom');
  },
  async embed() {
    return [];
  },
};

/** GitHub adapter that simulates offline/no-token/API-error: `getIssue` always throws. */
class ThrowingGitHubClient extends MockGitHubClient {
  async getIssue(): Promise<never> {
    throw new Error('GitHub API error (simulated offline/no token)');
  }
}

d('Why+Risk Brief — end-to-end', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;
    const [pr] = await pg.handle.db
      .select()
      .from(t.pullRequests)
      .where(eq(t.pullRequests.number, 482));
    prId = pr!.id;
  });

  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp(llm: LLMProvider, github?: GitHubClient) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient({ files: {} }),
        // No github override needed for the default case: the seeded PR body
        // carries no `#N` ref, so the linked-issue fetch short-circuits before
        // `container.github()` and the issue is omitted fail-soft (AC-4). Tests
        // that need the fetch itself to fail pass an explicit `github` override.
        ...(github ? { github } : {}),
        llm: { openai: llm, openrouter: llm },
        repoIntel: makeRepoIntel(),
      },
    });
  }

  it('generates once, grounds refs, records cost; read makes zero calls (AC-2/4/5/6/7/13)', async () => {
    const mock = new MockLLMProvider('openai', { structured: briefFixture });
    const app = await makeApp(mock);

    const gen = await app.inject({ method: 'POST', url: `/pulls/${prId}/brief`, payload: {} });
    expect(gen.statusCode).toBe(200);

    // AC-5: exactly one structured call for the generation.
    const structured = mock.calls.filter((c) => c.method === 'completeStructured');
    expect(structured).toHaveLength(1);
    // AC-5: low temperature. AC-18: inputs fenced untrusted.
    const req = structured[0]!.req as { temperature: number; messages: { content: string }[] };
    expect(req.temperature).toBe(0);
    expect(req.messages[1]!.content).toContain('<untrusted');
    // AC-1: no raw diff hunks in the assembled input.
    expect(req.messages[1]!.content).not.toContain('@@');

    const body = gen.json() as {
      status: string;
      brief: { risk_level: string; risks: { references: unknown[] }[]; review_focus: { file: string }[] };
      cost: { model: string; tokens_in: number };
    };
    expect(body.status).toBe('fresh');
    // AC-8: out-of-vocab casing normalized.
    expect(body.brief.risk_level).toBe('high');
    // AC-7: hallucinated file ref dropped; only the grounded one survives.
    expect(body.brief.risks[0]!.references).toEqual([{ file: 'src/config.ts', line: 4 }]);
    expect(body.brief.review_focus).toEqual([
      { file: 'src/config.ts', line: 4, reason: 'new limiter config' },
    ]);
    // AC-6: cost/model surfaced.
    expect(body.cost.model).toBeTruthy();
    expect(body.cost.tokens_in).toBeGreaterThan(0);

    // AC-5/13: read returns the stored brief with ZERO additional model calls.
    const read = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    expect(read.statusCode).toBe(200);
    expect(mock.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    expect((read.json() as { status: string }).status).toBe('fresh');

    // AC-6: cost/model persisted on the row.
    const [row] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(row!.costUsd).toBeCloseTo(0.001);
    expect(row!.model).toBeTruthy();
    expect(row!.headSha).toBe(HEAD_1);

    await app.close();
  }, 30_000);

  it('linked issue is referenced but the GitHub fetch fails: omitted, brief still generates (AC-4)', async () => {
    const mock = new MockLLMProvider('openai', { structured: briefFixture });
    // The PR body DOES reference an issue, so `resolveLinkedIssue` reaches
    // `github.getIssue` — which this override throws from, simulating
    // offline/no-token/API-error (unlike the default-app case, which never
    // calls `container.github()` because the seeded PR #482 body has no `#N`).
    const app = await makeApp(mock, new ThrowingGitHubClient());

    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 998,
        title: 'PR referencing an issue',
        author: 'someone',
        branch: 'feat/issue-link',
        base: 'main',
        headSha: 'issue-link-sha',
        body: 'Fixes #7 — needs the linked issue fetched.',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();

    const gen = await app.inject({ method: 'POST', url: `/pulls/${pr!.id}/brief`, payload: {} });

    // AC-4: GitHub unavailable/erroring must not 5xx; the brief still generates.
    expect(gen.statusCode).toBe(200);
    const body = gen.json() as { status: string; brief: unknown };
    expect(body.status).toBe('fresh');
    expect(body.brief).toBeTruthy();

    // Generation did not hang or retry on the failed issue fetch — exactly one
    // structured call still ran, proceeding from the remaining inputs (AC-5).
    const structured = mock.calls.filter((c) => c.method === 'completeStructured');
    expect(structured).toHaveLength(1);

    await app.close();
  }, 30_000);

  it('reports stale after the head advances, then Regenerate refreshes (AC-14/15)', async () => {
    const mock = new MockLLMProvider('openai', { structured: briefFixture });
    const app = await makeApp(mock);

    // The prior test persisted a brief at HEAD_1. Advance the PR head.
    await pg.handle.db
      .update(t.pullRequests)
      .set({ headSha: HEAD_2 })
      .where(eq(t.pullRequests.id, prId));

    const stale = await app.inject({ method: 'GET', url: `/pulls/${prId}/brief` });
    const staleBody = stale.json() as { status: string; brief: unknown; head_sha: string };
    expect(staleBody.status).toBe('stale');
    expect(staleBody.brief).toBeTruthy(); // stored brief still returned
    expect(staleBody.head_sha).toBe(HEAD_1);
    // A stale GET makes no model call.
    expect(mock.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(0);

    // AC-15: Regenerate against the current head.
    const gen = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/brief`,
      payload: { force: true },
    });
    expect(gen.statusCode).toBe(200);
    expect(mock.calls.filter((c) => c.method === 'completeStructured')).toHaveLength(1);
    const freshBody = gen.json() as { status: string; head_sha: string };
    expect(freshBody.status).toBe('fresh');
    expect(freshBody.head_sha).toBe(HEAD_2);

    await app.close();
  }, 30_000);

  it('model failure returns a degraded marker, preserving the prior brief (AC-16)', async () => {
    const app = await makeApp(throwingLlm);

    const [before] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));

    const gen = await app.inject({
      method: 'POST',
      url: `/pulls/${prId}/brief`,
      payload: { force: true },
    });
    // No 5xx — a degraded marker at HTTP 200.
    expect(gen.statusCode).toBe(200);
    const body = gen.json() as { status: string; degraded_reason: string; brief: unknown };
    expect(body.status).toBe('degraded');
    expect(body.degraded_reason).toBe('model_failed');
    // Prior brief preserved in the response.
    expect(body.brief).toBeTruthy();

    // Nothing partial persisted: the row is byte-for-byte the prior one.
    const [after] = await pg.handle.db.select().from(t.prBrief).where(eq(t.prBrief.prId, prId));
    expect(after!.headSha).toBe(before!.headSha);
    expect(after!.generatedAt.getTime()).toBe(before!.generatedAt.getTime());

    await app.close();
  }, 30_000);

  it('a never-generated PR returns not_generated at HTTP 200 (AC-17)', async () => {
    const mock = new MockLLMProvider('openai', { structured: briefFixture });
    const app = await makeApp(mock);

    const [repo] = await pg.handle.db
      .select()
      .from(t.repos)
      .where(eq(t.repos.fullName, 'acme/payments-api'));
    const [fresh] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId,
        repoId: repo!.id,
        number: 999,
        title: 'Never-briefed PR',
        author: 'nobody',
        branch: 'feat/none',
        base: 'main',
        headSha: 'zzz',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();

    const read = await app.inject({ method: 'GET', url: `/pulls/${fresh!.id}/brief` });
    expect(read.statusCode).toBe(200);
    const body = read.json() as { status: string; brief?: unknown };
    expect(body.status).toBe('not_generated');
    expect(body.brief ?? null).toBeNull();

    await app.close();
  }, 30_000);

  it('a cross-workspace PR resolves as 404 (AC-19)', async () => {
    const mock = new MockLLMProvider('openai', { structured: briefFixture });
    // A PR in a SEPARATE workspace than the default request context — a request
    // header can't switch workspaces (LocalNoAuthProvider always resolves the
    // seeded default), so the row must live in another workspace (INSIGHTS:52).
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-brief' })
      .returning();
    const [foreignRepo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: otherWs!.id, owner: 'foreign', name: 'secret', fullName: 'foreign/secret' })
      .returning();
    const [foreignPr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: otherWs!.id,
        repoId: foreignRepo!.id,
        number: 1,
        title: 'foreign',
        author: 'x',
        branch: 'b',
        base: 'main',
        headSha: 'f',
        additions: 0,
        deletions: 0,
        filesCount: 0,
        status: 'needs_review',
      })
      .returning();

    const app = await makeApp(mock);
    const get = await app.inject({ method: 'GET', url: `/pulls/${foreignPr!.id}/brief` });
    expect(get.statusCode).toBe(404);
    const post = await app.inject({ method: 'POST', url: `/pulls/${foreignPr!.id}/brief`, payload: {} });
    expect(post.statusCode).toBe(404);

    await app.close();
  }, 30_000);

  it('the generate route carries a rate-limit override tighter than the global (AC-20)', () => {
    // Rate-limit is disabled under NODE_ENV=test, so assert the override exists
    // and is at least as tight as the 120/min global default.
    expect(BRIEF_GENERATE_RATE_LIMIT.max).toBeLessThanOrEqual(120);
    expect(BRIEF_GENERATE_RATE_LIMIT.max).toBeLessThanOrEqual(10);
    expect(BRIEF_GENERATE_RATE_LIMIT.timeWindow).toBe('1 minute');
  });
});
