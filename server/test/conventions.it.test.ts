import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import {
  MockGitClient,
  MockGitHubClient,
  MockLLMProvider,
} from '../src/adapters/mocks.js';
import type { RepoIntel } from '../src/modules/repo-intel/types.js';
import type { Skill } from '@devdigest/shared';

/**
 * L0X — Conventions Extractor end-to-end (DB-backed).
 *
 * Flow under test:
 *   POST /repos/:id/conventions/extract  → enqueues a job (202)
 *   JobRunner runs `convention_extract`:
 *     - reads sample files from the temp clone dir
 *     - calls the (mocked) LLM, which returns 3 candidates: 2 valid + 1 fake
 *     - verifies each on disk; persists 2 as `status='pending'`
 *   PATCH /conventions/:id (accept one)
 *   POST /repos/:id/conventions/create-skill → 201 with full Skill DTO
 *   Assertions: skills row has source='extracted', type='convention',
 *               evidence_files populated.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[conventions] Docker not available — skipping integration tests.');
}

/**
 * Minimal RepoIntel stub used only to inject the sample paths. Every other
 * method throws so we catch any accidental cross-talk.
 */
function makeRepoIntelStub(samples: string[]): RepoIntel {
  const notImpl = (name: string) => () => {
    throw new Error(`RepoIntel.${name} not stubbed`);
  };
  return {
    indexRepo: notImpl('indexRepo'),
    refreshIndex: notImpl('refreshIndex'),
    getIndexState: notImpl('getIndexState'),
    getBlastRadius: notImpl('getBlastRadius'),
    getRepoMap: notImpl('getRepoMap'),
    getFileRank: notImpl('getFileRank'),
    getSymbolsInFiles: notImpl('getSymbolsInFiles'),
    getCallerSignatures: notImpl('getCallerSignatures'),
    getUnresolvedReferences: notImpl('getUnresolvedReferences'),
    async getConventionSamples(_repoId: string, n: number) {
      return samples.slice(0, n);
    },
    async getTopFilesByRank(_repoId: string, n: number) {
      return samples.slice(0, n);
    },
    getCriticalPaths: notImpl('getCriticalPaths'),
  } as RepoIntel;
}

