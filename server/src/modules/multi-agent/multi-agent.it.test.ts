import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from '../../../test/helpers/pg.js';
import { waitForPrRuns } from '../../../test/helpers/runs.js';
import { buildApp } from '../../app.js';
import { loadConfig } from '../../platform/config.js';
import { seed } from '../../db/seed.js';
import * as t from '../../db/schema.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../../adapters/mocks.js';
import type { Review } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[multi-agent] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/** A diff whose only added line is src/config.ts:11 — the grounding gate keeps a
 *  finding there and silently drops anything else, which is exactly why the
 *  column/conflict fixtures below are seeded through the db instead. */
const DIFF = `diff --git a/src/config.ts b/src/config.ts
--- a/src/config.ts
+++ b/src/config.ts
@@ -10,3 +10,4 @@
   port: 3000,
+  stripeKey: "sk_live_xxx",
   redisUrl: x,`;

const REVIEW_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Hardcoded Stripe secret introduced.',
  score: 42,
  findings: [
    {
      id: 'f-valid',
      severity: 'CRITICAL',
      category: 'security',
      title: 'Hardcoded Stripe secret key',
      file: 'src/config.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'A live Stripe key is committed in source.',
      suggestion: 'Move the key to an environment variable.',
      confidence: 0.95,
      kind: 'finding',
    },
  ],
};

