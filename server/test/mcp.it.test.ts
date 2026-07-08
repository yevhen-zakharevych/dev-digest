import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockLLMProvider, MockEmbedder, MockGitClient } from '../src/adapters/mocks.js';
import { Container } from '../src/platform/container.js';
import { AgentsService } from '../src/modules/agents/service.js';
import { registerListAgents } from '../src/mcp/tools/list-agents.js';
import { registerRunAgentOnPr } from '../src/mcp/tools/run-agent-on-pr.js';
import { registerGetFindings } from '../src/mcp/tools/get-findings.js';
import { registerGetConventions } from '../src/mcp/tools/get-conventions.js';
import { registerGetBlastRadius } from '../src/mcp/tools/get-blast-radius.js';
import { BlastRadius } from '../src/mcp/schemas.js';
import * as t from '../src/db/schema.js';
import type { Review } from '@devdigest/shared';

/**
 * MCP server (L04, task W4-IT) — integration coverage for the 5 MCP tools
 * (`docs/plans/L04-devdigest-mcp.md` §5/§6). DB-backed ⇒ `.it.test.ts`
 * (testcontainers Postgres); the LLM is always MOCKED — never a real key.
 *
 * Tools are driven directly: a capturing stub replaces `McpServer` so each
 * `register*(server, container)` call stores its handler by tool name instead
 * of going through the real stdio/JSON-RPC transport (plan §6: "simpler and
 * sufficient for exercising handler + DB"). `groundFindings()` is never
 * mocked or bypassed — the injected diff below carries a real `@@` hunk that
 * intersects the fixture finding's line range, or the finding would silently
 * vanish (grounding landmine, `server/INSIGHTS.md:50`, pattern mirrored from
 * `server/test/intent.it.test.ts:36-42`).
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

/** Diff hunk covering the seeded finding's line range below (new-side lines
 *  20-23; the finding sits at line 21, inside that range). */
const DIFF = `diff --git a/src/mcp/target.ts b/src/mcp/target.ts
--- a/src/mcp/target.ts
+++ b/src/mcp/target.ts
@@ -20,3 +20,4 @@
   const port = 3000;
+  const debugToken = "sk_live_debug";
   return port;`;

/** A Review fixture with ONE finding grounded to line 21 of the DIFF above —
 *  the exact fields asserted on below (mutation-worthy: a title/severity typo
 *  in either place breaks the test). */
const REVIEW_FIXTURE: Review = {
  verdict: 'approve',
  summary: 'Looks fine overall, one nit.',
  score: 88,
  findings: [
    {
      id: 'f-mcp-1',
      severity: 'WARNING',
      category: 'security',
      title: 'Hardcoded debug token',
      file: 'src/mcp/target.ts',
      start_line: 21,
      end_line: 21,
      rationale: 'A debug token literal was added inline.',
      confidence: 0.7,
      kind: 'finding',
    },
  ],
};

/** The exact concise-finding shape `toConciseFinding` should produce for the
 *  fixture above — reused across the run_agent_on_pr and get_findings assertions
 *  so both tools are held to the identical wire shape. */
const EXPECTED_CONCISE_FINDING = {
  id: 'f-mcp-1',
  severity: 'WARNING',
  category: 'security',
  title: 'Hardcoded debug token',
  file: 'src/mcp/target.ts',
  start_line: 21,
  end_line: 21,
};

