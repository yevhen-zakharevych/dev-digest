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
 * Project Context (SPEC-2026-07-10-project-context, task T6) — run-time
 * injection + trace population, driven end-to-end through a real review run.
 * DB-backed ⇒ `.it.test.ts` (testcontainers Postgres); the LLM is always
 * MOCKED (`TESTING.md`). Pure resolver logic (union/dedupe/order/skip) is
 * covered hermetically in `project-context-resolve.test.ts` — this file only
 * proves the WIRING: attach → run → trace/prompt/grounding.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

/**
 * A diff touching `src/api/orders.ts` that violates an architectural
 * invariant ("api/ must not import db/ directly") by adding a direct db
 * import. Mirrors the proven hunk shape from `intent.it.test.ts`/
 * `reviews.it.test.ts` (`server/INSIGHTS.md:50`): the added line lands at
 * absolute new-file line 11, so a finding citing that file+line survives
 * `groundFindings()`.
 */
const DIFF = `diff --git a/src/api/orders.ts b/src/api/orders.ts
--- a/src/api/orders.ts
+++ b/src/api/orders.ts
@@ -10,3 +10,4 @@
   export function getOrders() {
+  import { db } from '../db/client';
   return [];
 }`;

/** States the invariant the DIFF above violates. */
const INVARIANT_DOC =
  'Architectural invariant: modules under `api/` must not import from `db/` directly. ' +
  'All database access must go through the repository layer.';

/** A finding that cites the violating line and references the invariant. */
const VIOLATION_FIXTURE: Review = {
  verdict: 'request_changes',
  summary: 'Direct db import from api/ violates the layering invariant.',
  score: 55,
  findings: [
    {
      id: 'f-invariant',
      severity: 'CRITICAL',
      category: 'bug',
      title: 'api/ module imports db/ directly',
      file: 'src/api/orders.ts',
      start_line: 11,
      end_line: 11,
      rationale: 'Per the attached project-context spec, api/ must never import db/ directly.',
      suggestion: 'Route this through the repository layer instead.',
      confidence: 0.9,
      kind: 'finding',
    },
  ],
};

/** A clean review fixture (no findings) — used for the zero-docs / calls-parity tests. */
const CLEAN_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine.',
  score: 100,
  findings: [],
};

let repoSeq = 0;
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const name = `project-context-${repoSeq++}`;
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
      title: 'Add direct db import to orders API',
      author: 'marisa.koch',
      branch: 'feat/orders-db',
      base: 'main',
      headSha: 'a1b2c3d4',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Wires up orders directly to the db client.',
    })
    .returning();
  await db.insert(t.prFiles).values({
    prId: pr!.id,
    path: 'src/api/orders.ts',
    additions: 1,
    deletions: 0,
    patch:
      "@@ -10,3 +10,4 @@\n   export function getOrders() {\n+  import { db } from '../db/client';\n   return [];\n }",
  });
  return { repo: repo!, pr: pr! };
}

