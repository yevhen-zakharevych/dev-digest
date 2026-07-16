import { describe, it, expect } from 'vitest';
import type { EvalRunSummary, EvalEffectiveConfig, EvalCaseResult, EvalSkillPin } from '@devdigest/shared';
import { compareRuns } from './compare.js';

function run(overrides: Partial<EvalRunSummary> = {}): EvalRunSummary {
  return {
    id: 'run-base',
    owner_kind: 'agent',
    owner_id: 'agent-1',
    agent_version: 1,
    status: 'done',
    started_at: '2026-01-01T00:00:00.000Z',
    finished_at: '2026-01-01T00:05:00.000Z',
    recall: 0.8,
    precision: 0.9,
    citation_accuracy: 0.95,
    traces_passed: 4,
    traces_total: 5,
    errored_count: 0,
    cost_usd: 0.5,
    duration_ms: 30_000,
    cases_total: 5,
    set_drifted: false,
    ...overrides,
  };
}

function config(overrides: Partial<EvalEffectiveConfig> = {}): EvalEffectiveConfig {
  return {
    system_prompt: 'You are a reviewer.',
    provider: 'openrouter',
    model: 'anthropic/claude-3',
    strategy: 'single-pass',
    repo_intel: false,
    skills: [],
    ...overrides,
  };
}

function skill(overrides: Partial<EvalSkillPin> = {}): EvalSkillPin {
  return { id: 's1', name: 'Security', version: 1, order: 0, enabled: true, ...overrides };
}

function caseResult(overrides: Partial<EvalCaseResult> = {}): EvalCaseResult {
  return {
    case_id: 'case-1',
    case_name: 'Case 1',
    fingerprint: 'fp-1',
    outcome: 'passed',
    error_reason: null,
    expected: [{ file: 'a.ts', start_line: 1, end_line: 2, kind: 'finding' }],
    matched_expected_indices: [0],
    findings: [
      {
        id: 'm1',
        severity: 'WARNING',
        category: 'bug',
        title: 't',
        file: 'a.ts',
        start_line: 1,
        end_line: 2,
        rationale: 'r',
        confidence: 0.9,
        kind: 'finding',
      },
    ],
    unmatched_finding_ids: [],
    emitted_count: 1,
    kept_count: 1,
    duration_ms: 1000,
    cost_usd: 0.01,
    ...overrides,
  };
}

