import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

/**
 * Smart Diff (L03, task S2) — integration coverage for `SmartDiffService` via
 * `GET /pulls/:id/smart-diff`. DB-backed ⇒ `.it.test.ts` (testcontainers
 * Postgres). Deterministic, compute-on-read — the LLM is always MOCKED
 * (`docs/plans/smart-diff.md` §8) and MUST NEVER be called by this endpoint.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Matches the finding's [10,12] range (grounding gate requires the finding's
 *  new-side lines to intersect a real hunk — new range here is 8..13). */
const DIFF = `diff --git a/src/core/handler.ts b/src/core/handler.ts
--- a/src/core/handler.ts
+++ b/src/core/handler.ts
@@ -8,3 +8,6 @@
   line8,
+  line9,
+  line10,
+  line11,
   line12,
   line13,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 90,
  findings: [
    {
      id: 'f-1',
      severity: 'WARNING',
      category: 'style',
      title: 'Minor nit',
      file: 'src/core/handler.ts',
      start_line: 10,
      end_line: 12,
      rationale: 'A stray inline value.',
      confidence: 0.6,
      kind: 'finding',
    },
  ],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `smart-diff-pr-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 501,
      title: 'Add core handler',
      author: 'marisa.koch',
      branch: 'feat/handler',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 2,
      deletions: 0,
      filesCount: 2,
      status: 'needs_review',
      body: 'Adds a new core handler and a lockfile bump.',
    })
    .returning();
  await db.insert(t.prFiles).values([
    { prId: pr!.id, path: 'src/core/handler.ts', additions: 20, deletions: 0 },
    { prId: pr!.id, path: 'pnpm-lock.yaml', additions: 500, deletions: 0 },
  ]);
  return { repo: repo!, pr: pr! };
}

d('Smart Diff (L03) — service + routes (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function appWith(reviewLlm: MockLLMProvider) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: reviewLlm },
      },
    });
  }

  it('composes groups + non-empty finding_lines from the latest review, with NO LLM call', async () => {
    const reviewLlm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(reviewLlm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'SmartDiffAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    // Run a review so a `kind==='review'` row with findings exists.
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(reviews.length).toBeGreaterThan(0);

    const callsBefore = reviewLlm.calls.length;

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const smartDiff = res.json();

    // No new LLM call was made by the smart-diff read.
    expect(reviewLlm.calls.length).toBe(callsBefore);

    const coreGroup = smartDiff.groups.find((g: { role: string }) => g.role === 'core');
    const boilerplateGroup = smartDiff.groups.find((g: { role: string }) => g.role === 'boilerplate');
    expect(coreGroup).toBeDefined();
    expect(boilerplateGroup).toBeDefined();

    const coreFile = coreGroup.files.find((f: { path: string }) => f.path === 'src/core/handler.ts');
    expect(coreFile).toBeDefined();
    expect(coreFile.finding_lines).toEqual([10, 11, 12]);
    expect(coreFile.pseudocode_summary).toBeNull();

    const lockfile = boilerplateGroup.files.find((f: { path: string }) => f.path === 'pnpm-lock.yaml');
    expect(lockfile).toBeDefined();
    expect(lockfile.finding_lines).toEqual([]);

    // Boilerplate churn (500 lines) is excluded from split_suggestion.total_lines.
    expect(smartDiff.split_suggestion.total_lines).toBe(20);

    await app.close();
  });

  it('a PR with no review returns a valid SmartDiff with empty finding_lines everywhere', async () => {
    const reviewLlm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(reviewLlm);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(200);
    const smartDiff = res.json();

    expect(reviewLlm.calls.length).toBe(0);

    for (const group of smartDiff.groups) {
      for (const file of group.files) {
        expect(file.finding_lines).toEqual([]);
      }
    }

    await app.close();
  });

  it('returns 404 for a PR that belongs to a different workspace than the request context', async () => {
    const reviewLlm = new MockLLMProvider('openai', { structured: REVIEW_FIXTURE });
    const app = await appWith(reviewLlm);

    // The app's LocalNoAuthProvider always resolves the request context to the
    // "default" seeded workspace — so a PR created under a DIFFERENT workspace
    // is invisible to it, matching the sibling intent/reviews 404 tests.
    const [otherWorkspace] = await pg.handle.db.insert(t.workspaces).values({ name: 'other-workspace' }).returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWorkspace!.id);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/smart-diff` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