d('Project Context — run-time injection + trace population (Testcontainers pg)', () => {
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

  function appWith(structured: unknown, files: Record<string, string> = {}, cloneMissing = false) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF, files, cloneMissing }),
        llm: {
          openai: new MockLLMProvider('openai', { structured }),
        },
      },
    });
  }

  async function createAgent(app: Awaited<ReturnType<typeof appWith>>, name: string) {
    return (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: { name, provider: 'openai', model: 'gpt-4.1', system_prompt: 'Review carefully.' },
      })
    ).json();
  }

  // ---- AC-35 headline + AC-25 + AC-27 + AC-29 --------------------------------
  it('AC-35 headline: attaches an invariant spec, injects it, and a grounded finding survives groundFindings()', async () => {
    const app = await appWith(VIOLATION_FIXTURE, { 'specs/invariant.md': INVARIANT_DOC });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'InvariantAgent');

    const attach = await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/docs`,
      payload: { paths: ['specs/invariant.md'] },
    });
    expect(attach.statusCode).toBe(200);

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id;

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // Per the spec's Cost section: never assert an exact model-produced
    // finding string — only that injection happened and the finding
    // (produced under the influence of the attached spec) survived grounding.
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(reviews).toHaveLength(1);
    expect(reviews[0].findings.length).toBeGreaterThan(0);
    expect(reviews[0].findings[0].file).toBe('src/api/orders.ts');

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();

    // AC-25: the actual path read is recorded.
    expect(trace.specs_read).toEqual(['specs/invariant.md']);
    expect(trace.specs_missing).toEqual([]);

    // AC-27: the doc's exact text is present in the persisted prompt assembly.
    expect(trace.prompt_assembly.specs).toContain(INVARIANT_DOC);

    // AC-29: the doc is wrapped in the untrusted fence (position-based, not a
    // bare `.toContain` — a substring check can't tell which side of the
    // fence the text landed on, per reviewer-core/INSIGHTS.md).
    const specsBlock: string = trace.prompt_assembly.specs;
    const openTagIdx = specsBlock.indexOf('<untrusted source="spec-0">');
    const closeTagIdx = specsBlock.indexOf('</untrusted>');
    const docIdx = specsBlock.indexOf(INVARIANT_DOC);
    expect(openTagIdx).toBeGreaterThanOrEqual(0);
    expect(closeTagIdx).toBeGreaterThan(openTagIdx);
    expect(docIdx).toBeGreaterThan(openTagIdx);
    expect(docIdx).toBeLessThan(closeTagIdx);

    // AC-20: the document is labeled with its own source path (not just a
    // positional `spec-0` index), so the model can cite the exact document by
    // name — and that label lives INSIDE the untrusted fence, same as the doc
    // text (position-based, not a bare `.toContain`).
    const pathIdx = specsBlock.indexOf('specs/invariant.md');
    expect(pathIdx).toBeGreaterThan(openTagIdx);
    expect(pathIdx).toBeLessThan(closeTagIdx);
    expect(pathIdx).toBeLessThan(docIdx);

    // AC-29 (guard remains): the injection guard is unconditionally appended
    // to the system prompt, regardless of the attached doc's content.
    expect(trace.prompt_assembly.system).toContain(
      'Everything inside <untrusted>…</untrusted> blocks',
    );

    await app.close();
  });

  // ---- AC-22 / AC-26 fail-soft -------------------------------------------
  it('AC-22/AC-26 fail-soft: a stale attached path is skipped, survivors are injected, run completes normally', async () => {
    const app = await appWith(CLEAN_FIXTURE, { 'specs/exists.md': 'Present doc text.' });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'FailSoftAgent');

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/docs`,
      payload: { paths: ['specs/exists.md', 'specs/gone.md'] },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    expect(res.statusCode).toBe(200);
    const runId = res.json().runs[0].run_id;

    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    // The run completed normally (not failed) despite the stale path.
    const reviews = (await app.inject({ method: 'GET', url: `/pulls/${pr.id}/reviews` })).json();
    expect(reviews).toHaveLength(1);

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual(['specs/exists.md']);
    expect(trace.specs_missing).toEqual(['specs/gone.md']);
    expect(trace.prompt_assembly.specs).toContain('Present doc text.');

    await app.close();
  });

  // ---- AC-23 zero attached docs ------------------------------------------
  it('AC-23: zero attached docs → no Project-context section at all', async () => {
    const app = await appWith(CLEAN_FIXTURE);
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'NoDocsAgent');

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    expect(trace.specs_read).toEqual([]);
    expect(trace.specs_missing).toEqual([]);
    expect(trace.prompt_assembly.specs).toBeNull();
    expect(trace.prompt_assembly.user).not.toContain('## Project context');

    await app.close();
  });

  // ---- AC-24: no new LLM calls -------------------------------------------
  it('AC-24: a run with attached docs makes the SAME number of provider calls as one without', async () => {
    const llmNoDocs = new MockLLMProvider('openai', { structured: CLEAN_FIXTURE });
    const llmWithDocs = new MockLLMProvider('openai', { structured: CLEAN_FIXTURE });

    const appNoDocs = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF }),
        llm: { openai: llmNoDocs },
      },
    });
    const appWithDocs = await buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: {
        embedder: new MockEmbedder(),
        git: new MockGitClient({ diff: DIFF, files: { 'specs/a.md': 'doc a', 'docs/b.md': 'doc b' } }),
        llm: { openai: llmWithDocs },
      },
    });

    const { pr: pr1 } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent1 = await createAgent(appNoDocs, 'NoDocsCallsAgent');
    await appNoDocs.inject({
      method: 'POST',
      url: `/pulls/${pr1.id}/review`,
      payload: { agentId: agent1.id },
    });
    await waitForPrRuns(pg.handle.db, pr1.id, { expected: 1 });

    const { pr: pr2 } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent2 = await createAgent(appWithDocs, 'WithDocsCallsAgent');
    await appWithDocs.inject({
      method: 'PUT',
      url: `/agents/${agent2.id}/docs`,
      payload: { paths: ['specs/a.md', 'docs/b.md'] },
    });
    await appWithDocs.inject({
      method: 'POST',
      url: `/pulls/${pr2.id}/review`,
      payload: { agentId: agent2.id },
    });
    await waitForPrRuns(pg.handle.db, pr2.id, { expected: 1 });

    expect(llmNoDocs.calls.length).toBe(llmWithDocs.calls.length);
    expect(llmWithDocs.calls.length).toBeGreaterThan(0);

    await appNoDocs.close();
    await appWithDocs.close();
  });

  // ---- AC-18 disabled-skill exclusion (wiring) ---------------------------
  it('AC-18: a disabled skill link contributes NO docs, even though the skill itself has attached docs', async () => {
    const app = await appWith(CLEAN_FIXTURE, {
      'specs/agent-doc.md': 'agent doc',
      'specs/skill-doc.md': 'skill doc — must NOT be injected (disabled link)',
    });
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    const agent = await createAgent(app, 'DisabledSkillAgent');

    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/docs`,
      payload: { paths: ['specs/agent-doc.md'] },
    });

    const skill = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { name: 'CtxSkill', description: 'd', type: 'custom', body: 'Skill body.' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/skills/${skill.id}/docs`,
      payload: { paths: ['specs/skill-doc.md'] },
    });

    // Link the skill to the agent, then DISABLE the link.
    await app.inject({
      method: 'POST',
      url: `/agents/${agent.id}/skills`,
      payload: { skill_ids: [skill.id] },
    });
    await app.inject({
      method: 'PUT',
      url: `/agents/${agent.id}/skills/${skill.id}`,
      payload: { enabled: false },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/pulls/${pr.id}/review`,
      payload: { agentId: agent.id },
    });
    const runId = res.json().runs[0].run_id;
    await waitForPrRuns(pg.handle.db, pr.id, { expected: 1 });

    const trace = (await app.inject({ method: 'GET', url: `/runs/${runId}/trace` })).json();
    // Only the agent's own doc made it in — the disabled skill's doc did not.
    expect(trace.specs_read).toEqual(['specs/agent-doc.md']);
    expect(trace.prompt_assembly.specs).not.toContain('skill-doc');

    await app.close();
  });
});
