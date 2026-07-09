import { describe, it, expect } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Finding } from '@devdigest/shared';
import { ApiError, HttpClient, type ToolDeps } from '../src/http/client.js';
import type { McpConfig } from '../src/config.js';
import { registerListAgents } from '../src/tools/list-agents.js';
import { registerRunAgentOnPr } from '../src/tools/run-agent-on-pr.js';
import { registerGetFindings } from '../src/tools/get-findings.js';
import { registerGetConventions } from '../src/tools/get-conventions.js';
import { registerGetBlastRadius } from '../src/tools/get-blast-radius.js';

/**
 * Hermetic tool-handler coverage. Every tool is driven with a MOCK HttpClient
 * (no network, no server) — asserting both the happy path and the "error leads
 * onward" branches (bad slug, unknown repo/PR/agent/run). A capturing fake
 * McpServer records each tool's handler so we can call it directly, bypassing
 * the SDK.
 */

type Handler = (args: unknown) => Promise<{
  content: { type: string; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
}>;

function captureTools(deps: ToolDeps): Map<string, Handler> {
  const handlers = new Map<string, Handler>();
  const fakeServer = {
    registerTool(name: string, _config: unknown, handler: Handler) {
      handlers.set(name, handler);
    },
  } as unknown as McpServer;

  registerListAgents(fakeServer, deps);
  registerRunAgentOnPr(fakeServer, deps);
  registerGetFindings(fakeServer, deps);
  registerGetConventions(fakeServer, deps);
  registerGetBlastRadius(fakeServer, deps);
  return handlers;
}

const CONFIG: McpConfig = { apiUrl: 'http://test', maxWaitMs: 2000, pollIntervalMs: 1 };

function notFound(): never {
  throw new ApiError('not found', 404, 'http://test/x');
}

/** Build a mock HttpClient; every method throws unless overridden. */
function makeClient(overrides: Partial<HttpClient>): HttpClient {
  const base: Partial<HttpClient> = {
    listAgents: () => Promise.reject(new Error('unexpected listAgents')),
    resolveRepo: () => Promise.reject(new Error('unexpected resolveRepo')),
    resolvePr: () => Promise.reject(new Error('unexpected resolvePr')),
    runReview: () => Promise.reject(new Error('unexpected runReview')),
    listRuns: () => Promise.reject(new Error('unexpected listRuns')),
    reviewByRun: () => Promise.reject(new Error('unexpected reviewByRun')),
    reviewsForPull: () => Promise.reject(new Error('unexpected reviewsForPull')),
    conventions: () => Promise.reject(new Error('unexpected conventions')),
    blast: () => Promise.reject(new Error('unexpected blast')),
  };
  return { ...base, ...overrides } as HttpClient;
}

function deps(overrides: Partial<HttpClient>): ToolDeps {
  return { client: makeClient(overrides), config: CONFIG };
}

const RUN_ID = '11111111-1111-4111-8111-111111111111';
const AGENT_UUID = '22222222-2222-4222-8222-222222222222';

const FINDING: Finding = {
  id: 'f-1',
  severity: 'CRITICAL',
  category: 'bug',
  title: 'boom',
  file: 'src/a.ts',
  start_line: 10,
  end_line: 12,
  rationale: 'because',
  suggestion: 'fix it',
  confidence: 0.9,
  kind: 'finding',
  trifecta_components: null,
  evidence: null,
};

describe('list_agents', () => {
  it('returns the agents from GET /agents', async () => {
    const agents = [{ id: 'a1', name: 'Reviewer', enabled: true }];
    const tools = captureTools(deps({ listAgents: () => Promise.resolve(agents as never) }));
    const res = await tools.get('list_agents')!({});
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ agents });
    expect(res.content[0]!.text).toContain('a1 — Reviewer (enabled)');
  });
});

