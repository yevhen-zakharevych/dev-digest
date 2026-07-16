import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient, MockLLMProvider } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { EvalRepository } from '../src/modules/eval/repository.js';
import { EvalService } from '../src/modules/eval/service.js';
import type {
  CompletionRequest,
  CompletionResult,
  EvalCase,
  EvalRunDetail,
  GitClient,
  GitHubClient,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

/**
 * T19 — eval pipeline integration tests (server/test/eval-pipeline.it.test.ts).
 *
 * INTEGRATION ONLY. The unit tests for the scorer/fingerprint/diff-freeze/
 * compare/effective-config resolver are colocated by T4/T5/T6/T7
 * (`src/modules/eval/*.test.ts`, `src/modules/agents/effective-config.test.ts`)
 * and are NOT duplicated here — `verify:l06` runs both lanes (see
 * `package.json`).
 *
 * The LLM is ALWAYS mocked (`MockLLMProvider` / local scripted providers).
 * Every assertion is on the DETERMINISTIC half: HTTP status, persisted rows,
 * named error codes, and run lifecycle state — never model prose, never a
 * metric produced by a real model (that is `eval-scoring.it.test.ts`'s job).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-pipeline] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A unified diff with one hunk on `file` whose new-side line `line` is
 * covered — the minimum a case's frozen diff needs to satisfy AC-7's
 * validator for a `finding`-kind expected item at that exact line.
 */
function diffFor(file: string, line: number): string {
  const start = Math.max(1, line - 1);
  return [
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    `@@ -${start},2 +${start},3 @@`,
    ' context before',
    `+added line ${line}`,
    ' context after',
  ].join('\n');
}

function okReview(file: string, line: number): Review {
  return {
    verdict: 'comment',
    summary: 'ok',
    score: 90,
    findings: [
      {
        id: `f-${file}-${line}`,
        severity: 'WARNING',
        category: 'bug',
        title: `Finding at ${file}:${line}`,
        file,
        start_line: line,
        end_line: line,
        rationale: 'test fixture finding',
        confidence: 0.9,
        kind: 'finding',
      },
    ],
  };
}

/** Every method throws — proves a code path never calls it (AC-6). */
function throwingAdapter<T extends object>(label: string): T {
  return new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`${label} must not be called for a frozen eval case (AC-6)`);
      },
    },
  ) as T;
}

/** Blocks its first `completeStructured` call on a manually-released gate — deterministic control over an in-flight run. */
class GatedLLMProvider implements LLMProvider {
  readonly id: 'openai' = 'openai';
  calls = 0;
  private release!: () => void;
  private gate: Promise<void>;

  constructor(private fixture: Review) {
    this.gate = new Promise((resolve) => {
      this.release = resolve;
    });
  }

  releaseGate(): void {
    this.release();
  }

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: 'x', model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0 };
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls++;
    await this.gate;
    const parsed = (req.schema as z.ZodType<T>).safeParse(this.fixture);
    if (!parsed.success) throw new Error(`GatedLLMProvider fixture failed schema: ${parsed.error.message}`);
    return { data: parsed.data, model: req.model, tokensIn: 10, tokensOut: 10, costUsd: 0.001, raw: '', attempts: 1 };
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0]);
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil: condition never became true');
    await new Promise((r) => setTimeout(r, 10));
  }
}

const TERMINAL = new Set(['done', 'failed', 'cancelled']);

async function pollRun(app: FastifyInstance, runId: string, timeoutMs = 10_000): Promise<EvalRunDetail> {
  const start = Date.now();
  for (;;) {
    const res = await app.inject({ method: 'GET', url: `/eval/runs/${runId}` });
    const body = res.json<EvalRunDetail>();
    if (TERMINAL.has(body.status)) return body;
    if (Date.now() - start > timeoutMs) return body;
    await new Promise((r) => setTimeout(r, 25));
  }
}

