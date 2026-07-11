import { describe, it, expect, vi } from 'vitest';
import { resolveProjectContext } from '../src/modules/reviews/project-context.js';

/**
 * Pure hermetic coverage for the Project Context (SPEC-2026-07-10) run-time
 * resolver — union/dedupe/order/skip logic, no DB, no clone (the `read`
 * function is injected). `.it.test.ts` coverage lives in
 * `project-context.it.test.ts` (drives a real review run end-to-end).
 */

describe('resolveProjectContext', () => {
  it('unions agent docs and enabled-skill docs, reading every distinct path', async () => {
    const files: Record<string, string> = {
      'specs/agent-only.md': 'agent doc text',
      'specs/skill-only.md': 'skill doc text',
    };
    const read = vi.fn(async (path: string) => files[path] ?? null);

    const result = await resolveProjectContext(['specs/agent-only.md'], [['specs/skill-only.md']], read);

    expect(result.texts).toEqual([
      'Source: specs/agent-only.md\n\nagent doc text',
      'Source: specs/skill-only.md\n\nskill doc text',
    ]);
    expect(result.read).toEqual(['specs/agent-only.md', 'specs/skill-only.md']);
    expect(result.missing).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('dedupes by path across agent + skill, keeping the FIRST occurrence (agent wins over skill)', async () => {
    const files: Record<string, string> = {
      'specs/shared.md': 'the one true copy',
    };
    const read = vi.fn(async (path: string) => files[path] ?? null);

    const result = await resolveProjectContext(['specs/shared.md'], [['specs/shared.md']], read);

    expect(result.read).toEqual(['specs/shared.md']);
    expect(result.texts).toEqual(['Source: specs/shared.md\n\nthe one true copy']);
    // Read exactly once — the duplicate from the skill must never trigger a
    // second read call.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('dedupes across two skills, keeping the first loaded skill occurrence', async () => {
    const files: Record<string, string> = {
      'docs/shared.md': 'shared content',
      'docs/only-second.md': 'second-only content',
    };
    const read = vi.fn(async (path: string) => files[path] ?? null);

    const result = await resolveProjectContext(
      [],
      [['docs/shared.md'], ['docs/shared.md', 'docs/only-second.md']],
      read,
    );

    expect(result.read).toEqual(['docs/shared.md', 'docs/only-second.md']);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('orders deterministically: agent order first, then skill-load order, then each skill own doc order', async () => {
    const files: Record<string, string> = {
      'specs/a1.md': 'a1',
      'specs/a2.md': 'a2',
      'specs/s1a.md': 's1a',
      'specs/s1b.md': 's1b',
      'specs/s2a.md': 's2a',
    };
    const read = async (path: string) => files[path] ?? null;

    const result = await resolveProjectContext(
      ['specs/a1.md', 'specs/a2.md'],
      [
        ['specs/s1a.md', 'specs/s1b.md'],
        ['specs/s2a.md'],
      ],
      read,
    );

    expect(result.read).toEqual(['specs/a1.md', 'specs/a2.md', 'specs/s1a.md', 'specs/s1b.md', 'specs/s2a.md']);
    // Each injected text begins with the source header naming ITS OWN path,
    // in the same order as `read` — proves the header travels with the right
    // document rather than being applied positionally.
    expect(result.texts).toEqual([
      'Source: specs/a1.md\n\na1',
      'Source: specs/a2.md\n\na2',
      'Source: specs/s1a.md\n\ns1a',
      'Source: specs/s1b.md\n\ns1b',
      'Source: specs/s2a.md\n\ns2a',
    ]);
  });

  it('a disabled skill contributes nothing — caller must pre-filter to enabled/loaded skills only', async () => {
    // The resolver has no notion of "enabled" itself; the disabled skill's
    // docs simply must never appear in the skillDocs argument in the first
    // place. This test proves that an empty skillDocs group participates
    // safely (no crash, no phantom entries) — the real "disabled contributes
    // nothing" guarantee is enforced by the run-executor's filter before
    // calling this function (see run-executor.ts, `activeSkillDocs`).
    const files: Record<string, string> = { 'specs/agent.md': 'agent only' };
    const read = vi.fn(async (path: string) => files[path] ?? null);

    const result = await resolveProjectContext(['specs/agent.md'], [[], ['specs/agent.md']], read);

    expect(result.read).toEqual(['specs/agent.md']);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('a missing path is skipped (fail-soft): omitted from texts/read, recorded in missing, run resolves normally', async () => {
    const files: Record<string, string> = { 'specs/exists.md': 'present' };
    const read = async (path: string) => files[path] ?? null;

    const result = await resolveProjectContext(['specs/exists.md', 'specs/gone.md'], [], read);

    expect(result.read).toEqual(['specs/exists.md']);
    expect(result.texts).toEqual(['Source: specs/exists.md\n\npresent']);
    expect(result.missing).toEqual(['specs/gone.md']);
  });

  it('an empty file is injected as a zero-length doc (still with its source header) — NOT treated as a skip', async () => {
    const read = async (path: string) => (path === 'specs/empty.md' ? '' : null);

    const result = await resolveProjectContext(['specs/empty.md'], [], read);

    expect(result.read).toEqual(['specs/empty.md']);
    expect(result.texts).toEqual(['Source: specs/empty.md\n\n']);
    expect(result.missing).toEqual([]);
  });

  it('clone absent (read always returns null) → everything skipped, resolver still resolves with empty texts/read', async () => {
    const read = async () => null;

    const result = await resolveProjectContext(['specs/a.md', 'specs/b.md'], [['specs/c.md']], read);

    expect(result.texts).toEqual([]);
    expect(result.read).toEqual([]);
    expect(result.missing).toEqual(['specs/a.md', 'specs/b.md', 'specs/c.md']);
  });

  it('zero attached docs (agent + all skills empty) → resolves with no reads at all', async () => {
    const read = vi.fn(async () => null);

    const result = await resolveProjectContext([], [], read);

    expect(result.texts).toEqual([]);
    expect(result.read).toEqual([]);
    expect(result.missing).toEqual([]);
    expect(read).not.toHaveBeenCalled();
  });
});
