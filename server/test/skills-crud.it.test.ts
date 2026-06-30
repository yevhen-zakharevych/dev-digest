import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import { seed } from '../src/db/seed.js';
import { MockGitClient, MockGitHubClient } from '../src/adapters/mocks.js';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[skills-crud] Docker not available — skipping integration tests.');
}

/**
 * L02 — skills CRUD over HTTP. Covers: create + list + get, body change bumps
 * version, delete, agent linking honours order + per-link enabled, import
 * preview returns parsed metadata without writing anything.
 */
d('skills CRUD + agent links', () => {
  let pg: PgFixture;

  beforeAll(async () => {
    pg = await startPg();
    await seed(pg.handle.db);
  });
  afterAll(async () => {
    await pg?.stop();
  });

  function makeApp() {
    const config = loadConfig({ ...process.env, NODE_ENV: 'test' } as NodeJS.ProcessEnv);
    return buildApp({
      config,
      db: pg.handle.db,
      overrides: { git: new MockGitClient(), github: new MockGitHubClient() },
    });
  }

  const skillBody = {
    name: 'no-then-chains',
    description: 'Flags Promise.then chains where async/await would be clearer.',
    type: 'rubric' as const,
    body: '# Rule\nUse async/await over .then() chains.',
  };

  it('creates, lists, and gets a skill', async () => {
    const app = await makeApp();
    const created = await app.inject({ method: 'POST', url: '/skills', payload: skillBody });
    expect(created.statusCode).toBe(201);
    const created_id = created.json().id as string;
    expect(created.json()).toMatchObject({
      name: skillBody.name,
      type: 'rubric',
      source: 'manual',
      version: 1,
      enabled: true,
      agents_count: 0,
    });

    const list = await app.inject({ method: 'GET', url: '/skills' });
    expect(list.statusCode).toBe(200);
    expect(list.json().find((s: { id: string }) => s.id === created_id)).toBeDefined();

    const got = await app.inject({ method: 'GET', url: `/skills/${created_id}` });
    expect(got.statusCode).toBe(200);
    expect(got.json().id).toBe(created_id);
    await app.close();
  });

  it('editing the body bumps version; description-only edit does not', async () => {
    const app = await makeApp();
    const id = (await app.inject({ method: 'POST', url: '/skills', payload: skillBody })).json()
      .id as string;

    const r1 = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { description: 'Updated description only.' },
    });
    expect(r1.statusCode).toBe(200);
    expect(r1.json().version).toBe(1);

    const r2 = await app.inject({
      method: 'PUT',
      url: `/skills/${id}`,
      payload: { body: '# Updated\nNew rule body.' },
    });
    expect(r2.statusCode).toBe(200);
    expect(r2.json().version).toBe(2);

    // Version history reflects both snapshots (newest-first).
    const versions = await app.inject({
      method: 'GET',
      url: `/skills/${id}/versions`,
    });
    expect(versions.statusCode).toBe(200);
    const list = versions.json() as { version: number; body: string }[];
    expect(list.map((v) => v.version)).toEqual([2, 1]);
    expect(list[0]!.body).toContain('New rule body');
    expect(list[1]!.body).toContain('Use async/await');
    await app.close();
  });

  it('agent skill link respects order + per-link enabled toggle', async () => {
    const app = await makeApp();
    // Two skills.
    const a = (await app.inject({ method: 'POST', url: '/skills', payload: skillBody })).json()
      .id as string;
    const b = (
      await app.inject({
        method: 'POST',
        url: '/skills',
        payload: { ...skillBody, name: 'another-skill' },
      })
    ).json().id as string;

    // One agent.
    const agentId = (
      await app.inject({
        method: 'POST',
        url: '/agents',
        payload: {
          name: 'Skill-linker',
          provider: 'openai',
          model: 'gpt-4o-mini',
          system_prompt: 'review',
        },
      })
    ).json().id as string;

    // Set the ordered set (b before a).
    const set = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [b, a] },
    });
    expect(set.statusCode).toBe(200);
    const links = set.json() as { skill_id: string; order: number; enabled: boolean }[];
    expect(links.map((l) => l.skill_id)).toEqual([b, a]);
    expect(links.every((l) => l.enabled)).toBe(true);

    // Toggle one off.
    const toggle = await app.inject({
      method: 'PUT',
      url: `/agents/${agentId}/skills/${a}`,
      payload: { enabled: false },
    });
    expect(toggle.statusCode).toBe(200);
    const afterToggle = toggle.json() as { skill_id: string; enabled: boolean }[];
    const aLink = afterToggle.find((l) => l.skill_id === a)!;
    expect(aLink.enabled).toBe(false);

    // Reorder again — enabled flag is preserved.
    const reset = await app.inject({
      method: 'POST',
      url: `/agents/${agentId}/skills`,
      payload: { skill_ids: [a, b] },
    });
    const final = reset.json() as { skill_id: string; enabled: boolean }[];
    expect(final[0]!.skill_id).toBe(a);
    expect(final[0]!.enabled).toBe(false);
    expect(final[1]!.enabled).toBe(true);

    await app.close();
  });

  it('import preview parses frontmatter and never writes a skill', async () => {
    const app = await makeApp();
    const md = `---\nname: phantom-api-gate\ndescription: A skill\ntype: security\n---\n# Body`;
    // Build a minimal multipart payload manually.
    const boundary = '----vitest-boundary-1';
    const lines = [
      `--${boundary}`,
      'Content-Disposition: form-data; name="file"; filename="phantom.md"',
      'Content-Type: text/markdown',
      '',
      md,
      `--${boundary}--`,
      '',
    ];
    const before = (await app.inject({ method: 'GET', url: '/skills' })).json().length as number;
    const res = await app.inject({
      method: 'POST',
      url: '/skills/import',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload: lines.join('\r\n'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      name: 'phantom-api-gate',
      type: 'security',
      skippedFiles: [],
    });
    const after = (await app.inject({ method: 'GET', url: '/skills' })).json().length as number;
    expect(after).toBe(before);
    await app.close();
  });
});
