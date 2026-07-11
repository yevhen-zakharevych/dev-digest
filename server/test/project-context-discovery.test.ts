import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import Fastify, { type RouteOptions } from 'fastify';
import { validatorCompiler, serializerCompiler } from 'fastify-type-provider-zod';
import {
  assignBucket,
  categorizeDocuments,
  isAttachableDocumentPath,
  estimateTokens,
  toDiscoveredDocuments,
  buildSummary,
} from '../src/modules/project-context/service.js';
import { DEFAULT_BUCKET_DIRS, CONTEXT_ROUTE_RATE_LIMIT } from '../src/modules/project-context/constants.js';
import { SimpleGitClient } from '../src/adapters/git/simple-git.js';
import contextRoutes from '../src/modules/project-context/routes.js';

/**
 * Pure hermetic coverage for Project Context discovery (T7 / docs/plans/
 * project-context.md). No DB, no GitClient — plain-object-in/out, so this is
 * a plain `*.test.ts` (not `.it.test.ts`). DB/git-backed round-trips live in
 * `test/context-module.it.test.ts`.
 *
 * The `SimpleGitClient` describe block below is the exception — it drives the
 * REAL adapter against real temp directories (still no DB, no network), which
 * is the only way to exercise FIX 3 (symlinked clone-root ancestor) and the
 * real-adapter side of FIX 4 (case-insensitive `.md`), since `MockGitClient`
 * (`src/adapters/mocks.ts`) has its own separate, case-sensitive
 * `endsWith('.md')` filter that this task does not own/touch.
 */

describe('assignBucket', () => {
  it('assigns a file in a single bucket folder to that bucket', () => {
    expect(assignBucket('specs/x.md', DEFAULT_BUCKET_DIRS)).toBe('specs');
    expect(assignBucket('docs/architecture/invariants.md', DEFAULT_BUCKET_DIRS)).toBe('docs');
    expect(assignBucket('insights/x.md', DEFAULT_BUCKET_DIRS)).toBe('insights');
  });

  it('returns null for a file outside every bucket folder', () => {
    expect(assignBucket('README.md', DEFAULT_BUCKET_DIRS)).toBeNull();
    expect(assignBucket('src/modules/context/service.md', DEFAULT_BUCKET_DIRS)).toBeNull();
  });

  it('AC-4: assigns the OUTERMOST matching bucket, deterministically on repeat', () => {
    // docs/specs/x.md matches both `docs` and `specs` — outermost (docs) wins.
    expect(assignBucket('docs/specs/x.md', DEFAULT_BUCKET_DIRS)).toBe('docs');
    // Called again — same input, same result (no hidden state / randomness).
    expect(assignBucket('docs/specs/x.md', DEFAULT_BUCKET_DIRS)).toBe('docs');

    // MUTATION CHECK: reversing the segment walk (right-to-left, i.e. picking
    // the LAST match instead of the first) would flip this to 'specs' — this
    // assertion is the one that would catch that regression.
  });

  it('does not treat the filename itself as a bucket, even if it matches a bucket name', () => {
    // A file literally named "docs.md" at repo root has no bucket FOLDER.
    expect(assignBucket('docs.md', DEFAULT_BUCKET_DIRS)).toBeNull();
  });

  it('AC-3: a configurable bucket set changes which folders are discovered', () => {
    // Narrow the configured set to just `docs` — `specs/x.md` no longer matches.
    expect(assignBucket('specs/x.md', ['docs'])).toBeNull();
    expect(assignBucket('docs/x.md', ['docs'])).toBe('docs');

    // Widen back to include `insights` — a folder excluded by the narrowed
    // set above becomes discoverable again purely because it's back in the
    // configured set. (FIX 6b: `bucketDirs` is typed `readonly
    // DocumentBucket[]`, not `readonly string[]` — the configured set is
    // deliberately limited to the wire enum's members by construction, so
    // this no longer accepts an arbitrary bucket name like the previous
    // version of this test did.)
    expect(assignBucket('insights/x.md', ['docs', 'insights'])).toBe('insights');
  });
});