describe('compareRuns — comparability + shared cases (AC-26)', () => {
  it('zero shared fingerprint-identical cases ⇒ comparable: false, never a delta, never zeros', () => {
    const base = run({ id: 'run-a' });
    const candidate = run({ id: 'run-b' });
    const result = compareRuns({
      base,
      candidate,
      baseConfig: config(),
      candidateConfig: config(),
      baseResults: [caseResult({ case_id: 'c1', fingerprint: 'fp-old' })],
      candidateResults: [caseResult({ case_id: 'c1', fingerprint: 'fp-new' })], // same case, different fingerprint
    });
    expect(result.comparable).toBe(false);
    expect(result.reason).not.toBeNull();
    expect(result.shared_case_count).toBe(0);
    expect(result.delta).toEqual({ recall: null, precision: null, citation_accuracy: null });
    expect(result.excluded_cases).toEqual([{ case_id: 'c1', case_name: 'Case 1', reason: 'changed' }]);
  });

  it('reports the shared count and names an excluded case that changed', () => {
    const shared = caseResult({ case_id: 'shared-1', fingerprint: 'fp-shared' });
    const changedBase = caseResult({ case_id: 'edited', fingerprint: 'fp-before', case_name: 'Edited case' });
    const changedCandidate = caseResult({ case_id: 'edited', fingerprint: 'fp-after', case_name: 'Edited case' });

    const result = compareRuns({
      base: run(),
      candidate: run(),
      baseConfig: config(),
      candidateConfig: config(),
      baseResults: [shared, changedBase],
      candidateResults: [shared, changedCandidate],
    });

    expect(result.comparable).toBe(true);
    expect(result.shared_case_count).toBe(1);
    expect(result.excluded_cases).toEqual([{ case_id: 'edited', case_name: 'Edited case', reason: 'changed' }]);
  });

  it('names a case present only in the candidate as "added" and only in the base as "removed"', () => {
    const shared = caseResult({ case_id: 'shared-1', fingerprint: 'fp-shared' });
    const removedFromCandidate = caseResult({ case_id: 'gone', fingerprint: 'fp-gone', case_name: 'Gone case' });
    const addedInCandidate = caseResult({ case_id: 'new', fingerprint: 'fp-new', case_name: 'New case' });

    const result = compareRuns({
      base: run(),
      candidate: run(),
      baseConfig: config(),
      candidateConfig: config(),
      baseResults: [shared, removedFromCandidate],
      candidateResults: [shared, addedInCandidate],
    });

    expect(result.excluded_cases).toEqual(
      expect.arrayContaining([
        { case_id: 'gone', case_name: 'Gone case', reason: 'removed' },
        { case_id: 'new', case_name: 'New case', reason: 'added' },
      ]),
    );
  });

  it('a 4-point recall delta on a shared set is accompanied by the case that flipped', () => {
    const stayedPassing = caseResult({
      case_id: 'c1',
      fingerprint: 'fp1',
      outcome: 'passed',
      case_name: 'Stayed passing',
    });
    const flippedBase = caseResult({
      case_id: 'c2',
      fingerprint: 'fp2',
      outcome: 'failed',
      case_name: 'Flipped',
      matched_expected_indices: [],
    });
    const flippedCandidate = caseResult({
      case_id: 'c2',
      fingerprint: 'fp2',
      outcome: 'passed',
      case_name: 'Flipped',
      matched_expected_indices: [0],
    });

    const result = compareRuns({
      base: run(),
      candidate: run(),
      baseConfig: config(),
      candidateConfig: config(),
      baseResults: [stayedPassing, flippedBase],
      candidateResults: [stayedPassing, flippedCandidate],
    });

    expect(result.shared_case_count).toBe(2);
    expect(result.flipped_cases).toEqual([{ case_id: 'c2', case_name: 'Flipped', direction: 'now_passing' }]);
    expect(result.delta.recall).toBeGreaterThan(0);
  });

  it('an errored case on either side of a shared case is never reported as flipped', () => {
    const erroredBase = caseResult({ case_id: 'c1', fingerprint: 'fp1', outcome: 'errored' });
    const nowPassing = caseResult({ case_id: 'c1', fingerprint: 'fp1', outcome: 'passed' });
    const result = compareRuns({
      base: run(),
      candidate: run(),
      baseConfig: config(),
      candidateConfig: config(),
      baseResults: [erroredBase],
      candidateResults: [nowPassing],
    });
    expect(result.flipped_cases).toEqual([]);
  });
});

describe('compareRuns — same version, empty prompt diff (AC-25)', () => {
  it('two runs of an unchanged agent are comparable; identical configs ⇒ no divergence flag', () => {
    const shared = caseResult({ case_id: 'c1', fingerprint: 'fp1' });
    const result = compareRuns({
      base: run({ id: 'run-a', agent_version: 7 }),
      candidate: run({ id: 'run-b', agent_version: 7 }),
      baseConfig: config(),
      candidateConfig: config(),
      baseResults: [shared],
      candidateResults: [shared],
    });
    expect(result.comparable).toBe(true);
    expect(result.effective_config_divergence).toBe(false);
    expect(result.skill_delta).toEqual([]);
  });
});

