import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import { eq, isNull } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import type { CiWorkflowRunRef, RepoRef } from '@devdigest/shared';
import type { RunnerFile } from '../src/modules/ci/bundle.js';
import type { RunnerBundleReader } from '../src/modules/ci/runner-bundle.js';
import {
  MAX_WORKFLOW_RUNS,
  RESULT_ARTIFACT_NAME,
  RESULT_FILENAME,
  WORKFLOW_FILE_BASENAME,
} from '../src/modules/ci/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-ingest] Docker not available — skipping integration tests.');
}

/**
 * CI Runs ingest: the bounded per-installation refresh (AC-32), status derived
 * from the ARTIFACT (AC-33), idempotent re-ingest (AC-34), the
 * persist-nothing-from-an-invalid-payload rule (AC-35), unreadable archives
 * (AC-36), partial failure (AC-37) and workspace scoping (AC-38).
 */

class StubRunnerBundle implements RunnerBundleReader {
  async read(): Promise<RunnerFile[]> {
    return [{ name: 'index.js', contents: '// runner' }];
  }
}

/**
 * MockGitHubClient makes ONE `failWrites` decision for the whole client, which
 * cannot express AC-37's "this repository fails, that one succeeds". Rather than
 * edit the shared mock (owned and finished by another task), this test-local
 * subclass fails per repository name.
 */
class PerRepoFailingGitHub extends MockGitHubClient {
  constructor(
    private readonly failingRepo: string,
    private readonly runsByRepo: Record<string, CiWorkflowRunRef[]>,
    opts: ConstructorParameters<typeof MockGitHubClient>[0] = {},
  ) {
    super(opts);
  }
  override async listWorkflowRuns(
    repo: RepoRef,
    workflowFile: string,
    limit: number,
  ): Promise<CiWorkflowRunRef[]> {
    const slug = `${repo.owner}/${repo.name}`;
    if (slug === this.failingRepo) throw new Error('Not Found');
    this.listWorkflowRunsCalls.push({ workflowFile, limit });
    return (this.runsByRepo[slug] ?? []).slice(0, limit);
  }
}

let seq = 0;
const uid = () => `${Date.now()}-${seq++}`;

function completedRun(id: number, url: string, prNumber: number): CiWorkflowRunRef {
  return {
    id,
    htmlUrl: url,
    status: 'completed',
    // The gate case: the run BLOCKED the PR, so GitHub calls it a failure.
    // Ingest must never read this field.
    conclusion: 'failure',
    prNumber,
    createdAt: '2026-07-20T10:00:00Z',
  };
}