describe('run_agent_on_pr', () => {
  it('rejects a bad slug before any HTTP call', async () => {
    const tools = captureTools(deps({}));
    const res = await tools.get('run_agent_on_pr')!({ repo: 'not-a-slug', pr: 1, agent: AGENT_UUID });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/owner\/name/);
  });

  it('leads onward when the repo is not imported (resolve 404)', async () => {
    const tools = captureTools(deps({ resolveRepo: notFound }));
    const res = await tools.get('run_agent_on_pr')!({ repo: 'acme/web', pr: 1, agent: AGENT_UUID });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/not imported/);
  });

  it('leads onward when the PR is not found (resolve 404)', async () => {
    const tools = captureTools(
      deps({ resolveRepo: () => Promise.resolve({ id: 'repo-1' }), resolvePr: notFound }),
    );
    const res = await tools.get('run_agent_on_pr')!({ repo: 'acme/web', pr: 99, agent: AGENT_UUID });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/PR #99 not found/);
  });

  it('leads onward to list_agents when a (uuid) agent id is unknown (runReview 404)', async () => {
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        runReview: notFound,
      }),
    );
    const res = await tools.get('run_agent_on_pr')!({ repo: 'acme/web', pr: 1, agent: AGENT_UUID });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/call list_agents/);
  });

  it('resolves an agent NAME to its id via list_agents, then runs', async () => {
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        listAgents: () =>
          Promise.resolve([{ id: AGENT_UUID, name: 'Security Reviewer', enabled: true }] as never),
        runReview: (_prId: string, agentId: string) =>
          Promise.resolve({ pr_id: 'pr-1', runs: [{ run_id: RUN_ID, status: agentId === AGENT_UUID ? 'running' : 'failed', error: null }] }),
        listRuns: () => Promise.resolve([{ run_id: RUN_ID, status: 'done', error: null }]),
        reviewByRun: () => Promise.resolve({ run_id: RUN_ID, verdict: 'comment', findings: [] }),
      }),
    );
    const res = await tools.get('run_agent_on_pr')!({ repo: 'acme/web', pr: 1, agent: 'security reviewer' });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ run_id: RUN_ID, verdict: 'comment' });
  });

  it('lists available agents when an agent NAME is unknown', async () => {
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        listAgents: () =>
          Promise.resolve([{ id: AGENT_UUID, name: 'Security Reviewer', enabled: true }] as never),
      }),
    );
    const res = await tools.get('run_agent_on_pr')!({ repo: 'acme/web', pr: 1, agent: 'Nonexistent' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/available agents: "Security Reviewer"/);
  });

  it('polls to done and returns verdict + concise findings', async () => {
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        runReview: () => Promise.resolve({ pr_id: 'pr-1', runs: [{ run_id: RUN_ID, status: 'running', error: null }] }),
        listRuns: () => Promise.resolve([{ run_id: RUN_ID, status: 'done', error: null }]),
        reviewByRun: () => Promise.resolve({ run_id: RUN_ID, verdict: 'comment', findings: [FINDING] }),
      }),
    );
    const res = await tools.get('run_agent_on_pr')!({ repo: 'acme/web', pr: 1, agent: AGENT_UUID });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({
      run_id: RUN_ID,
      verdict: 'comment',
      findings: [
        { id: 'f-1', severity: 'CRITICAL', category: 'bug', title: 'boom', file: 'src/a.ts', start_line: 10, end_line: 12 },
      ],
    });
  });

  it('surfaces a failed run as an error', async () => {
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        runReview: () => Promise.resolve({ pr_id: 'pr-1', runs: [{ run_id: RUN_ID, status: 'running', error: null }] }),
        listRuns: () => Promise.resolve([{ run_id: RUN_ID, status: 'failed', error: 'llm exploded' }]),
      }),
    );
    const res = await tools.get('run_agent_on_pr')!({ repo: 'acme/web', pr: 1, agent: AGENT_UUID });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/failed: llm exploded/);
  });

  it('hands back a running result when maxWaitMs elapses', async () => {
    const tools = captureTools({
      client: makeClient({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        runReview: () => Promise.resolve({ pr_id: 'pr-1', runs: [{ run_id: RUN_ID, status: 'running', error: null }] }),
        listRuns: () => Promise.resolve([{ run_id: RUN_ID, status: 'running', error: null }]),
      }),
      config: { apiUrl: 'http://test', maxWaitMs: 5, pollIntervalMs: 1 },
    });
    const res = await tools.get('run_agent_on_pr')!({ repo: 'acme/web', pr: 1, agent: AGENT_UUID });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ run_id: RUN_ID, status: 'running' });
  });
});

describe('get_findings', () => {
  it('returns a page for a run_id', async () => {
    const tools = captureTools(
      deps({ reviewByRun: () => Promise.resolve({ run_id: RUN_ID, verdict: 'approve', findings: [FINDING] }) }),
    );
    const res = await tools.get('get_findings')!({ run_id: RUN_ID });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ verdict: 'approve', total: 1, count: 1, has_more: false });
  });

  it('leads onward when no review exists for the run_id (404)', async () => {
    const tools = captureTools(deps({ reviewByRun: notFound }));
    const res = await tools.get('get_findings')!({ run_id: RUN_ID });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/run run_agent_on_pr first/);
  });

  it('returns a page for repo+pr (latest review verdict + flattened findings)', async () => {
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        reviewsForPull: () => Promise.resolve([{ run_id: RUN_ID, verdict: 'request_changes', findings: [FINDING] }]),
      }),
    );
    const res = await tools.get('get_findings')!({ repo: 'acme/web', pr: 7 });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toMatchObject({ verdict: 'request_changes', total: 1 });
  });

  it('leads onward when the PR has no reviews yet', async () => {
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        reviewsForPull: () => Promise.resolve([]),
      }),
    );
    const res = await tools.get('get_findings')!({ repo: 'acme/web', pr: 7 });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/run run_agent_on_pr first/);
  });
});

describe('get_conventions', () => {
  it('returns the accepted conventions for a repo', async () => {
    const conventions = [{ id: 'c1', rule: 'no any', confidence: 0.8 }];
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        conventions: () => Promise.resolve(conventions as never),
      }),
    );
    const res = await tools.get('get_conventions')!({ repo: 'acme/web' });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual({ conventions });
  });

  it('leads onward when the repo is not imported', async () => {
    const tools = captureTools(deps({ resolveRepo: notFound }));
    const res = await tools.get('get_conventions')!({ repo: 'acme/web' });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/not imported/);
  });
});

describe('get_blast_radius', () => {
  const BLAST = {
    changed_symbols: [],
    downstream: [],
    summary: 'no downstream impact',
  };

  it('returns the blast radius from GET /pulls/:id/blast', async () => {
    const tools = captureTools(
      deps({
        resolveRepo: () => Promise.resolve({ id: 'repo-1' }),
        resolvePr: () => Promise.resolve({ id: 'pr-1' }),
        blast: () => Promise.resolve(BLAST as never),
      }),
    );
    const res = await tools.get('get_blast_radius')!({ repo: 'acme/web', pr: 3 });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent).toEqual(BLAST);
    expect(res.content[0]!.text).toBe('no downstream impact');
  });

  it('rejects a bad slug', async () => {
    const tools = captureTools(deps({}));
    const res = await tools.get('get_blast_radius')!({ repo: 'bad', pr: 3 });
    expect(res.isError).toBe(true);
    expect(res.content[0]!.text).toMatch(/owner\/name/);
  });
});