describe('categorizeDocuments', () => {
  it('keeps EVERY .md file, tagging out-of-bucket files with bucket null (all-markdown discovery)', () => {
    const entries = [
      { path: 'specs/a.md', bytes: 40 },
      { path: 'README.md', bytes: 100 },
      { path: 'docs/guide.md', bytes: 20 },
      { path: 'src/notes.md', bytes: 5 },
    ];
    const result = categorizeDocuments(entries, DEFAULT_BUCKET_DIRS);
    expect(result.map((r) => r.entry.path)).toEqual([
      'specs/a.md',
      'README.md',
      'docs/guide.md',
      'src/notes.md',
    ]);
    expect(result.map((r) => r.bucket)).toEqual(['specs', null, 'docs', null]);
  });

  it('the same filename in two different buckets yields two distinct entries', () => {
    const entries = [
      { path: 'specs/x.md', bytes: 8 },
      { path: 'docs/x.md', bytes: 8 },
    ];
    const result = categorizeDocuments(entries, DEFAULT_BUCKET_DIRS);
    expect(result).toHaveLength(2);
    expect(result.map((r) => `${r.bucket}:${r.entry.path}`)).toEqual([
      'specs:specs/x.md',
      'docs:docs/x.md',
    ]);
  });

  it('a changed bucket-dir configuration changes which files get a bucket, but never drops a file (AC-3)', () => {
    const entries = [
      { path: 'specs/a.md', bytes: 10 },
      { path: 'docs/b.md', bytes: 10 },
      { path: 'insights/c.md', bytes: 10 },
    ];
    // Default set — all three get their bucket.
    expect(categorizeDocuments(entries, DEFAULT_BUCKET_DIRS).map((r) => r.bucket)).toEqual([
      'specs',
      'docs',
      'insights',
    ]);
    // Narrowed config — only `docs` is a recognised bucket now; the other two
    // are STILL discovered, just with bucket null (all files always surface).
    expect(categorizeDocuments(entries, ['docs']).map((r) => `${r.entry.path}:${r.bucket}`)).toEqual([
      'specs/a.md:null',
      'docs/b.md:docs',
      'insights/c.md:null',
    ]);
  });
});

describe('estimateTokens', () => {
  it('is the byte/4 heuristic, ceiling-rounded', () => {
    expect(estimateTokens(4)).toBe(1);
    expect(estimateTokens(5)).toBe(2);
    expect(estimateTokens(400)).toBe(100);
  });

  it('a zero-byte file estimates to zero tokens', () => {
    expect(estimateTokens(0)).toBe(0);
  });
});

describe('toDiscoveredDocuments', () => {
  it('carries path, bucket (or null), estimated_tokens, and used_by_agents per document (AC-2)', () => {
    const categorized = [
      { entry: { path: 'specs/a.md', bytes: 40 }, bucket: 'specs' as const },
      { entry: { path: 'docs/b.md', bytes: 0 }, bucket: 'docs' as const },
      { entry: { path: 'README.md', bytes: 40 }, bucket: null },
    ];
    const usage = new Map([['specs/a.md', 3]]);
    const docs = toDiscoveredDocuments(categorized, usage);
    expect(docs).toEqual([
      { path: 'specs/a.md', bucket: 'specs', estimated_tokens: 10, used_by_agents: 3 },
      { path: 'docs/b.md', bucket: 'docs', estimated_tokens: 0, used_by_agents: 0 },
      { path: 'README.md', bucket: null, estimated_tokens: 10, used_by_agents: 0 },
    ]);
  });

  it('defaults used_by_agents to 0 when no usage map is supplied', () => {
    const categorized = [{ entry: { path: 'specs/a.md', bytes: 4 }, bucket: 'specs' as const }];
    expect(toDiscoveredDocuments(categorized)).toEqual([
      { path: 'specs/a.md', bucket: 'specs', estimated_tokens: 1, used_by_agents: 0 },
    ]);
  });
});