d('Conventions Extractor — end-to-end', () => {
  let pg: PgFixture;
  let cloneDir: string;
  let workspaceId: string;
  let repoId: string;

  beforeAll(async () => {
    pg = await startPg();
    const seeded = await seed(pg.handle.db);
    workspaceId = seeded.workspaceId;

    // Temporary "clone" — two real files the extractor can verify, plus a
    // tsconfig the prompt sees as a config sample.
    cloneDir = await mkdtemp(join(tmpdir(), 'devdigest-conventions-'));
    await writeFile(
      join(cloneDir, 'src-api-users.ts'),
      [
        'export async function findUser(db: Db, id: string) {',
        '  const user = await db.users.find(id);',
        '  const posts = await db.posts.findMany({ userId: id });',
        '  return { user, posts };',
        '}',
      ].join('\n'),
    );
    await writeFile(
      join(cloneDir, 'lib-redis.ts'),
      [
        "import Redis from 'ioredis';",
        "import { config } from './config';",
        '',
        'export const redis = new Redis(config.redisUrl);',
      ].join('\n'),
    );
    await writeFile(
      join(cloneDir, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true } }, null, 2),
    );

    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: 'conventions-fixture',
        fullName: 'acme/conventions-fixture',
        clonePath: cloneDir,
      })
      .returning();
    repoId = repo!.id;
  });

  afterAll(async () => {
    if (cloneDir) await rm(cloneDir, { recursive: true, force: true });
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    const llm = new MockLLMProvider('openai', {
      structuredBySchema: {
        ConventionCandidatesResponse: {
          candidates: [
            {
              category: 'async',
              rule: 'Use async/await over .then() chains',
              evidence_path: 'src-api-users.ts',
              evidence_line_start: 2,
              evidence_line_end: 3,
              confidence: 0.91,
            },
            {
              category: 'module-boundaries',
              rule: 'Redis access goes through lib-redis.ts singleton',
              evidence_path: 'lib-redis.ts',
              evidence_line_start: 4,
              evidence_line_end: 4,
              confidence: 0.85,
            },
            // Fake path — must be dropped by on-disk verification.
            {
              category: 'naming',
              rule: 'Phantom rule about a non-existent file',
              evidence_path: 'src/does-not-exist.ts',
              evidence_line_start: 1,
              evidence_line_end: 1,
              confidence: 0.7,
            },
          ],
        },
      },
    });

    return buildApp({
      config,
      db: pg.handle.db,
      overrides: {
        git: new MockGitClient(),
        github: new MockGitHubClient(),
        llm: { openai: llm, openrouter: llm },
        repoIntel: makeRepoIntelStub(['src-api-users.ts', 'lib-redis.ts']),
      },
    });
  }

  it('extract → verify → accept → create-skill', async () => {
    const app = await makeApp();

    // 1) Trigger extraction. Returns 202 with { scanId, jobId }.
    const extract = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/extract`,
    });
    expect(extract.statusCode).toBe(202);
    const { scanId, jobId } = extract.json() as { scanId: string; jobId: string };
    expect(scanId).toBe(jobId);

    // 2) Drain the queue so the handler completes inline.
    await app.container.jobs.onIdle();

    // 3) Job should be marked done.
    const [job] = await pg.handle.db
      .select()
      .from(t.jobs)
      .where(eq(t.jobs.id, jobId));
    expect(job?.status).toBe('done');

    // 4) GET /repos/:id/conventions — only the two verified candidates landed.
    const listed = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/conventions`,
    });
    expect(listed.statusCode).toBe(200);
    const candidates = listed.json() as Array<{
      id: string;
      rule: string;
      evidence_path: string;
      status: string;
    }>;
    expect(candidates).toHaveLength(2);
    expect(candidates.every((c) => c.status === 'pending')).toBe(true);
    // Verified rows preserve the cited path.
    const paths = candidates.map((c) => c.evidence_path).sort();
    expect(paths).toEqual(['lib-redis.ts', 'src-api-users.ts']);
    // The fake path was dropped.
    expect(candidates.find((c) => c.evidence_path.includes('does-not-exist'))).toBeUndefined();

    // 5) Accept one candidate via PATCH.
    const target = candidates[0]!;
    const accepted = await app.inject({
      method: 'PATCH',
      url: `/conventions/${target.id}`,
      payload: { status: 'accepted' },
    });
    expect(accepted.statusCode).toBe(200);
    expect((accepted.json() as { status: string }).status).toBe('accepted');

    // 6) Create-skill preview seeds name/description/body server-side.
    const preview = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/conventions/create-skill/preview?candidate_ids=${target.id}`,
    });
    expect(preview.statusCode).toBe(200);
    const seed = preview.json() as { name: string; description: string; body: string };
    expect(seed.name).toContain('conventions-fixture');
    expect(seed.body).toContain(target.rule);

    // 7) Persist the skill.
    const create = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/create-skill`,
      payload: {
        candidate_ids: [target.id],
        name: seed.name,
        description: seed.description,
        body: seed.body,
      },
    });
    expect(create.statusCode).toBe(201);
    const skill = create.json() as Skill;
    expect(skill).toMatchObject({
      type: 'convention',
      source: 'extracted',
      version: 1,
      enabled: true,
    });
    expect(skill.evidence_files).toEqual([target.evidence_path]);

    // 8) /skills lists the new convention skill.
    const list = await app.inject({ method: 'GET', url: '/skills' });
    expect((list.json() as Skill[]).find((s) => s.id === skill.id)).toBeDefined();

    await app.close();
  }, 30_000);

  it('rejects create-skill when any candidate id is not accepted', async () => {
    const app = await makeApp();
    // Re-extract: but candidates from prior run still exist (workspace-scoped).
    // Fetch the pending one we left behind and try to skill-ify it.
    const listed = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/conventions?status=pending`,
    });
    const pending = (listed.json() as Array<{ id: string }>);
    expect(pending.length).toBeGreaterThan(0);

    const create = await app.inject({
      method: 'POST',
      url: `/repos/${repoId}/conventions/create-skill`,
      payload: {
        candidate_ids: [pending[0]!.id],
        name: 'should-fail',
        description: 'pending row',
        body: '# nope',
      },
    });
    expect(create.statusCode).toBe(400);
    await app.close();
  }, 15_000);
});
