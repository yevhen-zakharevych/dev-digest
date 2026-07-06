import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { waitForPrRuns } from './helpers/runs.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { Container } from '../src/platform/container.js';
import { ReviewRepository } from '../src/modules/reviews/repository.js';
import { IntentService } from '../src/modules/reviews/intent.service.js';
import * as t from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import type {
  Intent,
  Review,
  LLMProvider,
  ModelInfo,
  CompletionResult,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

/**
 * Intent Layer (L03, task C2) — integration coverage for `IntentService`, the
 * `/pulls/:id/intent` routes, and the executor's classify-if-missing hook.
 * DB-backed ⇒ `.it.test.ts` (testcontainers Postgres); the LLM is always
 * MOCKED — `docs/plans/intent-layer.md` §10.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** Matches the diff MockGitClient returns for src/config.ts (grounding needs this to line up). */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

/** A Review fixture with one grounded (line 11) finding — keeps the review "green". */
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
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A stray inline value.',
      confidence: 0.6,
      kind: 'finding',
    },
  ],
};

const INTENT_FIXTURE: Intent = {
  intent: 'Add rate limiting to public API endpoints',
  in_scope: ['public API endpoints', 'rate-limit middleware'],
  out_of_scope: ['internal admin API'],
};

/** Throws on every `completeStructured` call — simulates the intent classifier failing. */
class ThrowingLLMProvider implements LLMProvider {
  readonly id: 'openai' | 'anthropic' | 'openrouter' = 'openrouter';
  calls = 0;
  async listModels(): Promise<ModelInfo[]> {
    return [];
  }
  async complete(): Promise<CompletionResult> {
    throw new Error('ThrowingLLMProvider: complete should not be called in this suite');
  }
  async completeStructured<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls++;
    throw new Error('mock intent classification failure');
  }
  async embed(): Promise<number[][]> {
    throw new Error('ThrowingLLMProvider: embed should not be called in this suite');
  }
}

