import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { EvalRepository, type EvalCaseRow } from '../src/modules/eval/repository.js';
import { computeFingerprint } from '../src/modules/eval/fingerprint.js';
import type {
  Agent,
  AgentSkillLink,
  AgentVersion,
  CompletionRequest,
  CompletionResult,
  EvalComparison,
  EvalDashboard,
  EvalExpectedItem,
  EvalPromoteResult,
  EvalRunDetail,
  LLMProvider,
  ModelInfo,
  Review,
  StructuredRequest,
  StructuredResult,
} from '@devdigest/shared';

/**
 * T19 — eval scoring/promote integration tests (server/test/eval-scoring.it.test.ts).
 *
 * INTEGRATION ONLY — complements (does NOT duplicate) two siblings:
 *  - the colocated unit tests own the pure metric arithmetic
 *    (`src/modules/eval/scorer.test.ts`, `fingerprint.test.ts`) and the pure
 *    promote-bump rule (`agents/effective-config.test.ts` covers the
 *    resolver; `promoteConfig` itself is unit-agnostic — a real transaction);
 *  - `server/test/agents-promote-config.it.test.ts` asserts
 *    `AgentsRepository.promoteConfig` directly (repository layer, no HTTP).
 *    This file drives the SAME skill-only-promote regression through the
 *    real HTTP surface — an actual eval run, a real compare, a real
 *    POST /eval/runs/:id/promote — because that full path is what the
 *    feature ships, and the repository-level test alone would not catch a
 *    wiring bug in `EvalService.promote` or the routes layer.
 *
 * The LLM is always mocked. Findings/metrics asserted here come from a fixed,
 * scripted provider — never a real model.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[eval-scoring] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

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

/**
 * A fully scripted provider: `failWhen(sessionId)` throws (simulates a real
 * provider/model outage for that one call — an INVALID sample, AC-36/AC-37);
 * otherwise `fixtureFor(sessionId)` supplies the Review. `run-executor.ts`
 * sets `sessionId: eval:<runId>:<caseId>`, so a case is addressable by its id
 * substring regardless of which run it belongs to.
 */
class ScriptedLLMProvider implements LLMProvider {
  readonly id: 'openai' = 'openai';
  calls: string[] = [];

  constructor(
    private opts: {
      failWhen?: (sessionId: string) => boolean;
      fixtureFor: (sessionId: string) => Review;
    },
  ) {}

  async listModels(): Promise<ModelInfo[]> {
    return [{ id: 'gpt-4.1', provider: 'openai' }];
  }
  async complete(req: CompletionRequest): Promise<CompletionResult> {
    return { text: 'x', model: req.model, tokensIn: 1, tokensOut: 1, costUsd: 0 };
  }
  async completeStructured<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const sessionId = req.sessionId ?? '';
    this.calls.push(sessionId);
    if (this.opts.failWhen?.(sessionId)) {
      throw new Error('Simulated provider outage');
    }
    const fixture = this.opts.fixtureFor(sessionId);
    const parsed = (req.schema as z.ZodType<T>).safeParse(fixture);
    if (!parsed.success) {
      throw new Error(`ScriptedLLMProvider fixture failed schema: ${parsed.error.message}`);
    }
    return { data: parsed.data, model: req.model, tokensIn: 10, tokensOut: 10, costUsd: 0.001, raw: '', attempts: 1 };
  }
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(() => [0]);
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