d('Eval pipeline (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let repoSeq = 0;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces).where(eq(t.workspaces.name, 'default'));
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const agentsRepo = () => new AgentsRepository(pg.handle.db);
  const evalRepo = () => new EvalRepository(pg.handle.db);

  function appWith(opts: {
    llm?: Partial<Record<'openai' | 'anthropic' | 'openrouter', LLMProvider>>;
    git?: GitClient;
    github?: GitHubClient;
  } = {}) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: opts });
  }

  async function setupRepoAndPr(ws: string) {
    const name = `eval-pipeline-${repoSeq++}`;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({ workspaceId: ws, owner: 'acme', name, fullName: `acme/${name}` })
      .returning();
    const [pr] = await pg.handle.db
      .insert(t.pullRequests)
      .values({
        workspaceId: ws,
        repoId: repo!.id,
        number: 1,
        title: 'A change',
        author: 'dev',
        branch: 'feat/x',
        base: 'main',
        headSha: 'abc123',
        additions: 1,
        deletions: 0,
        filesCount: 1,
        status: 'needs_review',
        body: 'body',
      })
      .returning();
    return { repo: repo!, pr: pr! };
  }

  /** Inserts a review + one finding directly (sidesteps the review engine entirely). */
  async function insertFinding(
    ws: string,
    prId: string,
    agentId: string,
    opts: {
      file: string;
      startLine: number;
      endLine: number;
      acceptedAt?: Date | null;
      dismissedAt?: Date | null;
    },
  ) {
    const [review] = await pg.handle.db
      .insert(t.reviews)
      .values({ workspaceId: ws, prId, agentId, kind: 'review', verdict: 'request_changes', summary: 's', score: 50 })
      .returning();
    const [finding] = await pg.handle.db
      .insert(t.findings)
      .values({
        reviewId: review!.id,
        file: opts.file,
        startLine: opts.startLine,
        endLine: opts.endLine,
        severity: 'WARNING',
        category: 'bug',
        title: 'A finding',
        rationale: 'Original agent rationale.',
        confidence: 0.8,
        kind: 'finding',
        acceptedAt: opts.acceptedAt ?? null,
        dismissedAt: opts.dismissedAt ?? null,
      })
      .returning();
    return finding!;
  }

  async function makeAgent(ws: string, name: string) {
    return agentsRepo().insert({
      workspaceId: ws,
      name,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'Review the diff.',
    });
  }

  // =========================================================================
  // AC-39 — workspace isolation
  // =========================================================================

  it('a case/run in another workspace, and a finding in another workspace, all resolve as 404 (AC-39)', async () => {
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `eval-other-${Date.now()}` })
      .returning();
    const foreignAgent = await makeAgent(otherWs!.id, 'Foreign agent');
    const { pr } = await setupRepoAndPr(otherWs!.id);
    const foreignFinding = await insertFinding(otherWs!.id, pr.id, foreignAgent.id, {
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      acceptedAt: new Date(),
    });

    const foreignCase = await evalRepo().insertCase(otherWs!.id, {
      ownerKind: 'agent',
      ownerId: foreignAgent.id,
      name: 'foreign case',
      expectation: 'must_find',
      inputDiff: diffFor('src/config.ts', 11),
      expectedOutput: [{ file: 'src/config.ts', start_line: 11, end_line: 11, kind: 'finding' }],
      inputFingerprint: 'fp-foreign',
    });
    const foreignRun = await evalRepo().createRun(otherWs!.id, {
      agentId: foreignAgent.id,
      agentVersion: 1,
      effectiveConfig: {
        system_prompt: 'x',
        provider: 'openai',
        model: 'gpt-4.1',
        strategy: 'auto',
        repo_intel: false,
        skills: [],
      },
      casesTotal: 1,
    });

    const app = await appWith();
    expect((await app.inject({ method: 'GET', url: `/eval/cases/${foreignCase.id}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/eval/runs/${foreignRun.id}` })).statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${foreignAgent.id}/eval/cases` })).statusCode,
    ).toBe(404);
    const seedRes = await app.inject({
      method: 'POST',
      url: '/eval/cases/from-finding',
      payload: { finding_id: foreignFinding.id },
    });
    expect(seedRes.statusCode).toBe(404);
    await app.close();
  });

  // =========================================================================
  // AC-40 — v1 accepts only an agent owner
  // =========================================================================

  it('a skill owner is rejected, naming the reason (AC-40)', async () => {
    const app = await appWith();
    const [skill] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name: 'Some skill',
        description: '',
        type: 'rubric',
        source: 'manual',
        body: 'body',
        version: 1,
      })
      .returning();

    const service = new EvalService(app.container);
    await expect(
      service.createCase(workspaceId, {
        owner_kind: 'skill',
        owner_id: skill!.id,
        name: 'x',
        expectation: 'must_find',
        input_diff: diffFor('src/x.ts', 5),
        expected_output: [{ file: 'src/x.ts', start_line: 5, end_line: 5, kind: 'finding' }],
      }),
    ).rejects.toMatchObject({ code: 'eval_skill_owner_unsupported', statusCode: 400 });

    const rows = await pg.handle.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'skill'), eq(t.evalCases.ownerId, skill!.id)));
    expect(rows).toEqual([]);
    await app.close();
  });

  // =========================================================================
  // AC-2 — undecided finding
  // =========================================================================

  it('seeding an undecided finding is rejected and creates no case (AC-2)', async () => {
    const agent = await makeAgent(workspaceId, `Undecided-${Date.now()}`);
    const { pr } = await setupRepoAndPr(workspaceId);
    const finding = await insertFinding(workspaceId, pr.id, agent.id, {
      file: 'src/undecided.ts',
      startLine: 5,
      endLine: 5,
    });

    const app = await appWith({ git: new MockGitClient({ diff: diffFor('src/undecided.ts', 5) }) });
    const res = await app.inject({
      method: 'POST',
      url: '/eval/cases/from-finding',
      payload: { finding_id: finding.id },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('eval_finding_undecided');

    const cases = await evalRepo().listCasesForOwner(workspaceId, 'agent', agent.id);
    expect(cases).toEqual([]);
    await app.close();
  });

  // =========================================================================
  // AC-8 — one case per source finding
  // =========================================================================

  it('seeding the same finding twice yields one case; the second call surfaces it (AC-8)', async () => {
    const agent = await makeAgent(workspaceId, `Dup-${Date.now()}`);
    const { pr } = await setupRepoAndPr(workspaceId);
    const finding = await insertFinding(workspaceId, pr.id, agent.id, {
      file: 'src/dup.ts',
      startLine: 7,
      endLine: 7,
      acceptedAt: new Date(),
    });

    const app = await appWith({ git: new MockGitClient({ diff: diffFor('src/dup.ts', 7) }) });
    const first = await app.inject({
      method: 'POST',
      url: '/eval/cases/from-finding',
      payload: { finding_id: finding.id },
    });
    expect(first.statusCode).toBe(200);
    const firstBody = first.json<{ case: EvalCase; created: boolean }>();
    expect(firstBody.created).toBe(true);

    const second = await app.inject({
      method: 'POST',
      url: '/eval/cases/from-finding',
      payload: { finding_id: finding.id },
    });
    expect(second.statusCode).toBe(200);
    const secondBody = second.json<{ case: EvalCase; created: boolean }>();
    expect(secondBody.created).toBe(false);
    expect(secondBody.case.id).toBe(firstBody.case.id);

    const cases = await evalRepo().listCasesForOwner(workspaceId, 'agent', agent.id);
    expect(cases).toHaveLength(1);
    await app.close();
  });

  // =========================================================================
  // AC-7 — unsatisfiable diff is rejected, no case persisted
  // =========================================================================

  it('a diff missing the finding’s file is rejected and NO case is persisted (AC-7)', async () => {
    const agent = await makeAgent(workspaceId, `Unsat-${Date.now()}`);
    const { pr } = await setupRepoAndPr(workspaceId);
    const finding = await insertFinding(workspaceId, pr.id, agent.id, {
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      acceptedAt: new Date(),
    });

    // The captured diff covers a DIFFERENT file entirely — the concrete cause
    // AC-7 names (a large diff whose patch GitHub omitted).
    const app = await appWith({ git: new MockGitClient({ diff: diffFor('other/unrelated.ts', 5) }) });
    const res = await app.inject({
      method: 'POST',
      url: '/eval/cases/from-finding',
      payload: { finding_id: finding.id },
    });
    // `ValidationError` (422) — the freeze rejection is a validation failure,
    // distinct from the plain 400 `AppError`s used elsewhere in this module.
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.error.code).toBe('validation_error');
    expect(body.error.details.reason).toBe('file_missing');
    expect(body.error.details.file).toBe('src/config.ts');

    const cases = await evalRepo().listCasesForOwner(workspaceId, 'agent', agent.id);
    expect(cases).toEqual([]);
    await app.close();
  });

  // =========================================================================
  // AC-6 — a frozen case's run needs no live repo, no clone, no GitHub call
  // =========================================================================

  it('a run over a case whose repo was deleted still completes — no clone, no GitHub call (AC-6)', async () => {
    const agent = await makeAgent(workspaceId, `RepoGone-${Date.now()}`);
    const { repo, pr } = await setupRepoAndPr(workspaceId);
    const finding = await insertFinding(workspaceId, pr.id, agent.id, {
      file: 'src/config.ts',
      startLine: 11,
      endLine: 11,
      acceptedAt: new Date(),
    });

    // Seed with a REAL diff, on an app whose git IS wired.
    const seedApp = await appWith({
      git: new MockGitClient({ diff: diffFor('src/config.ts', 11) }),
      github: new MockGitHubClient(),
    });
    const seeded = await seedApp.inject({
      method: 'POST',
      url: '/eval/cases/from-finding',
      payload: { finding_id: finding.id },
    });
    expect(seeded.statusCode).toBe(200);
    await seedApp.close();

    // Delete the repo — cascades repo -> pull_requests -> reviews -> findings.
    await pg.handle.db.delete(t.repos).where(eq(t.repos.id, repo.id));
    const stillThere = await pg.handle.db.select().from(t.repos).where(eq(t.repos.id, repo.id));
    expect(stillThere).toEqual([]);

    // Run on a SECOND app whose git/github THROW on any call — proves the run
    // path never touches them.
    const runApp = await appWith({
      git: throwingAdapter<GitClient>('git'),
      github: throwingAdapter<GitHubClient>('github'),
      llm: { openai: new MockLLMProvider('openai', { structured: okReview('src/config.ts', 11) }) },
    });
    const started = await runApp.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    expect(started.statusCode).toBe(200);
    const run = await pollRun(runApp, started.json<EvalRunDetail>().id);

    expect(run.status).toBe('done');
    expect(run.errored_count).toBe(0);
    expect(run.traces_total).toBe(1);
    expect(run.traces_passed).toBe(1);
    await runApp.close();
  });

  // =========================================================================
  // AC-13 — at most one in-flight run per agent
  // =========================================================================

  it('a second run while one is in flight is rejected, naming the run (AC-13)', async () => {
    const agent = await makeAgent(workspaceId, `InFlight-${Date.now()}`);
    const provider = new GatedLLMProvider(okReview('src/inflight.ts', 4));
    const app = await appWith({ llm: { openai: provider } });

    const caseRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval/cases`,
      payload: {
        name: 'inflight case',
        expectation: 'must_find',
        input_diff: diffFor('src/inflight.ts', 4),
        expected_output: [{ file: 'src/inflight.ts', start_line: 4, end_line: 4, kind: 'finding' }],
      },
    });
    expect(caseRes.statusCode).toBe(201);

    const first = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    expect(first.statusCode).toBe(200);
    const runId = first.json<EvalRunDetail>().id;

    const second = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    expect(second.statusCode).toBe(409);
    expect(second.json().error.code).toBe('eval_run_in_flight');
    expect(second.json().error.details.run_id).toBe(runId);

    provider.releaseGate();
    await pollRun(app, runId);
    await app.close();
  });

  // =========================================================================
  // AC-12 — cancel
  // =========================================================================

  it('cancelling an in-flight run marks it cancelled and makes no further model call (AC-12)', async () => {
    const agent = await makeAgent(workspaceId, `Cancel-${Date.now()}`);
    const provider = new GatedLLMProvider(okReview('src/cancel-a.ts', 3));
    const app = await appWith({ llm: { openai: provider } });

    for (const file of ['src/cancel-a.ts', 'src/cancel-b.ts']) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agent.id}/eval/cases`,
        payload: {
          name: `case for ${file}`,
          expectation: 'must_find',
          input_diff: diffFor(file, 3),
          expected_output: [{ file, start_line: 3, end_line: 3, kind: 'finding' }],
        },
      });
      expect(res.statusCode).toBe(201);
    }

    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    expect(started.statusCode).toBe(200);
    const runId = started.json<EvalRunDetail>().id;

    // Wait until the FIRST case's model call has actually started (in-process,
    // fire-and-forget executor — the counter is directly observable).
    await waitUntil(() => provider.calls >= 1);

    const cancelled = await app.inject({ method: 'POST', url: `/eval/runs/${runId}/cancel` });
    expect(cancelled.statusCode).toBe(200);

    // Release the first (already in-flight) call; the between-case cancellation
    // checkpoint must stop the SECOND case's call from ever happening.
    provider.releaseGate();
    const run = await pollRun(app, runId);

    expect(run.status).toBe('cancelled');
    expect(provider.calls).toBe(1);
    await app.close();
  });

  // =========================================================================
  // AC-14 — editing a case changes its fingerprint
  // =========================================================================

  it('editing a case’s diff changes its fingerprint, and a re-run records the NEW one (AC-14)', async () => {
    const agent = await makeAgent(workspaceId, `Fingerprint-${Date.now()}`);
    const app = await appWith({
      llm: { openai: new MockLLMProvider('openai', { structured: okReview('src/edit.ts', 10) }) },
    });

    const created = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval/cases`,
      payload: {
        name: 'edit-me',
        expectation: 'must_find',
        input_diff: diffFor('src/edit.ts', 10),
        expected_output: [{ file: 'src/edit.ts', start_line: 10, end_line: 10, kind: 'finding' }],
      },
    });
    expect(created.statusCode).toBe(201);
    const caseId = created.json<EvalCase>().id;
    const fpBefore = created.json<EvalCase>().input_fingerprint;

    const run1Started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    const run1 = await pollRun(app, run1Started.json<EvalRunDetail>().id);
    expect(run1.status).toBe('done');
    const run1Fp = run1.results.find((r) => r.case_id === caseId)!.fingerprint;
    expect(run1Fp).toBe(fpBefore);

    const edited = await app.inject({
      method: 'PUT',
      url: `/eval/cases/${caseId}`,
      payload: {
        input_diff: diffFor('src/edit.ts', 20),
        expected_output: [{ file: 'src/edit.ts', start_line: 20, end_line: 20, kind: 'finding' }],
      },
    });
    expect(edited.statusCode).toBe(200);
    const fpAfter = edited.json<EvalCase>().input_fingerprint;
    expect(fpAfter).not.toBe(fpBefore);

    const run2Started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    const run2 = await pollRun(app, run2Started.json<EvalRunDetail>().id);
    expect(run2.status).toBe('done');
    const run2Fp = run2.results.find((r) => r.case_id === caseId)!.fingerprint;
    expect(run2Fp).toBe(fpAfter);
    expect(run2Fp).not.toBe(run1Fp);

    await app.close();
  });

  // =========================================================================
  // AC-53 — deleting an agent leaves no readable orphaned case or run
  // =========================================================================

  it('deleting an agent leaves no readable orphaned case or run through any surface (AC-53)', async () => {
    const agent = await makeAgent(workspaceId, `Doomed-${Date.now()}`);
    const app = await appWith({
      llm: { openai: new MockLLMProvider('openai', { structured: okReview('src/doomed.ts', 8) }) },
    });

    const caseRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval/cases`,
      payload: {
        name: 'doomed case',
        expectation: 'must_find',
        input_diff: diffFor('src/doomed.ts', 8),
        expected_output: [{ file: 'src/doomed.ts', start_line: 8, end_line: 8, kind: 'finding' }],
      },
    });
    const caseId = caseRes.json<EvalCase>().id;

    const runStarted = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    const run = await pollRun(app, runStarted.json<EvalRunDetail>().id);
    expect(run.status).toBe('done');

    const del = await app.inject({ method: 'DELETE', url: `/agents/${agent.id}` });
    expect(del.statusCode).toBe(200);

    expect((await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval/cases` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/eval/cases/${caseId}` })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: `/eval/runs/${run.id}` })).statusCode).toBe(404);

    const orphanCases = await pg.handle.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'agent'), eq(t.evalCases.ownerId, agent.id)));
    expect(orphanCases).toEqual([]);
    const orphanRuns = await pg.handle.db
      .select({ id: t.evalRuns.id })
      .from(t.evalRuns)
      .where(eq(t.evalRuns.agentId, agent.id));
    expect(orphanRuns).toEqual([]);

    await app.close();
  });
});