let repoSeq = 0;
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  overrides: { title?: string; body?: string | null } = {},
) {
  const name = `intent-pr-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 482,
      title: overrides.title ?? 'Add rate limiting',
      author: 'marisa.koch',
      branch: 'feat/rl',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: overrides.body ?? 'Add rate limiting to the public API.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/config.ts',
    additions: 1,
    deletions: 0,
    patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
  });
  return { repo: repo!, pr: pr! };
}

d('Intent Layer (L03) — service + routes + executor (Testcontainers pg)', () => {
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

  /** Build a Fastify app with the intent classifier ('openrouter', the default
   *  `review_intent` provider) and the review agent's own provider both mocked. */
  function appWith(opts: {
    intent?: unknown;
    intentLlm?: LLMProvider;
    reviewStructured?: unknown;
    reviewProvider?: 'openai' | 'anthropic';
  }) {
    const reviewProvider = opts.reviewProvider ?? 'openai';
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: {
          [reviewProvider]: new MockLLMProvider(reviewProvider, {
            structured: opts.reviewStructured ?? REVIEW_FIXTURE,
          }),
          openrouter: opts.intentLlm ?? new MockLLMProvider('openai', { structured: opts.intent ?? INTENT_FIXTURE }),
        },
      },
    });
  }

  // ---- getIntent: null before classification, persisted record after upsert ----
  it('getIntent returns null before classification, and the persisted PrIntentRecord after an upsert', async () => {
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const repo = new ReviewRepository(pg.handle.db);
    const container = new Container(config(), pg.handle.db, {});
    const intentService = new IntentService(container, repo);

    const before = await intentService.getIntent(workspaceId, pr.id);
    expect(before).toBeNull();

    await repo.upsertIntent(pr.id, INTENT_FIXTURE);

    const after = await intentService.getIntent(workspaceId, pr.id);
    expect(after).toEqual({ ...INTENT_FIXTURE, pr_id: pr.id });
  });

  // ---- POST classifies + upserts + returns; GET reads it back, no LLM call ----
  it('POST /pulls/:id/intent classifies + upserts + returns the record; GET reads it back with NO LLM call', async () => {
    const app = await appWith({});
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const getBefore = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(getBefore.statusCode).toBe(200);
    expect(getBefore.json()).toBeNull();

    const post = await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    expect(post.statusCode).toBe(200);
    const posted = post.json();
    expect(posted.pr_id).toBe(pr.id);
    expect(posted.intent).toBe(INTENT_FIXTURE.intent);
    expect(posted.in_scope).toEqual(INTENT_FIXTURE.in_scope);
    expect(posted.out_of_scope).toEqual(INTENT_FIXTURE.out_of_scope);

    // Row is actually persisted (not just returned in-memory).
    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row?.intent).toBe(INTENT_FIXTURE.intent);

    const get = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(get.statusCode).toBe(200);
    expect(get.json()).toEqual(posted);

    await app.close();
  });

  it('GET /pulls/:id/intent never calls the LLM, even after a stored classification', async () => {
    const intentLlm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    const app = await appWith({ intentLlm });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });
    const callsAfterPost = intentLlm.calls.length;
    expect(callsAfterPost).toBeGreaterThan(0);

    await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(intentLlm.calls.length).toBe(callsAfterPost);

    await app.close();
  });

  // ---- Executor: classify-if-missing runs once, skips when already stored ----
  it('executor classifies exactly once when intent is missing, and skips classification when intent already exists', async () => {
    const intentLlm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    const app = await appWith({ intentLlm });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'IntentAgent1', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    // First review: no intent stored yet ⇒ executor classifies once.
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(intentLlm.calls.length).toBe(1);

    const [row] = await pg.handle.db.select().from(t.prIntent).where(eq(t.prIntent.prId, pr.id));
    expect(row?.intent).toBe(INTENT_FIXTURE.intent);

    // Second review on the SAME pr: intent already stored ⇒ no additional classify call.
    const agent2 = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'IntentAgent2', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();
    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/review`, payload: { agentId: agent2.id } });
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 2 });
    expect(intentLlm.calls.length).toBe(1);

    await app.close();
  });

  // ---- Classify failure must not fail the review (plan §6/§9/§13) ----
  it('a classify failure does NOT fail the review — the run still completes and intent stays absent', async () => {
    const throwingIntentLlm = new ThrowingLLMProvider();
    const app = await appWith({ intentLlm: throwingIntentLlm });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const agent = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name: 'ResilientAgent', provider: 'openai', model: 'gpt-4.1', system_prompt: 's' },
      })
    ).json();

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);

    const [run] = await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });
    expect(run!.status).toBe('done');
    expect(throwingIntentLlm.calls).toBe(1);

    // The review itself still ran and was persisted, unaffected by the classify failure.
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].verdict).toBe('approve');

    // Intent was never persisted since classification threw.
    const getIntent = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/intent` });
    expect(getIntent.json()).toBeNull();

    await app.close();
  });

  // ---- Plan-priority (§7): hunk headers are truncated first, never the body/plan ----
  it('truncates the hunk-header block before ever truncating the PR body (plan priority, §7)', async () => {
    const intentLlm = new MockLLMProvider('openai', { structured: INTENT_FIXTURE });
    const app = await appWith({ intentLlm });

    // A large-but-under-cap inline "plan" body (well under MAX_BODY_CHARS=20_000,
    // so it is never safety-capped either) — this is the case-1 "inline plan in
    // the PR body" scenario from §6: the plan/spec IS the body, no separate
    // plan-or-spec block is built.
    const planMarker = 'PLAN-MARKER-UNIQUE-9f3c: implement rate limiting exactly as specced below.';
    const body = `${planMarker}\n\n` + 'Design detail line describing the approach.\n'.repeat(300);

    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, {
      title: 'Rate limiting per the attached plan',
      body,
    });

    // Many changed files with verbose hunk headers — full hunk-header text
    // alone comfortably exceeds the token budget left over after the body,
    // forcing the hunk block (and only the hunk block) to be truncated.
    for (let i = 0; i < 300; i++) {
      await pg.handle.db.insert(t.prFiles).values({
        prId: pr.id,
        path: `src/generated/file-${i}.ts`,
        additions: 1,
        deletions: 0,
        patch: `@@ -${i},3 +${i},4 @@ function handler${i}(request, response, next) {\n   line\n+  added\n   line`,
      });
    }

    await app.inject({ method: 'POST', url: `/pulls/${pr.id}/intent` });

    const call = intentLlm.calls.at(-1);
    expect(call).toBeDefined();
    const req = call!.req as { messages: { role: string; content: string }[] };
    const userMessage = req.messages.find((m) => m.role === 'user')!.content;

    // Body/plan text is present IN FULL, byte-for-byte — never truncated.
    expect(userMessage).toContain(planMarker);
    expect(userMessage).toContain(body);

    // Split the message at the changed-files section: everything BEFORE it
    // (title, plan-or-spec, pr-description, linked-issue) must carry no
    // truncation marker; the hunk-header block AFTER it is the one truncated.
    const changedFilesIdx = userMessage.indexOf('Changed files (hunk headers only)');
    expect(changedFilesIdx).toBeGreaterThan(-1);
    expect(userMessage.slice(0, changedFilesIdx)).not.toContain('truncated — token budget');
    expect(userMessage.slice(changedFilesIdx)).toContain('truncated — token budget');

    await app.close();
  });
});