d('Multi-Agent Review — create path + read model (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let prSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
      },
    });
  }

  const db = () => pg.handle.db;

  async function makePr(ws = workspaceId) {
    const name = `multi-agent-${prSeq++}`;
    const [repo] = await db()
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await db()
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 100 + prSeq,
        title: 'Add rate limiting',
        author: 'marisa.koch',
        branch: 'feat/rl',
        base: 'main',
        headSha: 'a1b2c3d4',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
      })
      .returning();
    await db().insert(t.prFiles).values({
      prId: pr!.id,
      path: 'src/config.ts',
      additions: 1,
      deletions: 0,
      patch: '@@ -10,3 +10,4 @@\n   port: 3000,\n+  stripeKey: "sk_live_xxx",\n   redisUrl: x,',
    });
    return { repo: repo!, pr: pr! };
  }

  async function makeAgent(name: string, ws = workspaceId) {
    const [agent] = await db()
      .insert(t.agents)
      .values({
        workspaceId: ws,
        name,
        provider: 'openai',
        model: 'gpt-4.1',
        systemPrompt: 'review',
      })
      .returning();
    return agent!;
  }

  /**
   * Seed one finished column DIRECTLY through the db: an `agent_runs` row linked
   * to the multi-run, its `reviews` row and that review's `findings`.
   *
   * NEVER drive a live review run for these fixtures — the grounding gate drops
   * any finding whose lines do not intersect the injected diff hunk, silently and
   * without an error (server/INSIGHTS.md:62), so the conflict assertions would
   * quietly run against an empty set. Finding ids are read back from the insert,
   * never hardcoded (`insertFindings` mints its own uuid).
   */
  async function seedColumn(opts: {
    multiRunId: string | null;
    prId: string;
    agentId: string;
    status: string;
    durationMs?: number | null;
    costUsd?: number | null;
    reviewKind?: 'review' | 'summary';
    score?: number | null;
    findings?: { file: string; startLine: number; severity: string; title: string }[];
  }) {
    const [run] = await db()
      .insert(t.agentRuns)
      .values({
        workspaceId,
        agentId: opts.agentId,
        prId: opts.prId,
        multiAgentRunId: opts.multiRunId,
        provider: 'openai',
        model: 'gpt-4.1',
        status: opts.status,
        durationMs: opts.durationMs ?? null,
        costUsd: opts.costUsd ?? null,
      })
      .returning();

    const [review] = await db()
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: opts.prId,
        agentId: opts.agentId,
        runId: run!.id,
        kind: opts.reviewKind ?? 'review',
        verdict: 'request_changes',
        summary: 'seeded',
        score: opts.score ?? 70,
        model: 'gpt-4.1',
      })
      .returning();

    const findingIds: string[] = [];
    for (const f of opts.findings ?? []) {
      const [row] = await db()
        .insert(t.findings)
        .values({
          reviewId: review!.id,
          file: f.file,
          startLine: f.startLine,
          endLine: f.startLine,
          severity: f.severity,
          category: 'bug',
          title: f.title,
          rationale: 'seeded',
          confidence: 0.8,
        })
        .returning({ id: t.findings.id });
      findingIds.push(row!.id);
    }
    return { runId: run!.id, reviewId: review!.id, findingIds };
  }

  async function createMultiRunRow(prId: string, ws = workspaceId) {
    const [row] = await db().insert(t.multiAgentRuns).values({ workspaceId: ws, prId }).returning();
    return row!;
  }

  // ==========================================================================
  // Create path (AC-3/AC-6 server half, AC-11, AC-25, AC-26)
  // ==========================================================================

  it('creates a multi_agent_runs row and links every launched agent_run at insert time', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const a = await makeAgent('Sec');
    const b = await makeAgent('Perf');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-runs`,
      payload: { agentIds: [a.id, b.id] },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.pr_id).toBe(pr.id);
    expect(body.runs).toHaveLength(2);
    expect(body.runs.map((r: { agent_id: string }) => r.agent_id).sort()).toEqual(
      [a.id, b.id].sort(),
    );

    const [multiRun] = await db()
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.id, body.multi_run_id));
    expect(multiRun!.prId).toBe(pr.id);

    const linked = await db()
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, body.multi_run_id));
    expect(linked).toHaveLength(2);
    // Linked at INSERT time, not by a follow-up UPDATE — no row is ever briefly
    // visible as unlinked, so the read model cannot see a half-formed multi-run.
    expect(linked.every((r) => r.multiAgentRunId === body.multi_run_id)).toBe(true);

    await waitForPrRuns(db(), pr.id, { expected: 2 });
    await app.close();
  });

  it('the single-agent POST /pulls/:id/review path still writes a NULL multi_agent_run_id', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const a = await makeAgent('Solo');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: a.id },
    });
    expect(res.statusCode).toBe(200);

    const runs = await db().select().from(t.agentRuns).where(eq(t.agentRuns.prId, pr.id));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.multiAgentRunId).toBeNull();

    await waitForPrRuns(db(), pr.id, { expected: 1 });
    await app.close();
  });

  it('rejects an empty or missing agentIds with a 400-class validation error', async () => {
    const app = await makeApp();
    const { pr } = await makePr();

    const empty = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-runs`,
      payload: { agentIds: [] },
    });
    expect(empty.statusCode).toBeGreaterThanOrEqual(400);
    expect(empty.statusCode).toBeLessThan(500);

    const missing = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-runs`,
      payload: {},
    });
    expect(missing.statusCode).toBeGreaterThanOrEqual(400);
    expect(missing.statusCode).toBeLessThan(500);

    // Nothing was created for either rejection.
    const rows = await db()
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.prId, pr.id));
    expect(rows).toHaveLength(0);
    await app.close();
  });

  it('an unknown agent id 404s and leaves NO multi_agent_runs row behind', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const a = await makeAgent('Known');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/multi-agent-runs`,
      payload: { agentIds: [a.id, '00000000-0000-0000-0000-000000000000'] },
    });
    expect(res.statusCode).toBe(404);
    const rows = await db()
      .select()
      .from(t.multiAgentRuns)
      .where(eq(t.multiAgentRuns.prId, pr.id));
    expect(rows).toHaveLength(0);
    await app.close();
  });

  // ==========================================================================
  // Workspace scoping (AC-25)
  // ==========================================================================

  it('a PR in another workspace 404s on both routes (real second workspace row)', async () => {
    // A fake auth header does nothing — LocalNoAuthProvider always resolves the
    // single seeded workspace (server/INSIGHTS.md:64). The only way to test this
    // is a genuinely foreign row.
    const app = await makeApp();
    const [otherWs] = await db().insert(t.workspaces).values({ name: 'other-tenant' }).returning();
    const { pr: foreignPr } = await makePr(otherWs!.id);
    const foreignAgent = await makeAgent('Foreign', otherWs!.id);

    const read = await app.inject({
      method: 'GET',
      url: `/pulls/${foreignPr.id}/multi-agent-runs/latest`,
    });
    expect(read.statusCode).toBe(404);

    const create = await app.inject({
      method: 'POST',
      url: `/pulls/${foreignPr.id}/multi-agent-runs`,
      payload: { agentIds: [foreignAgent.id] },
    });
    expect(create.statusCode).toBe(404);
    await app.close();
  });

  it("another workspace's multi-run is never surfaced on this workspace's PR", async () => {
    const app = await makeApp();
    const [otherWs] = await db().insert(t.workspaces).values({ name: 'other-tenant-2' }).returning();
    const { pr } = await makePr();
    // A multi-run row for OUR pr, owned by a different workspace.
    await createMultiRunRow(pr.id, otherWs!.id);

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/multi-agent-runs/latest`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    await app.close();
  });

  // ==========================================================================
  // Read model (AC-13, AC-14, AC-15, AC-16, AC-24)
  // ==========================================================================

  it('a PR with no multi-run reads as null with a 200, not a 404', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/multi-agent-runs/latest`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
    await app.close();
  });

  it('composes columns from agent_runs + the run review, with SUM duration and SUM cost', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const alpha = await makeAgent('Alpha');
    const beta = await makeAgent('Beta');
    const multiRun = await createMultiRunRow(pr.id);

    await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: alpha.id,
      status: 'done',
      durationMs: 8000,
      costUsd: 0.04,
      score: 65,
      findings: [
        { file: 'src/pay.ts', startLine: 41, severity: 'CRITICAL', title: 'Secret key' },
      ],
    });
    await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: beta.id,
      status: 'done',
      durationMs: 3000,
      costUsd: 0.02,
      score: 80,
      findings: [],
    });

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/multi-agent-runs/latest`,
    });
    expect(res.statusCode).toBe(200);
    const run = res.json();

    expect(run.id).toBe(multiRun.id);
    expect(run.pr_id).toBe(pr.id);
    expect(run.pr_number).toBe(pr.number);
    expect(run.agent_count).toBe(2);
    // SUM, not MAX — `modules/reviews/run-executor.ts:129` awaits each agent in
    // turn, so wall clock is every agent added together, not the slowest one.
    expect(run.total_duration_ms).toBe(11000);
    expect(run.total_cost_usd).toBeCloseTo(0.06, 6);

    const byName = Object.fromEntries(
      run.columns.map((c: { agent_name: string }) => [c.agent_name, c]),
    );
    expect(byName.Alpha).toMatchObject({
      status: 'done',
      provider: 'openai',
      model: 'gpt-4.1',
      verdict: 'request_changes',
      score: 65,
      summary: 'seeded',
      duration_ms: 8000,
    });
    expect(byName.Alpha.findings).toHaveLength(1);
    expect(byName.Alpha.findings[0]).toMatchObject({
      file: 'src/pay.ts',
      start_line: 41,
      severity: 'CRITICAL',
    });
    expect(byName.Beta.findings).toEqual([]);
    await app.close();
  });

  it('total_duration_ms is 0 (never null) and total_cost_usd is null when nothing finished', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const alpha = await makeAgent('Fresh');
    const multiRun = await createMultiRunRow(pr.id);
    await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: alpha.id,
      status: 'running',
      durationMs: null,
      costUsd: null,
    });

    const run = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent-runs/latest` })
    ).json();
    expect(run.total_duration_ms).toBe(0);
    expect(run.total_cost_usd).toBeNull();
    await app.close();
  });

  it('maps an unrecognised agent_runs.status onto `running` instead of 500ing the response', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const alpha = await makeAgent('Weird');
    const multiRun = await createMultiRunRow(pr.id);
    // `agent_runs.status` is free-form text(); an unmapped literal reaching the
    // 4-literal enum fails RESPONSE serialization with a 500 (§4 Q8).
    await seedColumn({ multiRunId: multiRun.id, prId: pr.id, agentId: alpha.id, status: 'queued' });
    await db()
      .update(t.agentRuns)
      .set({ status: null })
      .where(
        and(eq(t.agentRuns.multiAgentRunId, multiRun.id), eq(t.agentRuns.agentId, alpha.id)),
      );

    const res = await app.inject({
      method: 'GET',
      url: `/pulls/${pr.id}/multi-agent-runs/latest`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().columns[0].status).toBe('running');
    await app.close();
  });

  it('a newer multi-run supersedes the older one and deletes nothing (AC-13)', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const alpha = await makeAgent('First');
    const beta = await makeAgent('Second');

    const older = await createMultiRunRow(pr.id);
    const olderRun = await seedColumn({
      multiRunId: older.id,
      prId: pr.id,
      agentId: alpha.id,
      status: 'done',
      durationMs: 1000,
    });

    // `ranAt` defaults to now(); force a distinctly older timestamp so the
    // ordering assertion does not depend on sub-millisecond insert timing.
    await db()
      .update(t.multiAgentRuns)
      .set({ ranAt: new Date(Date.now() - 60_000) })
      .where(eq(t.multiAgentRuns.id, older.id));

    const newer = await createMultiRunRow(pr.id);
    await seedColumn({
      multiRunId: newer.id,
      prId: pr.id,
      agentId: beta.id,
      status: 'done',
      durationMs: 2000,
    });

    const run = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent-runs/latest` })
    ).json();
    expect(run.id).toBe(newer.id);
    expect(run.columns.map((c: { agent_name: string }) => c.agent_name)).toEqual(['Second']);

    // The superseded multi-run's rows still exist and stay readable in history.
    const stillLinked = await db()
      .select()
      .from(t.agentRuns)
      .where(eq(t.agentRuns.multiAgentRunId, older.id));
    expect(stillLinked.map((r) => r.id)).toEqual([olderRun.runId]);

    const history = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/runs` })).json();
    expect(history.map((r: { run_id: string }) => r.run_id)).toContain(olderRun.runId);
    await app.close();
  });

  it('picks the run\'s most recent kind="review", falling back to any kind, else null/empty', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const alpha = await makeAgent('Multi-review');
    const bare = await makeAgent('No-review');
    const multiRun = await createMultiRunRow(pr.id);

    const seeded = await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: alpha.id,
      status: 'done',
      reviewKind: 'summary',
      score: 10,
    });
    // `reviews.runId` has no FK and no unique index — a run may resolve to
    // several review rows (server/INSIGHTS.md:30). The kind='review' one wins.
    const [winner] = await db()
      .insert(t.reviews)
      .values({
        workspaceId,
        prId: pr.id,
        agentId: alpha.id,
        runId: seeded.runId,
        kind: 'review',
        verdict: 'approve',
        summary: 'the real review',
        score: 91,
        model: 'gpt-4.1',
      })
      .returning();
    expect(winner!.id).not.toBe(seeded.reviewId);

    // A linked run with no review at all still renders as a column.
    await db().insert(t.agentRuns).values({
      workspaceId,
      agentId: bare.id,
      prId: pr.id,
      multiAgentRunId: multiRun.id,
      provider: 'openai',
      model: 'gpt-4.1',
      status: 'done',
    });

    const run = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent-runs/latest` })
    ).json();
    const byName = Object.fromEntries(
      run.columns.map((c: { agent_name: string }) => [c.agent_name, c]),
    );
    expect(byName['Multi-review']).toMatchObject({ summary: 'the real review', score: 91 });
    expect(byName['No-review']).toMatchObject({ verdict: null, score: null, summary: null });
    expect(byName['No-review'].findings).toEqual([]);
    await app.close();
  });

  // ==========================================================================
  // Conflicts over the composed columns (AC-20, AC-21, AC-24, AC-12)
  // ==========================================================================

  it('groups co-located findings, reports "ignored" for a silent done agent, and skips a running one', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const alpha = await makeAgent('Alpha');
    const beta = await makeAgent('Beta');
    const gamma = await makeAgent('Gamma');
    const delta = await makeAgent('Delta');
    const multiRun = await createMultiRunRow(pr.id);

    await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: alpha.id,
      status: 'done',
      findings: [
        { file: 'src/pay.ts', startLine: 41, severity: 'CRITICAL', title: 'Secret key' },
        { file: 'src/pay.ts', startLine: 42, severity: 'WARNING', title: 'Adjacent line' },
      ],
    });
    await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: beta.id,
      status: 'done',
      findings: [{ file: 'src/pay.ts', startLine: 41, severity: 'SUGGESTION', title: 'Style nit' }],
    });
    // Done with zero findings ⇒ "did not flag" everywhere.
    await seedColumn({ multiRunId: multiRun.id, prId: pr.id, agentId: gamma.id, status: 'done' });
    // Still running ⇒ no take at all, and its findings form no bucket.
    await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: delta.id,
      status: 'running',
      findings: [{ file: 'src/ghost.ts', startLine: 3, severity: 'CRITICAL', title: 'Not yet' }],
    });

    const run = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent-runs/latest` })
    ).json();

    expect(run.conflicts.map((c: { file: string; line: number }) => [c.file, c.line])).toEqual([
      ['src/pay.ts', 41],
      ['src/pay.ts', 42],
    ]);

    const group = run.conflicts[0];
    expect(group.title).toBe('Secret key');
    const verdicts = Object.fromEntries(
      group.takes.map((t: { persona: string; verdict: string }) => [t.persona, t.verdict]),
    );
    expect(verdicts).toEqual({ Alpha: 'CRITICAL', Beta: 'SUGGESTION', Gamma: 'ignored' });
    expect(group.takes.find((t: { persona: string }) => t.persona === 'Delta')).toBeUndefined();
    expect(group.takes.find((t: { persona: string }) => t.persona === 'Gamma').note).toBe('');

    // AC-12: the overlay merged/dropped nothing — every seeded finding of a done
    // column is still attributed to exactly one column.
    const perAgent = Object.fromEntries(
      run.columns.map((c: { agent_name: string; findings: unknown[] }) => [
        c.agent_name,
        c.findings.length,
      ]),
    );
    expect(perAgent).toEqual({ Alpha: 2, Beta: 1, Gamma: 0, Delta: 1 });
    await app.close();
  });

  it('is stable: reading the same multi-run twice yields byte-identical conflicts', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const alpha = await makeAgent('Alpha');
    const beta = await makeAgent('Beta');
    const multiRun = await createMultiRunRow(pr.id);
    await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: alpha.id,
      status: 'done',
      findings: [{ file: 'src/z.ts', startLine: 2, severity: 'WARNING', title: 'Z' }],
    });
    await seedColumn({
      multiRunId: multiRun.id,
      prId: pr.id,
      agentId: beta.id,
      status: 'done',
      findings: [{ file: 'src/a.ts', startLine: 2, severity: 'CRITICAL', title: 'A' }],
    });

    const url = `/pulls/${pr.id}/multi-agent-runs/latest`;
    const first = (await app.inject({ method: 'GET', url })).json();
    const second = (await app.inject({ method: 'GET', url })).json();
    expect(JSON.stringify(second.conflicts)).toBe(JSON.stringify(first.conflicts));
    await app.close();
  });

  it('runs from OTHER multi-runs and unlinked runs never leak into the columns', async () => {
    const app = await makeApp();
    const { pr } = await makePr();
    const alpha = await makeAgent('Mine');
    const stray = await makeAgent('Stray');

    const mine = await createMultiRunRow(pr.id);
    await seedColumn({ multiRunId: mine.id, prId: pr.id, agentId: alpha.id, status: 'done' });
    // A legacy, pre-feature run on the same PR: NULL link, never shown.
    await seedColumn({ multiRunId: null, prId: pr.id, agentId: stray.id, status: 'done' });

    const run = (
      await app.inject({ method: 'GET', url: `/pulls/${pr.id}/multi-agent-runs/latest` })
    ).json();
    expect(run.columns.map((c: { agent_name: string }) => c.agent_name)).toEqual(['Mine']);
    await app.close();
  });
});
