import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

/**
 * REST bridge endpoints for the (now-standalone) MCP server — integration
 * coverage for the 3 cheap DB-read routes that back it:
 *   E1  GET /repos/resolve?slug=owner/name        → { id }
 *   E2  GET /repos/:id/pulls/resolve?number=N      → { id }
 *   E3  GET /runs/:id/review                       → ReviewDto (+findings)
 *
 * DB-backed ⇒ `.it.test.ts` (testcontainers Postgres). None of these routes
 * call the LLM, so no `LLMProvider` is mocked/wired — mirrors
 * `test/blast.it.test.ts`'s `buildApp({ config, db })` with no overrides.
 *
 * For E3, the review + finding are inserted DIRECTLY via Drizzle (bypassing
 * a real review run and `groundFindings()` entirely) rather than driving a
 * mocked LLM run through a diff — deliberate per the grounding-gate landmine
 * (`server/INSIGHTS.md:50`): a fixture finding whose lines don't intersect an
 * injected diff hunk is silently dropped, and this suite doesn't need to
 * exercise grounding at all, only the read-back mapping to `ReviewDto`.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

/** Seed a fresh repo + PR (unique per call) under the given workspace. */
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const n = repoSeq++;
  const name = `bridge-repo-${n}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 900 + n,
      title: 'Bridge endpoint fixture PR',
      author: 'dev.one',
      branch: 'feat/bridge',
      base: 'main',
      headSha: 'cafef00d',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Fixture PR for the REST bridge endpoints.',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('REST bridge endpoints for MCP (repos/resolve, pulls/resolve, runs/:id/review)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
    app = await buildApp({ config: config(), db: pg.handle.db });
  });
  afterAll(async () => {
    await app?.close();
    await pg?.stop();
  });

  // ---- E1: GET /repos/resolve --------------------------------------------
  describe('GET /repos/resolve', () => {
    it('returns the internal id for a known owner/name slug', async () => {
      const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);

      const res = await app.inject({
        method: 'GET',
        url: `/repos/resolve?slug=${encodeURIComponent(repo.fullName)}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: repo.id });
    });

    it('returns 404 for an unknown slug', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/repos/resolve?slug=${encodeURIComponent('acme/does-not-exist')}`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ---- E2: GET /repos/:id/pulls/resolve ------------------------------------
  describe('GET /repos/:id/pulls/resolve', () => {
    it('returns the internal id for a known PR number under the repo', async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/pulls/resolve?number=${pr.number}`,
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ id: pr.id });
    });

    it('returns 404 for an unknown PR number under a known repo', async () => {
      const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);

      const res = await app.inject({
        method: 'GET',
        url: `/repos/${repo.id}/pulls/resolve?number=999999`,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ---- E3: GET /runs/:id/review --------------------------------------------
  describe('GET /runs/:id/review', () => {
    it('returns the full ReviewDto (with non-empty findings) for a completed run', async () => {
      const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const runId = randomUUID();

      const [review] = await pg.handle.db
        .insert(t.reviews)
        .values({
          workspaceId,
          prId: pr.id,
          agentId: null,
          runId,
          kind: 'review',
          verdict: 'approve',
          summary: 'Looks fine overall, one nit.',
          score: 88,
          model: 'gpt-4.1',
        })
        .returning();

      const [findingRow] = await pg.handle.db
        .insert(t.findings)
        .values({
          reviewId: review!.id,
          file: 'src/bridge/target.ts',
          startLine: 21,
          endLine: 21,
          severity: 'WARNING',
          category: 'security',
          title: 'Hardcoded debug token',
          rationale: 'A debug token literal was added inline.',
          suggestion: null,
          confidence: 0.7,
          kind: 'finding',
        })
        .returning();

      const res = await app.inject({ method: 'GET', url: `/runs/${runId}/review` });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toMatchObject({
        id: review!.id,
        pr_id: pr.id,
        run_id: runId,
        verdict: 'approve',
      });
      expect(body.findings).toHaveLength(1);
      expect(body.findings[0]).toMatchObject({
        id: findingRow!.id,
        review_id: review!.id,
        severity: 'WARNING',
        category: 'security',
        title: 'Hardcoded debug token',
        file: 'src/bridge/target.ts',
        start_line: 21,
        end_line: 21,
      });
    });

    it('returns 404 for a syntactically valid but nonexistent run id', async () => {
      const unknownRunId = randomUUID();

      const res = await app.inject({ method: 'GET', url: `/runs/${unknownRunId}/review` });

      expect(res.statusCode).toBe(404);
    });
  });
});
