import { describe, it, expect } from 'vitest';
import { EvalEffectiveConfig } from '@devdigest/shared';
import { activeSkillLinks, resolveEffectiveConfig } from './effective-config.js';
import type { AgentRow, LinkedSkillRow } from './repository.js';

/**
 * Pure unit tests for the effective-config resolver (AC-10, AC-15, AC-51).
 * No DB: the resolver is a pure function of an agent row + its skill links —
 * which is the whole point of pinning by value rather than dereferencing
 * `agent_versions` at read time.
 */

function agentRow(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: 'a1',
    workspaceId: 'ws1',
    name: 'Security Reviewer',
    description: 'd',
    provider: 'anthropic',
    model: 'claude-sonnet-4',
    systemPrompt: 'Review the diff.',
    outputSchema: null,
    strategy: 'map-reduce',
    ciFailOn: 'critical',
    repoIntel: true,
    attachedDocs: null,
    enabled: true,
    version: 7,
    createdBy: null,
    createdAt: new Date('2026-07-13T00:00:00Z'),
    ...over,
  } as AgentRow;
}

function link(
  over: Partial<{
    id: string;
    name: string;
    body: string;
    version: number;
    skillEnabled: boolean;
    linkEnabled: boolean;
    order: number;
  }> = {},
): LinkedSkillRow {
  const {
    id = 's1',
    name = 'Skill One',
    body = 'body one',
    version = 1,
    skillEnabled = true,
    linkEnabled = true,
    order = 0,
  } = over;
  return {
    skill: {
      id,
      workspaceId: 'ws1',
      name,
      description: '',
      type: 'rubric',
      source: 'manual',
      body,
      enabled: skillEnabled,
      version,
      evidenceFiles: null,
      attachedDocs: null,
      createdAt: new Date('2026-07-13T00:00:00Z'),
    } as LinkedSkillRow['skill'],
    order,
    enabled: linkEnabled,
  };
}

describe('resolveEffectiveConfig', () => {
  it('pins the agent-row fields by value (AC-10)', () => {
    const { config } = resolveEffectiveConfig(
      agentRow({
        systemPrompt: 'You are picky.',
        provider: 'openai',
        model: 'gpt-4o',
        strategy: 'single-pass',
        repoIntel: false,
      }),
      [],
    );

    expect(config).toEqual({
      system_prompt: 'You are picky.',
      provider: 'openai',
      model: 'gpt-4o',
      strategy: 'single-pass',
      repo_intel: false,
      skills: [],
    });
    // It parses as the contract (and therefore carries no version pointer).
    expect(() => EvalEffectiveConfig.parse(config)).not.toThrow();
  });

  it('never pins the agent version — the pin has no such field (AC-10/AC-51)', () => {
    const { config } = resolveEffectiveConfig(agentRow({ version: 7 }), [link()]);
    expect(config).not.toHaveProperty('version');
    expect(config).not.toHaveProperty('agent_version');
    expect(JSON.stringify(config)).not.toContain('"7"');
  });

  it('resolves each surviving skill with its identity, VERSION, order and enabled', () => {
    const { config } = resolveEffectiveConfig(agentRow(), [
      link({ id: 's1', name: 'Naming', version: 3, order: 0 }),
      link({ id: 's2', name: 'Security', version: 11, order: 1 }),
    ]);

    expect(config.skills).toEqual([
      { id: 's1', name: 'Naming', version: 3, order: 0, enabled: true },
      { id: 's2', name: 'Security', version: 11, order: 1, enabled: true },
    ]);
  });

  it('carries NO skill bodies in the pin, and returns them separately as skillBodies', () => {
    const { config, skillBodies } = resolveEffectiveConfig(agentRow(), [
      link({ id: 's1', body: 'never inline me', order: 0 }),
    ]);

    expect(JSON.stringify(config)).not.toContain('never inline me');
    expect(config.skills[0]).not.toHaveProperty('body');
    // The engine wants bodies, not ids (`reviewer-core/src/review/run.ts:56`).
    expect(skillBodies).toEqual(['never inline me']);
  });

  it('applies the REVIEW PATH filter exactly: link disabled OR skill disabled ⇒ excluded (AC-15)', () => {
    const links = [
      link({ id: 'keep', body: 'kept', order: 0 }),
      link({ id: 'link-off', body: 'link-off', order: 1, linkEnabled: false }),
      link({ id: 'skill-off', body: 'skill-off', order: 2, skillEnabled: false }),
      link({ id: 'both-off', body: 'both-off', order: 3, linkEnabled: false, skillEnabled: false }),
    ];

    const { config, skillBodies } = resolveEffectiveConfig(agentRow(), links);

    expect(config.skills.map((s) => s.id)).toEqual(['keep']);
    expect(skillBodies).toEqual(['kept']);
    // Same predicate, one source of truth.
    expect(activeSkillLinks(links).map((l) => l.skill.id)).toEqual(['keep']);
  });

  it('orders both outputs by agent_skills.order, whatever order the rows arrive in', () => {
    const { config, skillBodies } = resolveEffectiveConfig(agentRow(), [
      link({ id: 'c', body: 'C', order: 2 }),
      link({ id: 'a', body: 'A', order: 0 }),
      link({ id: 'b', body: 'B', order: 1 }),
    ]);

    expect(config.skills.map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(skillBodies).toEqual(['A', 'B', 'C']);
  });

  it('the pin and the bodies always describe the SAME skill set (they cannot drift)', () => {
    const links = [
      link({ id: 's1', body: 'B1', order: 0 }),
      link({ id: 's2', body: 'B2', order: 1, linkEnabled: false }),
      link({ id: 's3', body: 'B3', order: 2 }),
    ];
    const { config, skillBodies } = resolveEffectiveConfig(agentRow(), links);
    expect(skillBodies).toHaveLength(config.skills.length);
    expect(skillBodies).toEqual(['B1', 'B3']);
  });

  it('two agents on the SAME version tag but different skill sets pin DIFFERENT configs (AC-51)', () => {
    const before = resolveEffectiveConfig(agentRow({ version: 7 }), [
      link({ id: 's1', name: 'Naming', version: 3 }),
    ]);
    // A skill was linked, and a body edit bumped s1 — neither bumps agents.version.
    const after = resolveEffectiveConfig(agentRow({ version: 7 }), [
      link({ id: 's1', name: 'Naming', version: 4 }),
      link({ id: 's2', name: 'Security', version: 1, order: 1 }),
    ]);

    expect(before.config).not.toEqual(after.config);
    expect(after.config.skills).toEqual([
      { id: 's1', name: 'Naming', version: 4, order: 0, enabled: true },
      { id: 's2', name: 'Security', version: 1, order: 1, enabled: true },
    ]);
  });

  it('does not mutate the caller’s link array', () => {
    const links = [link({ id: 'b', order: 1 }), link({ id: 'a', order: 0 })];
    resolveEffectiveConfig(agentRow(), links);
    expect(links.map((l) => l.skill.id)).toEqual(['b', 'a']);
  });
});
