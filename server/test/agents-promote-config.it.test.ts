import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { startPg, dockerAvailable, type PgFixture } from './helpers/pg.js';
import * as t from '../src/db/schema.js';
import { AgentsRepository } from '../src/modules/agents/repository.js';
import { resolveEffectiveConfig } from '../src/modules/agents/effective-config.js';
import type { EvalEffectiveConfig } from '@devdigest/shared';

const hasDocker = await dockerAvailable();
const d = hasDocker ? describe : describe.skip;

if (!hasDocker) {
  // eslint-disable-next-line no-console
  console.warn('[agents-promote-config] Docker not available — skipping integration tests.');
}

/**
 * `AgentsRepository.promoteConfig` (AC-27) + the eval-case cascade (AC-53).
 *
 * These assertions are the reason T7 exists. Both of the bugs they guard are
 * SILENT AND GREEN in the obvious implementation:
 *
 *  - a promote that differs from the live agent ONLY in its skill set produces
 *    NO version and NO snapshot if the bump is routed through `update()`
 *    (`isConfigChange` ignores skills; `UpdateAgent` has no `skills` field), and
 *  - `update()` snapshots INTERNALLY, so `update()`-then-`setSkills()` writes a
 *    snapshot describing the PRE-promote skill links.
 *
 * Mutation-checked: reverting either detail turns tests in here red.
 */