describe('buildSummary', () => {
  it('sums estimated_tokens across all documents and echoes document_count + refreshedAt (AC-7)', () => {
    const documents = [
      { path: 'specs/a.md', bucket: 'specs' as const, estimated_tokens: 10, used_by_agents: 0 },
      { path: 'docs/b.md', bucket: 'docs' as const, estimated_tokens: 25, used_by_agents: 0 },
    ];
    const summary = buildSummary(documents, '2026-07-10T00:00:00.000Z');
    expect(summary).toEqual({
      document_count: 2,
      total_estimated_tokens: 35,
      refreshed_at: '2026-07-10T00:00:00.000Z',
    });
  });

  it('an empty document set summarises to zero count and zero tokens', () => {
    expect(buildSummary([], '2026-07-10T00:00:00.000Z')).toEqual({
      document_count: 0,
      total_estimated_tokens: 0,
      refreshed_at: '2026-07-10T00:00:00.000Z',
    });
  });
});

describe('isAttachableDocumentPath (.md allowlist)', () => {
  it('accepts any .md path — bucketed OR outside all buckets (all-markdown discovery)', () => {
    expect(isAttachableDocumentPath('specs/a.md')).toBe(true);
    expect(isAttachableDocumentPath('docs/guide.md')).toBe(true);
    // A repo-root doc (no bucket) is now a first-class, editable document.
    expect(isAttachableDocumentPath('README.md')).toBe(true);
    expect(isAttachableDocumentPath('CHANGELOG.md')).toBe(true);
  });

  it('still rejects .git/config — the direct RCE/secret sink is not a .md file', () => {
    expect(isAttachableDocumentPath('.git/config')).toBe(false);
    expect(isAttachableDocumentPath('.git/hooks/pre-commit')).toBe(false);
  });

  it('matches the .md extension case-insensitively', () => {
    expect(isAttachableDocumentPath('README.MD')).toBe(true);
    expect(isAttachableDocumentPath('docs/Spec.Md')).toBe(true);
  });

  it('rejects a non-.md file anywhere', () => {
    expect(isAttachableDocumentPath('specs/notes.txt')).toBe(false);
    expect(isAttachableDocumentPath('package.json')).toBe(false);
  });

  // MUTATION CHECK (reported by the implementer, not asserted in code): removing
  // the `.toLowerCase().endsWith('.md')` guard lets `.git/config` and other
  // non-document files through — verified to flip the `.git/config` test above
  // red, then reverted. This `.md` requirement is what keeps the direct
  // secret/RCE sink refused after the bucket-folder requirement was dropped.
});