d('CI Runs ingest', () => {
  let pg: PgFixture;
  let defaultWorkspaceId: string;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
    const [ws] = await pg.handle.db
      .select({ id: t.workspaces.id })
      .from(t.workspaces)
      .where(eq(t.workspaces.name, 'default'));
    defaultWorkspaceId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  /**
   * Refresh fans out over EVERY installation in the workspace, and one mock
   * answers for every repository — so installations left behind by an earlier
   * test would be refreshed too and duplicate this test's fixtures under a
   * different installation id. Each test therefore starts from an empty CI
   * table pair. Runs go first: the FK is `on delete set null`, so dropping
   * installations while runs remain would orphan them instead of removing them.
   */
  beforeEach(async () => {
    await pg.handle.db.delete(t.ciRuns);
    await pg.handle.db.delete(t.ciInstallations);
  });

  function makeApp(github: MockGitHubClient) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github, runnerBundle: new StubRunnerBundle() },
    });
  }

  /** Create an agent in the default workspace and install it into `repos`. */
  async function install(
    app: Awaited<ReturnType<typeof buildApp>>,
    repos: string[],
  ): Promise<string> {
    const created = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: `Agent ${uid()}`,
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review.',
      },
    });
    const agentId = created.json().id as string;
    for (const repo of repos) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: { repo, base: 'main', triggers: ['opened'], post_as: 'github_review' },
      });
      expect(res.statusCode).toBe(200);
    }
    return agentId;
  }

  // ---- AC-33 --------------------------------------------------------------

  it('AC-33 — status comes from the ARTIFACT: a run that BLOCKED the PR ingests as succeeded', async () => {
    const url = `https://github.com/acme/w/actions/runs/${uid()}`;
    const github = new MockGitHubClient({
      workflowRuns: [completedRun(9001, url, 42)],
      artifacts: {
        9001: JSON.stringify({
          findings_count: 3,
          cost_usd: 0.12,
          duration_ms: 45_000,
          agent: 'Security Reviewer',
          pr_number: 42,
        }),
      },
    });
    const app = await makeApp(github);
    await install(app, ['acme/blocked']);

    const res = await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    expect(res.statusCode).toBe(200);
    const run = (res.json().runs as { github_url: string }[]).find((r) => r.github_url === url);
    // The workflow run's own conclusion is `failure`; deriving from it would
    // record the gate working as a failed review.
    expect(run).toMatchObject({
      status: 'succeeded',
      findings_count: 3,
      cost_usd: 0.12,
      duration_s: 45, // milliseconds → seconds
      agent: 'Security Reviewer',
      pr_number: 42,
      repo: 'acme/blocked',
      source: 'github_actions',
    });
    await app.close();
  });

  it('AC-33 — 0 findings → no_findings; completed with no artifact → failed; not completed → running', async () => {
    const base = uid();
    const urls = {
      clean: `https://github.com/acme/w/actions/runs/${base}-clean`,
      noArtifact: `https://github.com/acme/w/actions/runs/${base}-none`,
      inProgress: `https://github.com/acme/w/actions/runs/${base}-live`,
    };
    const github = new MockGitHubClient({
      workflowRuns: [
        completedRun(9101, urls.clean, 1),
        completedRun(9102, urls.noArtifact, 2),
        {
          id: 9103,
          htmlUrl: urls.inProgress,
          status: 'in_progress',
          conclusion: null,
          prNumber: 3,
          createdAt: '2026-07-20T11:00:00Z',
        },
      ],
      artifacts: {
        9101: JSON.stringify({ findings_count: 0, cost_usd: 0.01, agent: 'Reviewer' }),
        // 9102 is deliberately absent → the port's "no readable artifact" result.
      },
    });
    const app = await makeApp(github);
    await install(app, ['acme/mixed']);

    const runs = (await app.inject({ method: 'POST', url: '/ci/runs/refresh' })).json()
      .runs as { github_url: string; status: string; findings_count: number | null }[];
    const byUrl = (u: string) => runs.find((r) => r.github_url === u)!;

    expect(byUrl(urls.clean)).toMatchObject({ status: 'no_findings', findings_count: 0 });
    expect(byUrl(urls.noArtifact)).toMatchObject({ status: 'failed', findings_count: null });
    expect(byUrl(urls.inProgress)).toMatchObject({ status: 'running', findings_count: null });

    // A run that has not completed is never asked for an artifact at all.
    expect(github.artifactCalls.map((c) => c.runId).sort()).toEqual([9101, 9102]);
    await app.close();
  });

  // ---- AC-35 / AC-36 ------------------------------------------------------

  it('AC-35 — an invalid artifact persists NOTHING from the payload, but keeps its own URL', async () => {
    const base = uid();
    const urls = {
      badJson: `https://github.com/acme/w/actions/runs/${base}-badjson`,
      badShape: `https://github.com/acme/w/actions/runs/${base}-badshape`,
    };
    const github = new MockGitHubClient({
      workflowRuns: [completedRun(9201, urls.badJson, 7), completedRun(9202, urls.badShape, 8)],
      artifacts: {
        9201: 'not json at all {{{',
        // Shape violation: `findings_count` must be an int and `cost_usd` must be
        // present. `agent` alone looks plausible — and must STILL not be stored.
        9202: JSON.stringify({ findings_count: 'lots', agent: 'Attacker Supplied' }),
      },
    });
    const app = await makeApp(github);
    await install(app, ['acme/invalid']);

    const runs = (await app.inject({ method: 'POST', url: '/ci/runs/refresh' })).json()
      .runs as Record<string, unknown>[];
    for (const url of Object.values(urls)) {
      const run = runs.find((r) => r.github_url === url)!;
      expect(run.status).toBe('failed');
      expect(run.findings_count).toBeNull();
      expect(run.cost_usd).toBeNull();
      expect(run.duration_s).toBeNull();
      // Not even `agent` — the one field of the bad payload that parsed fine.
      expect(run.agent).toBeNull();
      // The URL is the RUN's own metadata, not the payload's: a failed row keeps it.
      expect(run.github_url).toBe(url);
      expect(run.repo).toBe('acme/invalid');
    }
    await app.close();
  });

  it('AC-36 — an unreadable/oversized archive ingests as failed, and only the one entry is requested', async () => {
    const url = `https://github.com/acme/w/actions/runs/${uid()}`;
    const github = new MockGitHubClient({
      workflowRuns: [completedRun(9301, url, 11)],
      // The port collapses missing / oversized (> 5 MB) / corrupt into `null`, so
      // one fixture reproduces all three. The ceiling itself is enforced inside
      // `OctokitGitHubClient.downloadRunResultArtifact`, which never writes to
      // disk and reads exactly one entry in memory.
      artifacts: { 9301: null },
    });
    const app = await makeApp(github);
    await install(app, ['acme/oversized']);

    const runs = (await app.inject({ method: 'POST', url: '/ci/runs/refresh' })).json()
      .runs as { github_url: string; status: string }[];
    expect(runs.find((r) => r.github_url === url)!.status).toBe('failed');
    expect(github.artifactCalls).toEqual([
      { runId: 9301, artifactName: RESULT_ARTIFACT_NAME, entryName: RESULT_FILENAME },
    ]);
    await app.close();
  });

  // ---- AC-32 / AC-34 ------------------------------------------------------

  it('AC-32 — refresh issues ONE bounded listing per installation, and reads issue none', async () => {
    const url = `https://github.com/acme/w/actions/runs/${uid()}`;
    const github = new MockGitHubClient({
      workflowRuns: [completedRun(9401, url, 5)],
      artifacts: { 9401: JSON.stringify({ findings_count: 1, cost_usd: null, agent: 'R' }) },
    });
    const app = await makeApp(github);
    await install(app, ['acme/one', 'acme/two']);

    const before = github.listWorkflowRunsCalls.length;
    await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    const calls = github.listWorkflowRunsCalls.slice(before);
    expect(calls).toHaveLength(2); // one per installation, no more
    for (const call of calls) {
      expect(call.workflowFile).toBe(WORKFLOW_FILE_BASENAME);
      expect(call.limit).toBe(MAX_WORKFLOW_RUNS);
      expect(call.limit).toBe(20);
    }

    // Reading the page ingests nothing — no timer, no read-path side effect.
    const afterRefresh = github.listWorkflowRunsCalls.length;
    await app.inject({ method: 'GET', url: '/ci/runs' });
    await app.inject({ method: 'GET', url: '/ci/runs' });
    expect(github.listWorkflowRunsCalls).toHaveLength(afterRefresh);
    await app.close();
  });

  it('AC-34 — re-ingesting the same run updates it; three refreshes leave the row count unchanged', async () => {
    const url = `https://github.com/acme/w/actions/runs/${uid()}`;
    const github = new MockGitHubClient({
      workflowRuns: [completedRun(9501, url, 21)],
      artifacts: { 9501: JSON.stringify({ findings_count: 2, cost_usd: 0.5, agent: 'R' }) },
    });
    const app = await makeApp(github);
    await install(app, ['acme/idempotent']);

    await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    await app.inject({ method: 'POST', url: '/ci/runs/refresh' });
    const rowsAfterTwo = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(eq(t.ciRuns.githubUrl, url));
    expect(rowsAfterTwo).toHaveLength(1);

    // The third refresh sees a NEWER artifact for the same run. The installation
    // lives in the database, so a second app with a re-configured mock is the
    // way to change what GitHub reports without reaching into the mock's state.
    const app2 = await makeApp(
      new MockGitHubClient({
        workflowRuns: [completedRun(9501, url, 21)],
        artifacts: {
          9501: JSON.stringify({
            findings_count: 7,
            cost_usd: 0.9,
            duration_ms: 1_500,
            agent: 'R2',
          }),
        },
      }),
    );
    const third = (await app2.inject({ method: 'POST', url: '/ci/runs/refresh' })).json()
      .runs as Record<string, unknown>[];
    await app2.close();

    const rows = await pg.handle.db.select().from(t.ciRuns).where(eq(t.ciRuns.githubUrl, url));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(rowsAfterTwo[0]!.id);
    expect(third.find((r) => r.github_url === url)).toMatchObject({
      findings_count: 7,
      cost_usd: 0.9,
      duration_s: 1.5,
      agent: 'R2',
    });
    await app.close();
  });

  // ---- AC-37 --------------------------------------------------------------

  it('AC-37 — one repository failing does not abort the rest, and is named in the response', async () => {
    const goodUrl = `https://github.com/acme/w/actions/runs/${uid()}-good`;
    const github = new PerRepoFailingGitHub(
      'acme/broken',
      {
        'acme/healthy': [completedRun(9601, goodUrl, 33)],
      },
      { artifacts: { 9601: JSON.stringify({ findings_count: 4, cost_usd: 0.2, agent: 'R' }) } },
    );
    const app = await makeApp(github);
    await install(app, ['acme/healthy', 'acme/broken']);

    const body = (await app.inject({ method: 'POST', url: '/ci/runs/refresh' })).json() as {
      runs: { github_url: string; repo: string }[];
      failed: { repo: string; message: string }[];
    };

    expect(body.failed).toEqual([{ repo: 'acme/broken', message: 'Not Found' }]);
    const healthy = body.runs.find((r) => r.github_url === goodUrl);
    expect(healthy).toBeDefined();
    expect(healthy!.repo).toBe('acme/healthy');
    await app.close();
  });

  // ---- AC-38 / AC-40 ------------------------------------------------------

  it('AC-38 — runs are workspace-scoped, and every ingested row has an installation', async () => {
    const url = `https://github.com/acme/w/actions/runs/${uid()}`;
    const github = new MockGitHubClient({
      workflowRuns: [completedRun(9701, url, 55)],
      artifacts: { 9701: JSON.stringify({ findings_count: 1, cost_usd: 0.01, agent: 'R' }) },
    });
    const app = await makeApp(github);
    await install(app, ['acme/scoped']);
    await app.inject({ method: 'POST', url: '/ci/runs/refresh' });

    // A run belonging to a SECOND workspace — a request header cannot express
    // this, so the agent is created under another workspace row directly.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ingest-${uid()}` })
      .returning();
    const foreignAgent = await new AgentsRepository(pg.handle.db).insert({
      workspaceId: otherWs!.id,
      name: 'Foreign',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });
    const [foreignInstallation] = await pg.handle.db
      .insert(t.ciInstallations)
      .values({ agentId: foreignAgent.id, repo: 'other/secret', targetType: 'gha' })
      .returning();
    const foreignUrl = `https://github.com/other/secret/actions/runs/${uid()}`;
    await pg.handle.db.insert(t.ciRuns).values({
      ciInstallationId: foreignInstallation!.id,
      githubUrl: foreignUrl,
      status: 'succeeded',
      ranAt: new Date(),
    });

    const runs = (await app.inject({ method: 'GET', url: '/ci/runs' })).json() as {
      github_url: string;
      repo: string;
      ci_installation_id: string | null;
    }[];

    expect(runs.some((r) => r.github_url === foreignUrl)).toBe(false);
    expect(runs.some((r) => r.repo === 'other/secret')).toBe(false);
    expect(runs.some((r) => r.github_url === url)).toBe(true);
    // AC-40 / the composed `repo` field: present and non-empty on every row.
    expect(runs.every((r) => typeof r.repo === 'string' && r.repo.length > 0)).toBe(true);
    expect(runs.every((r) => r.ci_installation_id !== null)).toBe(true);

    // Asserted directly against storage: ingest never writes a detached run.
    const detached = await pg.handle.db
      .select()
      .from(t.ciRuns)
      .where(isNull(t.ciRuns.ciInstallationId));
    expect(detached).toHaveLength(0);
    await app.close();
  });
});