d('AgentsRepository.promoteConfig / eval-case cascade', () => {
  let pg: PgFixture;
  let wsId: string;

  beforeAll(async () => {
    pg = await startPg();
    const [ws] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: 'promote-ws' })
      .returning();
    wsId = ws!.id;
  });
  afterAll(async () => {
    await pg?.stop();
  });

  const repo = () => new AgentsRepository(pg.handle.db);

  async function makeSkill(name: string, body = `body of ${name}`, version = 1) {
    const [row] = await pg.handle.db
      .insert(t.skills)
      .values({
        workspaceId: wsId,
        name,
        description: '',
        type: 'rubric',
        source: 'manual',
        body,
        version,
      })
      .returning();
    return row!;
  }

  async function makeAgent(name: string) {
    return repo().insert({
      workspaceId: wsId,
      name,
      provider: 'openai',
      model: 'gpt-4o-mini',
      systemPrompt: 'Review the diff.',
    });
  }

  /** The effective config as it stands live right now — the run's pin is a copy of this. */
  async function liveConfig(agentId: string): Promise<EvalEffectiveConfig> {
    const r = repo();
    const agent = (await r.getById(wsId, agentId))!;
    return resolveEffectiveConfig(agent, await r.linkedSkills(agentId)).config;
  }

  async function snapshotSkills(agentId: string, version: number): Promise<string[]> {
    const snap = await repo().getVersion(agentId, version);
    return (snap!.configJson as { skills: string[] }).skills;
  }

  // ---------------------------------------------------------------- the landmine
  it('a SKILL-ONLY promote still appends a new version, and its snapshot holds the PROMOTED skills', async () => {
    const r = repo();
    const agent = await makeAgent('Skill-only promote');
    const a = await makeSkill('A');
    const b = await makeSkill('B');

    // The run ran with [A]. Pin that.
    await r.setSkills(agent.id, [a.id]);
    const pinned = await liveConfig(agent.id);
    expect(pinned.skills.map((s) => s.id)).toEqual([a.id]);

    // Since the run, someone linked B. `setSkills` bumps NO version — the agent
    // is still v1, so the version tag alone cannot see this regression.
    await r.setSkills(agent.id, [a.id, b.id]);
    const before = (await r.getById(wsId, agent.id))!;
    expect(before.version).toBe(1);

    const result = await r.promoteConfig(wsId, agent.id, pinned);

    // (1) The bump happened even though NO `agents`-row field changed.
    expect(result!.version).toBe(2);
    expect((await r.getById(wsId, agent.id))!.version).toBe(2);
    const versions = await r.listVersions(agent.id);
    expect(versions.map((v) => v.version)).toEqual([2, 1]); // newest-first, append-only
    expect(versions).toHaveLength(2);

    // (2) The new snapshot describes the PROMOTED links, not the pre-promote ones.
    //     (Snapshotting before `setSkills` would record [A, B] here.)
    expect(await snapshotSkills(agent.id, 2)).toEqual([a.id]);

    // (3) …and the links themselves are the promoted set.
    expect((await r.linkedSkills(agent.id)).map((l) => l.skill.id)).toEqual([a.id]);
    expect((await liveConfig(agent.id)).skills.map((s) => s.id)).toEqual([a.id]);
    expect(result!.config).toEqual(pinned);
  });

  it('promotes the whole config: prompt/provider/model/strategy/repo_intel AND the skill links', async () => {
    const r = repo();
    const agent = await makeAgent('Whole config');
    const a = await makeSkill('Naming');
    const b = await makeSkill('Security');
    await r.setSkills(agent.id, [a.id, b.id]);

    const pinned = await liveConfig(agent.id); // v1, [Naming, Security]

    // Drift the live agent away on every axis (v2), and drop a skill.
    await r.update(wsId, agent.id, {
      systemPrompt: 'new prompt',
      provider: 'anthropic',
      model: 'claude-sonnet-4',
      strategy: 'map-reduce',
      repoIntel: false,
    });
    await r.setSkills(agent.id, [b.id]);

    const result = await r.promoteConfig(wsId, agent.id, pinned);

    const live = (await r.getById(wsId, agent.id))!;
    expect(live.systemPrompt).toBe('Review the diff.');
    expect(live.provider).toBe('openai');
    expect(live.model).toBe('gpt-4o-mini');
    expect(live.strategy).toBe('single-pass');
    expect(live.repoIntel).toBe(true);
    expect(live.version).toBe(3);

    // Live config == the promoted one, skill links included (AC-27's observable).
    expect(await liveConfig(agent.id)).toEqual(pinned);
    expect(result!.config).toEqual(pinned);
    expect(await snapshotSkills(agent.id, 3)).toEqual([a.id, b.id]);

    // Append-only: no version deleted or rewritten.
    expect((await r.listVersions(agent.id)).map((v) => v.version)).toEqual([3, 2, 1]);
    expect((await r.getVersion(agent.id, 2))!.configJson).toMatchObject({ model: 'claude-sonnet-4' });
  });

  it('restores the pinned per-link `enabled`, not the live one (setSkills would preserve the live flag)', async () => {
    const r = repo();
    const agent = await makeAgent('Enabled flag');
    const a = await makeSkill('Rubric');
    await r.setSkills(agent.id, [a.id]);

    const pinned = await liveConfig(agent.id); // link enabled ⇒ skill reached the prompt
    expect(pinned.skills[0]!.enabled).toBe(true);

    // Someone disabled the LINK after the run — the skill stops reaching the prompt.
    await r.setLinkEnabled(agent.id, a.id, false);
    expect((await liveConfig(agent.id)).skills).toEqual([]);

    await r.promoteConfig(wsId, agent.id, pinned);

    // A half-restore (link back but still disabled) would ship a config the run
    // never measured.
    expect(await liveConfig(agent.id)).toEqual(pinned);
    expect((await r.linkedSkills(agent.id))[0]!.enabled).toBe(true);
  });

  it('reports skill_version_divergence when a pinned skill’s live body version has moved on', async () => {
    const r = repo();
    const agent = await makeAgent('Divergence');
    const a = await makeSkill('Drifting', 'v1 body', 1);
    const b = await makeSkill('Stable', 'stable body', 4);
    await r.setSkills(agent.id, [a.id, b.id]);

    const pinned = await liveConfig(agent.id);
    expect(pinned.skills.map((s) => s.version)).toEqual([1, 4]);

    // A body edit bumps the SKILL's own version only — nothing on the agent moves.
    await pg.handle.db
      .update(t.skills)
      .set({ body: 'v2 body', version: 2 })
      .where(eq(t.skills.id, a.id));

    const result = await r.promoteConfig(wsId, agent.id, pinned);

    expect(result!.skillVersionDivergence).toEqual([
      { skill_id: a.id, name: 'Drifting', pinned_version: 1, live_version: 2 },
    ]);
    // The promote still happened — and the LIVE config it reports is honest
    // about the content that is actually attached now (v2, not the pinned v1).
    expect(result!.config.skills.map((s) => s.version)).toEqual([2, 4]);
  });

  it('a pinned skill deleted since the run ⇒ rejected, and NOTHING is written (one transaction)', async () => {
    const r = repo();
    const agent = await makeAgent('Deleted skill');
    const a = await makeSkill('Doomed');
    const keep = await makeSkill('Keeper');
    await r.setSkills(agent.id, [a.id]);
    const pinned = await liveConfig(agent.id);

    await r.setSkills(agent.id, [keep.id]);
    await pg.handle.db.delete(t.skills).where(eq(t.skills.id, a.id));

    // The repository REPORTS the refusal; it does not decide it is an HTTP 400
    // (that is `EvalService.promote`'s call — no repository in this codebase
    // raises HTTP errors). Returning still aborts before any write.
    const outcome = await r.promoteConfig(wsId, agent.id, pinned);
    expect(outcome).toBeDefined();
    expect(outcome!.ok).toBe(false);
    expect(outcome!.ok === false && outcome!.reason).toBe('missing_skills');
    expect(outcome!.ok === false && outcome!.missingSkills.map((s) => s.name)).toEqual(['Doomed']);

    // Nothing written: links untouched, no version appended.
    expect((await r.linkedSkills(agent.id)).map((l) => l.skill.id)).toEqual([keep.id]);
    expect((await r.getById(wsId, agent.id))!.version).toBe(1);
    expect(await r.listVersions(agent.id)).toHaveLength(1);
  });

  it('is workspace-scoped: promoting an agent of another workspace is a no-op (undefined)', async () => {
    const r = repo();
    const agent = await makeAgent('Foreign');
    const pinned = await liveConfig(agent.id);
    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other-${Date.now()}` })
      .returning();

    expect(await r.promoteConfig(otherWs!.id, agent.id, pinned)).toBeUndefined();
    expect((await r.getById(wsId, agent.id))!.version).toBe(1);
    expect(await r.listVersions(agent.id)).toHaveLength(1);
  });

  // ---------------------------------------------------------------- AC-53 cascade
  it('deleting an agent deletes its eval cases (no FK ⇒ no DB cascade), and only its own', async () => {
    const r = repo();
    const doomed = await makeAgent('Doomed agent');
    const survivor = await makeAgent('Survivor agent');
    const skill = await makeSkill('Owner skill');

    const cases = await pg.handle.db
      .insert(t.evalCases)
      .values([
        {
          workspaceId: wsId,
          ownerKind: 'agent' as const,
          ownerId: doomed.id,
          name: 'doomed case',
          inputDiff: 'diff',
          expectation: 'must_find' as const,
          inputFingerprint: 'fp1',
        },
        {
          workspaceId: wsId,
          ownerKind: 'agent' as const,
          ownerId: survivor.id,
          name: 'survivor case',
          inputDiff: 'diff',
          expectation: 'must_find' as const,
          inputFingerprint: 'fp2',
        },
        {
          // Same owner_id VALUE space, different owner_kind — must not be touched.
          workspaceId: wsId,
          ownerKind: 'skill' as const,
          ownerId: skill.id,
          name: 'skill case',
          inputDiff: 'diff',
          expectation: 'must_find' as const,
          inputFingerprint: 'fp3',
        },
      ])
      .returning();
    expect(cases).toHaveLength(3);

    // A run for the doomed agent cascades via its real agent_id FK.
    await pg.handle.db.insert(t.evalRuns).values({
      workspaceId: wsId,
      agentId: doomed.id,
      effectiveConfig: await liveConfig(doomed.id),
      status: 'done' as const,
      casesTotal: 1,
    });

    expect(await r.deleteById(wsId, doomed.id)).toBe(true);

    const remaining = await pg.handle.db
      .select({ name: t.evalCases.name })
      .from(t.evalCases)
      .where(eq(t.evalCases.workspaceId, wsId));
    expect(remaining.map((c) => c.name).sort()).toEqual(['skill case', 'survivor case']);

    const runs = await pg.handle.db
      .select({ id: t.evalRuns.id })
      .from(t.evalRuns)
      .where(and(eq(t.evalRuns.workspaceId, wsId), eq(t.evalRuns.agentId, doomed.id)));
    expect(runs).toEqual([]);
  });

  it('deleting a non-existent agent leaves the other workspace’s cases alone and returns false', async () => {
    const r = repo();
    const agent = await makeAgent('Not deleted here');
    await pg.handle.db.insert(t.evalCases).values({
      workspaceId: wsId,
      ownerKind: 'agent',
      ownerId: agent.id,
      name: 'kept case',
      inputDiff: 'diff',
      expectation: 'must_find',
      inputFingerprint: 'fp-keep',
    });

    const [otherWs] = await pg.handle.db
      .insert(t.workspaces)
      .values({ name: `other2-${Date.now()}` })
      .returning();

    // Right agent id, WRONG workspace ⇒ nothing deleted, cases intact.
    expect(await r.deleteById(otherWs!.id, agent.id)).toBe(false);
    const kept = await pg.handle.db
      .select({ id: t.evalCases.id })
      .from(t.evalCases)
      .where(and(eq(t.evalCases.ownerKind, 'agent'), eq(t.evalCases.ownerId, agent.id)));
    expect(kept).toHaveLength(1);
    expect(await r.getById(wsId, agent.id)).toBeDefined();
  });
});
