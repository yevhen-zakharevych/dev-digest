import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';

/**
 * Blast Radius (L04, tasks S1+S2) — integration coverage for `BlastService`
 * via `GET /pulls/:id/blast`. DB-backed ⇒ `.it.test.ts` (testcontainers
 * Postgres). Compute-on-read from the persistent repo-intel index — NO LLM
 * call.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

/** Create a repo + a PR with the given changed files (pr_files rows). */
async function setupRepoAndPr(
  db: PgFixture['handle']['db'],
  workspaceId: string,
  changedFiles: string[],
) {
  const name = `blast-pr-${repoSeq++}`;
  const [repo] = await db
    .insert(t.repos)
    .values({ workspaceId, owner: 'acme', name, fullName: `acme/${name}` })
    .returning();
  const [pr] = await db
    .insert(t.pullRequests)
    .values({
      workspaceId,
      repoId: repo!.id,
      number: 701,
      title: 'Change doFoo',
      author: 'marisa.koch',
      branch: 'feat/foo',
      base: 'main',
      headSha: 'deadbeef',
      additions: 5,
      deletions: 0,
      filesCount: changedFiles.length,
      status: 'needs_review',
      body: 'Changes doFoo.',
    })
    .returning();
  if (changedFiles.length > 0) {
    await db
      .insert(t.prFiles)
      .values(changedFiles.map((path) => ({ prId: pr!.id, path, additions: 5, deletions: 0 })));
  }
  return { repo: repo!, pr: pr! };
}

/** Seed a full persistent repo-intel index: symbols, resolved references,
 *  file_rank, and file_facts — enough for `tryPersistentBlast` to serve. */
async function seedIndex(
  db: PgFixture['handle']['db'],
  repoId: string,
  opts: {
    declFile: string;
    symbolName: string;
    callerFiles: string[];
  },
) {
  const { declFile, symbolName, callerFiles } = opts;

  await db.insert(t.symbols).values({
    repoId,
    path: declFile,
    name: symbolName,
    kind: 'function',
    line: 1,
    endLine: 3,
    exported: true,
  });

  // One resolved reference per caller file, each in its OWN enclosing symbol
  // (so blastResultToContract's "callers" each get a distinct caller name).
  for (const [i, file] of callerFiles.entries()) {
    await db.insert(t.symbols).values({
      repoId,
      path: file,
      name: `caller${i}`,
      kind: 'function',
      line: 1,
      endLine: 5,
      exported: false,
    });
    await db.insert(t.references).values({
      repoId,
      fromPath: file,
      toSymbol: symbolName,
      line: 3,
      declFile, // pre-resolved (bypasses resolveReferences graph-walk)
    });
    await db.insert(t.fileRank).values({
      repoId,
      filePath: file,
      pagerank: 1 - i * 0.01,
      hotness: 0,
      rank: callerFiles.length - i, // descending — first file ranks highest
      percentile: 50,
    });
  }

  await db.insert(t.repoIndexState).values({
    repoId,
    lastIndexedSha: 'deadbeef',
    indexerVersion: 2,
    status: 'full',
    filesIndexed: callerFiles.length + 1,
    filesSkipped: 0,
    stats: {},
  });
}

d('Blast Radius (L04) — service + routes (Testcontainers pg)', () => {
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

  function appWith() {
    return buildApp({ config: config(), db: pg.handle.db });
  }

  it('returns grouped downstream[] with endpoints attributed, from the persistent index', async () => {
    const app = await appWith();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, ['src/foo.ts']);

    await seedIndex(pg.handle.db, repo.id, {
      declFile: 'src/foo.ts',
      symbolName: 'doFoo',
      callerFiles: ['src/routes/foo-route.ts'],
    });
    await pg.handle.db.insert(t.fileFacts).values({
      repoId: repo.id,
      filePath: 'src/routes/foo-route.ts',
      endpoints: ['GET /foo'],
      crons: [],
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const blast = res.json();

    expect(blast.changed_symbols).toEqual([{ name: 'doFoo', file: 'src/foo.ts', kind: 'function' }]);
    expect(blast.downstream).toHaveLength(1);
    expect(blast.downstream[0].symbol).toBe('doFoo');
    expect(blast.downstream[0].callers).toEqual([
      { name: 'caller0', file: 'src/routes/foo-route.ts', line: 3 },
    ]);
    expect(blast.downstream[0].endpoints_affected).toEqual(['GET /foo']);
    expect(typeof blast.summary).toBe('string');
    expect(blast.summary.length).toBeGreaterThan(0);

    await app.close();
  });

  it('caps a single symbol group at 20 callers even with a larger persistent fan-out', async () => {
    const app = await appWith();
    const { repo, pr } = await setupRepoAndPr(pg.handle.db, workspaceId, ['src/foo.ts']);

    const callerFiles = Array.from({ length: 25 }, (_, i) => `src/callers/c${i}.ts`);
    await seedIndex(pg.handle.db, repo.id, {
      declFile: 'src/foo.ts',
      symbolName: 'doFoo',
      callerFiles,
    });

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const blast = res.json();

    expect(blast.downstream).toHaveLength(1);
    expect(blast.downstream[0].callers).toHaveLength(20);

    await app.close();
  });

  it('degraded fixture (no index for the repo) returns a contract-valid non-empty summary + empty arrays, not a 500', async () => {
    const app = await appWith();
    const { pr } = await setupRepoAndPr(pg.handle.db, workspaceId, ['src/unindexed.ts']);
    // No seedIndex call — the repo has zero repo_index_state / symbols rows.

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(200);
    const blast = res.json();

    expect(blast.changed_symbols).toEqual([]);
    expect(blast.downstream).toEqual([]);
    expect(typeof blast.summary).toBe('string');
    expect(blast.summary.length).toBeGreaterThan(0);

    await app.close();
  });

  it('returns 404 for a PR that belongs to a different workspace than the request context', async () => {
    const app = await appWith();
    const [otherWorkspace] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'other-workspace-blast' })
      .returning();
    const { pr } = await setupRepoAndPr(pg.handle.db, otherWorkspace!.id, ['src/foo.ts']);

    const res = await app.inject({ method: 'GET', url: `/pulls/${pr.id}/blast` });
    expect(res.statusCode).toBe(404);

    await app.close();
  });
});