describe('SimpleGitClient — real adapter against real temp directories', () => {
  const tmpDirs: string[] = [];
  afterEach(async () => {
    await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('FIX 4: discovers mixed-case .md files (README.MD, Spec.Md), not just lowercase .md', async () => {
    const cloneDir = await mkdtemp(join(tmpdir(), 'ctx-case-'));
    tmpDirs.push(cloneDir);
    const repoRoot = join(cloneDir, 'acme', 'case-repo');
    await mkdir(join(repoRoot, 'docs'), { recursive: true });
    await writeFile(join(repoRoot, 'README.MD'), 'root readme, uppercase ext');
    await writeFile(join(repoRoot, 'docs', 'Spec.Md'), 'mixed-case ext');
    await writeFile(join(repoRoot, 'docs', 'guide.md'), 'lowercase ext, for contrast');

    const git = new SimpleGitClient(cloneDir);
    const repo = { owner: 'acme', name: 'case-repo' };
    const entries = await git.listMarkdownFilesSafe(repo);

    expect(entries).not.toBeNull();
    const paths = (entries ?? []).map((e) => e.path).sort();
    expect(paths).toEqual(['README.MD', 'docs/Spec.Md', 'docs/guide.md']);
  });

  it('FIX 3: a symlinked ancestor of the clone dir does not make discovery list files that readFileSafe/writeFileSafe then refuse', async () => {
    // Simulate macOS /tmp -> /private/tmp: cloneDir is reached ONLY via a
    // symlink, never directly.
    const realBase = await mkdtemp(join(tmpdir(), 'ctx-real-'));
    tmpDirs.push(realBase);
    const symBase = join(tmpdir(), `ctx-sym-${randomUUID()}`);
    await symlink(realBase, symBase, 'dir');
    tmpDirs.push(symBase);

    const repoRoot = join(realBase, 'acme', 'sym-repo');
    await mkdir(join(repoRoot, 'docs'), { recursive: true });
    await writeFile(join(repoRoot, 'docs', 'x.md'), 'hello through a symlinked ancestor');

    // Client is rooted at the SYMLINK, not the real directory.
    const git = new SimpleGitClient(symBase);
    const repo = { owner: 'acme', name: 'sym-repo' };

    const entries = await git.listMarkdownFilesSafe(repo);
    expect(entries).not.toBeNull();
    expect((entries ?? []).map((e) => e.path)).toEqual(['docs/x.md']);

    // Every discovered path must actually be readable through the same guard.
    const text = await git.readFileSafe(repo, 'docs/x.md');
    expect(text).toBe('hello through a symlinked ancestor');

    const wrote = await git.writeFileSafe(repo, 'docs/x.md', 'updated through symlink');
    expect(wrote).toBe(true);
    expect(await git.readFileSafe(repo, 'docs/x.md')).toBe('updated through symlink');
  });

  it('a real traversal escape is still refused after realpathing both sides of the comparison (safeResolve is not weakened by FIX 3)', async () => {
    const cloneDir = await mkdtemp(join(tmpdir(), 'ctx-traversal-'));
    tmpDirs.push(cloneDir);
    const repoRoot = join(cloneDir, 'acme', 'traversal-repo');
    await mkdir(repoRoot, { recursive: true });
    await writeFile(join(cloneDir, 'outside.md'), 'must never be reachable');

    const git = new SimpleGitClient(cloneDir);
    const repo = { owner: 'acme', name: 'traversal-repo' };

    expect(await git.readFileSafe(repo, '../outside.md')).toBeNull();
    expect(await git.writeFileSafe(repo, '../outside.md', 'pwned')).toBe(false);
  });
});

describe('context routes — per-route rate limit (FIX 5)', () => {
  it('the GET .../doc read route carries the same rate limit as discovery and save, not just the 120/min global default', async () => {
    // Registers the real routes.ts plugin directly (no DB, no HTTP listen) so
    // the ONLY thing under test is the static route config each handler was
    // registered with — `@fastify/rate-limit` itself is never loaded here
    // (and is disabled under NODE_ENV=test in the full app, `src/app.ts`), so
    // asserting an actual 429 isn't possible in this test harness; asserting
    // the wired `config.rateLimit` is the closest available proof.
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);
    // `routes.ts` only stores `container.db` on construction and never reads
    // it during plugin registration — a stub is sufficient here.
    app.decorate('container', { db: {} } as unknown as import('../src/platform/container.js').Container);

    const configsByRoute: Record<string, RouteOptions['config']> = {};
    app.addHook('onRoute', (opts) => {
      configsByRoute[`${opts.method} ${opts.url}`] = opts.config;
    });

    await app.register(contextRoutes);
    await app.ready();

    const discoverConfig = configsByRoute['GET /repos/:repoId/project-context'];
    const readConfig = configsByRoute['GET /repos/:repoId/project-context/doc'];
    const saveConfig = configsByRoute['PUT /repos/:repoId/project-context/doc'];

    expect(readConfig).toMatchObject({ rateLimit: CONTEXT_ROUTE_RATE_LIMIT });
    // Same ceiling on all three filesystem-touching routes — not a
    // coincidence, the read route was the one missing it (FIX 5).
    expect(discoverConfig).toMatchObject({ rateLimit: CONTEXT_ROUTE_RATE_LIMIT });
    expect(saveConfig).toMatchObject({ rateLimit: CONTEXT_ROUTE_RATE_LIMIT });

    await app.close();

    // MUTATION CHECK: verified by temporarily removing the
    // `config: { rateLimit: CONTEXT_ROUTE_RATE_LIMIT }` block from the GET
    // .../doc route in `src/modules/project-context/routes.ts` — `readConfig` above
    // came back `undefined` and the assertion went red, then the config was
    // restored.
  });
});