describe('compareRuns — effective-config divergence (AC-51)', () => {
  it('same version tag but a different effective config ⇒ divergence flag + named skill delta', () => {
    const shared = caseResult({ case_id: 'c1', fingerprint: 'fp1' });
    const result = compareRuns({
      base: run({ id: 'run-a', agent_version: 7 }),
      candidate: run({ id: 'run-b', agent_version: 7 }), // SAME tag
      baseConfig: config({ skills: [] }),
      candidateConfig: config({ skills: [skill({ id: 's1', name: 'Security', version: 1 })] }), // skill linked
      baseResults: [shared],
      candidateResults: [shared],
    });
    expect(result.effective_config_divergence).toBe(true);
    expect(result.skill_delta).toEqual([
      { skill_id: 's1', name: 'Security', change: 'added', from_version: null, to_version: 1 },
    ]);
    // The empty prompt diff (same system_prompt on both sides) is exactly
    // the trap AC-51 exists to name: without the flag this reads as pure
    // "model noise".
    expect(result.base_config?.system_prompt).toBe(result.candidate_config?.system_prompt);
  });

  it('a REORDER-ONLY skill change is named — same id, same version, different order (AC-51)', () => {
    // The nastiest shape of this bug: nothing about the agent looks different.
    // Same version tag, same prompt, same skill ids, same skill versions — only
    // the ORDER moved. Order is prompt-shaping content (the model reads the
    // skills in sequence), and `setSkills` bumps no version, so if the delta
    // does not NAME it the user sees a metric move beside an empty prompt diff
    // and "model noise" is their only available reading.
    const shared = caseResult({ case_id: 'c1', fingerprint: 'fp1' });
    const a = skill({ id: 's1', name: 'Security', version: 1, order: 0 });
    const b = skill({ id: 's2', name: 'Perf', version: 1, order: 1 });
    const result = compareRuns({
      base: run({ id: 'run-a', agent_version: 7 }),
      candidate: run({ id: 'run-b', agent_version: 7 }), // SAME tag
      baseConfig: config({ skills: [a, b] }),
      candidateConfig: config({ skills: [{ ...a, order: 1 }, { ...b, order: 0 }] }), // swapped
      baseResults: [shared],
      candidateResults: [shared],
    });
    expect(result.effective_config_divergence).toBe(true);
    expect(result.skill_delta).toEqual([
      { skill_id: 's1', name: 'Security', change: 'reordered', from_version: 1, to_version: 1 },
      { skill_id: 's2', name: 'Perf', change: 'reordered', from_version: 1, to_version: 1 },
    ]);
    expect(result.base_config?.system_prompt).toBe(result.candidate_config?.system_prompt);
  });

  it('a removed skill and a version-changed skill are both named', () => {
    const shared = caseResult({ case_id: 'c1', fingerprint: 'fp1' });
    const result = compareRuns({
      base: run({ agent_version: 3 }),
      candidate: run({ agent_version: 3 }),
      baseConfig: config({
        skills: [skill({ id: 'kept', name: 'Kept', version: 1 }), skill({ id: 'gone', name: 'Gone', version: 1 })],
      }),
      candidateConfig: config({ skills: [skill({ id: 'kept', name: 'Kept', version: 2 })] }),
      baseResults: [shared],
      candidateResults: [shared],
    });
    expect(result.skill_delta).toEqual(
      expect.arrayContaining([
        { skill_id: 'gone', name: 'Gone', change: 'removed', from_version: 1, to_version: null },
        { skill_id: 'kept', name: 'Kept', change: 'version_changed', from_version: 1, to_version: 2 },
      ]),
    );
  });

  it('a genuine version bump (different tags) is NOT flagged as divergence', () => {
    const shared = caseResult({ case_id: 'c1', fingerprint: 'fp1' });
    const result = compareRuns({
      base: run({ agent_version: 6 }),
      candidate: run({ agent_version: 7 }),
      baseConfig: config({ system_prompt: 'old prompt' }),
      candidateConfig: config({ system_prompt: 'new prompt' }),
      baseResults: [shared],
      candidateResults: [shared],
    });
    expect(result.effective_config_divergence).toBe(false);
  });
});

describe('compareRuns — no stored snapshot (AC-52)', () => {
  it('a run with no snapshot still yields deltas, with config marked unavailable — never an error', () => {
    const shared = caseResult({ case_id: 'c1', fingerprint: 'fp1' });
    const result = compareRuns({
      base: run(),
      candidate: run(),
      baseConfig: null, // legacy row, no snapshot
      candidateConfig: config(),
      baseResults: [shared],
      candidateResults: [shared],
    });
    expect(result.comparable).toBe(true);
    expect(result.config_unavailable).toBe(true);
    expect(result.skill_delta).toEqual([]);
    expect(result.effective_config_divergence).toBe(false);
    expect(result.delta.recall).not.toBeNull();
  });
});