d('Eval scoring + promote (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;

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

  function appWith(llm: LLMProvider) {
    return buildApp({ config: config(), db: pg.handle.db, overrides: { llm: { openai: llm } } });
  }

  async function makeAgent(name: string) {
    return agentsRepo().insert({
      workspaceId,
      name,
      provider: 'openai',
      model: 'gpt-4.1',
      systemPrompt: 'Review the diff.',
    });
  }

  async function makeSkill(name: string) {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId,
        name,
        description: '',
        type: 'rubric',
        source: 'manual',
        body: `body of ${name}`,
        version: 1,
      })
      .returning();
    return row!;
  }

  /** A `must_find` case, inserted directly (this file's focus is the executor/scorer/promote, not case CRUD — covered in `eval-pipeline.it.test.ts`). */
  async function insertMustFindCase(agentId: string, file: string, line: number, name: string): Promise<EvalCaseRow> {
    const diff = diffFor(file, line);
    const expectedOutput: EvalExpectedItem[] = [{ file, start_line: line, end_line: line, kind: 'finding' }];
    const fingerprint = computeFingerprint({
      diff,
      prMeta: null,
      expectation: 'must_find',
      expectedItems: expectedOutput,
      forbiddenRegion: null,
    });
    return evalRepo().insertCase(workspaceId, {
      ownerKind: 'agent',
      ownerId: agentId,
      name,
      expectation: 'must_find',
      inputDiff: diff,
      expectedOutput,
      inputFingerprint: fingerprint,
    });
  }

  // =========================================================================
  // AC-36 — one provider failure in N is contained
  // =========================================================================

  it('one case erroring mid-batch is contained: the run completes, that case is errored, and every metric excludes it (AC-36)', async () => {
    const agent = await makeAgent(`Errored-case-${Date.now()}`);
    const caseOk1 = await insertMustFindCase(agent.id, 'src/errA.ts', 10, 'ok-1');
    const caseOk2 = await insertMustFindCase(agent.id, 'src/errB.ts', 10, 'ok-2');
    const caseFail = await insertMustFindCase(agent.id, 'src/errC.ts', 10, 'fails');

    const provider = new ScriptedLLMProvider({
      failWhen: (sessionId) => sessionId.includes(caseFail.id),
      fixtureFor: (sessionId) => {
        const file = sessionId.includes(caseOk1.id) ? 'src/errA.ts' : 'src/errB.ts';
        return okReview(file, 10);
      },
    });

    const app = await appWith(provider);
    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    expect(started.statusCode).toBe(200);
    const run = await pollRun(app, started.json<EvalRunDetail>().id);

    expect(run.status).toBe('done');
    expect(run.errored_count).toBe(1);
    // Both denominators (recall's expected-items count, precision/citation's
    // survivor count) are computed over the 2 SCORED cases only.
    expect(run.traces_total).toBe(2);
    expect(run.traces_passed).toBe(2);
    expect(run.recall).toBe(1);
    expect(run.precision).toBe(1);
    expect(run.citation_accuracy).toBe(1);

    const erroredResult = run.results.find((r) => r.case_id === caseFail.id);
    expect(erroredResult?.outcome).toBe('errored');
    expect(erroredResult?.error_reason).toMatch(/Simulated provider outage/);
    // Distinct from a `failed` (wrong-answer) outcome — never presented as a red fail.
    const okResults = run.results.filter((r) => r.case_id !== caseFail.id);
    expect(okResults.every((r) => r.outcome === 'passed')).toBe(true);

    // AC-23 — the SCORER makes zero model calls. A batch over N cases hits the
    // provider EXACTLY N times: one review per case, and nothing more. Scoring,
    // metric aggregation and per-case pass/fail are pure code. This is the
    // runtime guard on top of the structural purity of scorer.ts/compare.ts —
    // if anyone ever slips an `await llm.*` into the scoring path, this count
    // goes above N and the test goes red.
    expect(provider.calls).toHaveLength(3);
    expect(provider.calls.filter((s) => s.includes(caseOk1.id))).toHaveLength(1);
    expect(provider.calls.filter((s) => s.includes(caseOk2.id))).toHaveLength(1);
    expect(provider.calls.filter((s) => s.includes(caseFail.id))).toHaveLength(1);

    await app.close();
  });

  // =========================================================================
  // AC-37 — every case failing at the model call
  // =========================================================================

  it('every case failing at the model call ends the run FAILED with NULL metrics and no trend point (AC-37)', async () => {
    const agent = await makeAgent(`AllErrored-${Date.now()}`);
    await insertMustFindCase(agent.id, 'src/deadA.ts', 5, 'dead-1');
    await insertMustFindCase(agent.id, 'src/deadB.ts', 5, 'dead-2');

    const provider = new ScriptedLLMProvider({
      failWhen: () => true,
      fixtureFor: () => okReview('unused.ts', 1),
    });

    const app = await appWith(provider);
    const started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    const run = await pollRun(app, started.json<EvalRunDetail>().id);

    expect(run.status).toBe('failed');
    expect(run.errored_count).toBe(2);
    expect(run.recall).toBeNull();
    expect(run.precision).toBeNull();
    expect(run.citation_accuracy).toBeNull();
    expect(run.results.every((r) => r.outcome === 'errored')).toBe(true);

    const dashRes = await app.inject({ method: 'GET', url: `/agents/${agent.id}/eval/dashboard` });
    const dash = dashRes.json<EvalDashboard>();
    // A `failed` run measured NOTHING — it is absent from the trend, never a
    // zero-value point (root INSIGHTS.md's "infra failure ≠ quality datum").
    expect(dash.trend.find((p) => p.run_id === run.id)).toBeUndefined();
    expect(dash.current.recall).toBeNull();

    await app.close();
  });

  // =========================================================================
  // AC-27 — promote (the R-7 hole): skill-only config diff still bumps a
  // version whose snapshot equals the promoted skill set.
  // =========================================================================

  it('promote makes the live config AND linked skills equal to the run’s snapshot and appends a new version — including a promote whose config differs from the live agent ONLY in its skill set (AC-27, the R-7 hole)', async () => {
    const provider = new ScriptedLLMProvider({ fixtureFor: () => okReview('src/promote.ts', 10) });
    const app = await appWith(provider);

    const agentRes = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Promote-${Date.now()}`,
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'Review the diff.',
      },
    });
    expect(agentRes.statusCode).toBe(201);
    const agent = agentRes.json<Agent>();

    const skillA = await makeSkill('Naming');
    const skillB = await makeSkill('Security');

    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skillA.id] },
    });

    const caseRes = await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/eval/cases`,
      payload: {
        name: 'must find promote.ts',
        expectation: 'must_find',
        input_diff: diffFor('src/promote.ts', 10),
        expected_output: [{ file: 'src/promote.ts', start_line: 10, end_line: 10, kind: 'finding' }],
      },
    });
    expect(caseRes.statusCode).toBe(201);

    // Run #1 pins skills=[A] at v1.
    const run1Started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    const run1 = await pollRun(app, run1Started.json<EvalRunDetail>().id);
    expect(run1.status).toBe('done');

    // Since run #1: someone links skill B too. `setSkills` bumps NO version —
    // the agent is STILL v1, so the version tag alone cannot see this change.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skillA.id, skillB.id] },
    });
    const liveBefore = (await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json<Agent>();
    expect(liveBefore.version).toBe(1);

    // Run #2 pins skills=[A,B] — same version tag (v1) as run #1, different
    // effective config (AC-51's "same version, different config" case).
    const run2Started = await app.inject({ method: 'POST', url: `/agents/${agent.id}/eval/runs` });
    const run2 = await pollRun(app, run2Started.json<EvalRunDetail>().id);
    expect(run2.status).toBe('done');

    const compareRes = await app.inject({
      method: 'GET',
      url: `/eval/compare?a=${run1.id}&b=${run2.id}`,
    });
    const comparison = compareRes.json<EvalComparison>();
    expect(comparison.comparable).toBe(true);
    expect(comparison.effective_config_divergence).toBe(true);

    // Promote run #1's config. It differs from the CURRENTLY LIVE agent ONLY
    // in the skill set ([A] vs [A,B]) — everything else (prompt/provider/
    // model/strategy/repo_intel) is unchanged. This is EXACTLY the case
    // `isConfigChange` (helpers.ts) does not see (it never looks at skills),
    // so the obvious `update()`-based promote would bump nothing here.
    const promoteRes = await app.inject({
      method: 'POST',
      url: `/eval/runs/${run1.id}/promote`,
      payload: {},
    });
    expect(promoteRes.statusCode).toBe(200);
    const promoted = promoteRes.json<EvalPromoteResult>();
    expect(promoted.agent_version).toBe(2);
    expect(promoted.effective_config.skills.map((s) => s.id)).toEqual([skillA.id]);
    expect(promoted.skill_version_divergence).toEqual([]);

    const liveAfter = (await app.inject({ method: 'GET', url: `/agents/${agent.id}` })).json<Agent>();
    expect(liveAfter.version).toBe(2);
    expect(liveAfter.system_prompt).toBe('Review the diff.');
    expect(liveAfter.provider).toBe('openai');
    expect(liveAfter.model).toBe('gpt-4.1');

    const liveSkills = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/skills` })
    ).json<AgentSkillLink[]>();
    expect(liveSkills.map((l) => l.skill_id)).toEqual([skillA.id]);

    const versions = (
      await app.inject({ method: 'GET', url: `/agents/${agent.id}/versions` })
    ).json<AgentVersion[]>();
    expect(versions.map((v) => v.version)).toEqual([2, 1]);
    // The NEW snapshot holds the PROMOTED skills ([A]) — not the pre-promote
    // live links ([A,B]) it would hold if `setSkills` ran AFTER the snapshot.
    expect((versions[0]!.config as unknown as { skills: string[] }).skills).toEqual([skillA.id]);

    await app.close();
  });
});