type CapturedToolResult = {
  content: { type: string; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};
type CapturedToolHandler = (args: Record<string, unknown>) => Promise<CapturedToolResult>;

/**
 * A `McpServer`-shaped stub: `registerTool(name, config, handler)` just stores
 * the handler by name instead of wiring the real JSON-RPC transport. Passed
 * to each tool's `register*` function (which only ever calls `registerTool`),
 * then handlers are invoked directly with plain args in the tests below.
 */
function createCapturingServer(): { server: McpServer; handlers: Map<string, CapturedToolHandler> } {
  const handlers = new Map<string, CapturedToolHandler>();
  const stub = {
    registerTool(name: string, _config: unknown, handler: CapturedToolHandler) {
      handlers.set(name, handler);
    },
  };
  return { server: stub as unknown as McpServer, handlers };
}

let repoSeq = 0;
/** Seed a fresh repo + PR (unique per call) under the given workspace. */
async function setupRepoAndPr(db: PgFixture['handle']['db'], workspaceId: string) {
  const n = repoSeq++;
  const name = `mcp-repo-${n}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 500 + n,
      title: 'Add a temporary debug token',
      author: 'dev.one',
      branch: 'feat/debug-token',
      base: 'main',
      headSha: 'deadbeef01',
      additions: 1,
      deletions: 0,
      filesCount: 1,
      status: 'needs_review',
      body: 'Adds a temporary debug token for local testing.',
    })
    .returning();
  return { repo: repo!, pr: pr! };
}

d('MCP server (L04) — 5 tools, run→poll→findings (Testcontainers pg)', () => {
  let pg: PgFixture;
  let workspaceId: string;
  let container: Container;
  let handlers: Map<string, CapturedToolHandler>;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db.select().from(t.workspaces);
    workspaceId = ws!.id;

    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    container = new Container(config, pg.handle.db, {
      embedder: new MockEmbedder(),
      git: new MockGitClient({ diff: DIFF }),
      llm: { openai: new MockLLMProvider('openai', { structured: REVIEW_FIXTURE }) },
    });

    const { server, handlers: captured } = createCapturingServer();
    registerListAgents(server, container);
    registerRunAgentOnPr(server, container);
    registerGetFindings(server, container);
    registerGetConventions(server, container);
    registerGetBlastRadius(server, container);
    handlers = captured;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function handler(name: string): CapturedToolHandler {
    const h = handlers.get(name);
    if (!h) throw new Error(`tool "${name}" was never registered`);
    return h;
  }

  // ---- (a) + (b): run_agent_on_pr polls to done; get_findings reads it back ----
  it(
    'run_agent_on_pr polls a real review to done and returns the grounded finding; get_findings by that run_id returns the same finding + correct pagination',
    async () => {
      const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
      const agent = await new AgentsService(container).create(workspaceId, {
        name: 'MCP Run Agent',
        provider: 'openai',
        model: 'gpt-4.1',
        system_prompt: 'You are a thorough code reviewer.',
        repo_intel: false, // keep the run hermetic/fast — repoIntel enrichment isn't under test here
      });

      const runResult = await handler('run_agent_on_pr')({
        repo: repo.fullName,
        pr: pr.number,
        agent: agent.id,
      });

      expect(runResult.isError).toBeFalsy();
      // The finding's `id` is DB-assigned on insert (a fresh uuid), not the
      // fixture's own `f-mcp-1` — assert its shape, then the rest of the
      // finding exactly against the fixture.
      const runFindings = runResult.structuredContent!.findings as Record<string, unknown>[];
      expect(runResult.structuredContent!.verdict).toBe('approve');
      expect(runFindings).toHaveLength(1);
      expect(runFindings[0]!.id).toEqual(expect.any(String));
      const { id: _runFindingId, ...runFindingRest } = runFindings[0]!;
      const { id: _expectedId, ...expectedRest } = EXPECTED_CONCISE_FINDING;
      expect(runFindingRest).toEqual(expectedRest);

      // run_agent_on_pr's "done" result includes the run_id (schemas.ts
      // RunResultDone = {run_id, verdict, findings}) so the caller can re-fetch
      // this exact run — drive get_findings straight off it, no side lookup.
      const runId = runResult.structuredContent!.run_id as string;
      expect(runId).toEqual(expect.any(String));
      // Cross-check it's the actual done run in the DB (not an arbitrary string).
      const runs = await container.reviewRepo.listRunsForPull(workspaceId, pr.id);
      expect(runs.find((r) => r.run_id === runId)?.status).toBe('done');

      const findingsResult = await handler('get_findings')({ run_id: runId });

      expect(findingsResult.isError).toBeFalsy();
      // Same persisted finding (same DB-assigned id) as the run_agent_on_pr
      // result above — get_findings must read back the identical row.
      expect(findingsResult.structuredContent).toEqual({
        verdict: 'approve',
        findings: [{ ...expectedRest, id: runFindings[0]!.id }],
        total: 1,
        count: 1,
        offset: 0,
        has_more: false,
        next_offset: null,
      });
    },
    30_000,
  );

  // ---- (c) list_agents ----
  it('list_agents returns the seeded agent id', async () => {
    const agent = await new AgentsService(container).create(workspaceId, {
      name: 'MCP List Agent',
      provider: 'openai',
      model: 'gpt-4.1',
      system_prompt: 'You review PRs.',
    });

    const result = await handler('list_agents')({});

    expect(result.isError).toBeFalsy();
    const agents = result.structuredContent!.agents as { id: string; name: string; enabled: boolean }[];
    const found = agents.find((a) => a.id === agent.id);
    expect(found).toEqual(expect.objectContaining({ id: agent.id, name: 'MCP List Agent', enabled: true }));
  });

  // ---- (d) get_conventions ----
  it('get_conventions returns only accepted convention rows for the seeded repo', async () => {
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);

    await pg.handle.db.insert(t.conventions).values([
      {
        workspaceId,
        repoId: repo.id,
        rule: 'Prefer named exports over default exports.',
        evidencePath: 'src/index.ts',
        evidenceSnippet: 'export function foo() {}',
        confidence: 0.9,
        status: 'accepted',
        accepted: true,
      },
      {
        workspaceId,
        repoId: repo.id,
        rule: 'A pending rule that should NOT appear.',
        evidencePath: 'src/other.ts',
        evidenceSnippet: 'const x = 1;',
        confidence: 0.5,
        status: 'pending',
        accepted: false,
      },
    ]);

    const result = await handler('get_conventions')({ repo: repo.fullName });

    expect(result.isError).toBeFalsy();
    const conventions = result.structuredContent!.conventions as { rule: string; status: string }[];
    expect(conventions).toHaveLength(1);
    expect(conventions[0]).toEqual(
      expect.objectContaining({
        rule: 'Prefer named exports over default exports.',
        status: 'accepted',
      }),
    );
  });

  // ---- (e) run_agent_on_pr — unknown agent id leads onward to list_agents ----
  it('run_agent_on_pr with an unknown (but well-formed) agent id returns isError with a list_agents pointer', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);
    // Syntactically a valid uuid (agentId is looked up via a uuid column) that
    // simply matches no row — exercises the NotFoundError branch, not a raw
    // Postgres type error on a malformed id.
    const unknownAgentId = randomUUID();

    const result = await handler('run_agent_on_pr')({
      repo: repo.fullName,
      pr: pr.number,
      agent: unknownAgentId,
    });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(
      `agent "${unknownAgentId}" not found — call list_agents for valid ids`,
    );
  });

  // ---- (f) get_blast_radius — real implementation (L04), shares the facade +
  // blastResultToContract mapper with GET /pulls/:id/blast (docs/plans/
  // L04-blast-radius.md D4) ----
  it('get_blast_radius returns the real, non-empty blast radius from the persistent index', async () => {
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId);

    // Changed file + a resolved cross-file caller, mirroring `blast.it.test.ts`'s
    // seedIndex helper (kept inline here — this file owns its own fixtures).
    await pg.handle.db.insert(t.prFiles).values({ prId: pr.id, path: 'src/foo.ts', additions: 3, deletions: 0 });
    await pg.handle.db.insert(t.symbols).values([
      { repoId: repo.id, path: 'src/foo.ts', name: 'doFoo', kind: 'function', line: 1, endLine: 3, exported: true },
      { repoId: repo.id, path: 'src/routes/foo-route.ts', name: 'handler', kind: 'function', line: 1, endLine: 5, exported: false },
    ]);
    await pg.handle.db.insert(t.references).values({
      repoId: repo.id,
      fromPath: 'src/routes/foo-route.ts',
      toSymbol: 'doFoo',
      line: 3,
      declFile: 'src/foo.ts',
    });
    await pg.handle.db.insert(t.fileRank).values({
      repoId: repo.id,
      filePath: 'src/routes/foo-route.ts',
      pagerank: 1,
      hotness: 0,
      rank: 1,
      percentile: 90,
    });
    await pg.handle.db.insert(t.fileFacts).values({
      repoId: repo.id,
      filePath: 'src/routes/foo-route.ts',
      endpoints: ['GET /foo'],
      crons: [],
    });
    await pg.handle.db.insert(t.repoIndexState).values({
      repoId: repo.id,
      lastIndexedSha: 'deadbeef01',
      indexerVersion: 2,
      status: 'full',
      filesIndexed: 2,
      filesSkipped: 0,
      stats: {},
    });

    const result = await handler('get_blast_radius')({ repo: repo.fullName, pr: pr.number });

    expect(result.isError).toBeFalsy();
    expect(() => BlastRadius.parse(result.structuredContent)).not.toThrow();
    // Exact toEqual (not just shape-valid) — catches a wrong summary/caller
    // mapping the same way `server/INSIGHTS.md:191(c)` already documents for
    // this tool's previous stub assertion.
    expect(result.structuredContent).toEqual({
      changed_symbols: [{ name: 'doFoo', file: 'src/foo.ts', kind: 'function' }],
      downstream: [
        {
          symbol: 'doFoo',
          callers: [{ name: 'handler', file: 'src/routes/foo-route.ts', line: 3 }],
          endpoints_affected: ['GET /foo'],
          crons_affected: [],
        },
      ],
      summary: '1 changed symbol(s) affect 1 downstream caller group(s)',
    });
    expect(result.content[0]!.text).toBe(result.structuredContent!.summary);
  });

  // ---- error-leads-onward on a read tool: missing PR ----
  it('get_findings with a valid repo but a nonexistent PR number returns isError naming the PR and repo', async () => {
    const { repo } = await setupRepoAndPr(pg.handle.db, workspaceId);

    const result = await handler('get_findings')({ repo: repo.fullName, pr: 999999 });

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe(`PR #999999 not found in ${repo.fullName}`);
  });
});
