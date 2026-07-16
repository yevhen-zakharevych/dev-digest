import type {
  EvalRunSummary,
  EvalEffectiveConfig,
  EvalCaseResult,
  EvalComparison,
  EvalComparisonExcludedCase,
  EvalComparisonFlippedCase,
  EvalSkillDelta,
  EvalSkillPin,
  EvalExpectation,
} from '@devdigest/shared';
import { canonicalStringify } from './fingerprint.js';
import { aggregateSetMetrics, type CaseMetricInput, type SetMetrics } from './scorer.js';

/**
 * Compare — pure (AC-24..26, AC-51, AC-52). No I/O: the caller (the eval
 * service) is responsible for loading both runs' summaries, pinned effective
 * configs, and per-case results; this module only does set math over them.
 *
 * The join key for "did the two runs see the same case?" is the case's
 * `input_fingerprint` AT RUN TIME (AC-14), NOT the case id alone — a case
 * can be edited and keep its id, and a run outlives a deleted case (its
 * `EvalCaseResult` carries a frozen `case_name` for exactly that reason).
 */

export interface CompareRunsInput {
  base: EvalRunSummary;
  candidate: EvalRunSummary;
  /** Null when that run predates the effective-config snapshot (AC-52). */
  baseConfig: EvalEffectiveConfig | null;
  candidateConfig: EvalEffectiveConfig | null;
  baseResults: EvalCaseResult[];
  candidateResults: EvalCaseResult[];
}

/**
 * `EvalCaseResult` does not carry `expectation` directly. It is safely
 * inferable from the frozen `expected` array: AC-3/AC-5 guarantee a
 * `must_find` case always freezes >=1 expected item and a `must_not_flag`
 * case always freezes zero (its expectation is a forbidden region, not an
 * expected item). This inference only holds because those two ACs hold —
 * documented here since compare.ts is the one file that leans on it.
 */
function inferExpectation(result: EvalCaseResult): EvalExpectation {
  return result.expected.length > 0 ? 'must_find' : 'must_not_flag';
}

function toMetricInput(result: EvalCaseResult): CaseMetricInput {
  return {
    outcome: result.outcome,
    expectation: inferExpectation(result),
    expectedCount: result.expected.length,
    score: {
      passed: result.outcome === 'passed',
      matchedExpectedIndices: result.matched_expected_indices,
      matchedFindingIds: result.findings
        .map((f) => f.id)
        .filter((id) => !result.unmatched_finding_ids.includes(id)),
      unmatchedFindingIds: result.unmatched_finding_ids,
      keptCount: result.kept_count,
      emittedCount: result.emitted_count,
    },
  };
}

function metricDelta(base: SetMetrics, candidate: SetMetrics): EvalComparison['delta'] {
  const diff = (b: number | null, c: number | null) => (b === null || c === null ? null : c - b);
  return {
    recall: diff(base.recall, candidate.recall),
    precision: diff(base.precision, candidate.precision),
    citation_accuracy: diff(base.citation_accuracy, candidate.citation_accuracy),
  };
}

const NULL_DELTA: EvalComparison['delta'] = { recall: null, precision: null, citation_accuracy: null };

/** One skill's diff between two pinned skill lists (AC-51): added / removed / a version that moved on. */
function computeSkillDelta(baseSkills: EvalSkillPin[], candidateSkills: EvalSkillPin[]): EvalSkillDelta[] {
  const baseById = new Map(baseSkills.map((s) => [s.id, s]));
  const candidateById = new Map(candidateSkills.map((s) => [s.id, s]));
  const delta: EvalSkillDelta[] = [];

  for (const skill of baseSkills) {
    if (!candidateById.has(skill.id)) {
      delta.push({
        skill_id: skill.id,
        name: skill.name,
        change: 'removed',
        from_version: skill.version,
        to_version: null,
      });
    }
  }
  for (const skill of candidateSkills) {
    const prior = baseById.get(skill.id);
    if (!prior) {
      delta.push({
        skill_id: skill.id,
        name: skill.name,
        change: 'added',
        from_version: null,
        to_version: skill.version,
      });
    } else if (prior.version !== skill.version) {
      delta.push({
        skill_id: skill.id,
        name: skill.name,
        change: 'version_changed',
        from_version: prior.version,
        to_version: skill.version,
      });
    } else if (prior.order !== skill.order || prior.enabled !== skill.enabled) {
      // Same id, same version, but the link itself moved: a different `order`
      // (skill order is prompt-shaping content — the model reads them in this
      // sequence) or a flipped `enabled`. Either changes behaviour, and NEITHER
      // bumps the agent version (`setSkills` writes no snapshot at all —
      // `agents/repository.ts:266-281`). So this is precisely the change that is
      // invisible unless the comparison NAMES it: without this branch the user
      // sees a metric delta beside an empty prompt diff, and "model noise" is
      // their only available reading (AC-51).
      delta.push({
        skill_id: skill.id,
        name: skill.name,
        change: 'reordered',
        from_version: prior.version,
        to_version: skill.version,
      });
    }
  }
  return delta;
}

export function compareRuns(input: CompareRunsInput): EvalComparison {
  const { base, candidate, baseConfig, candidateConfig, baseResults, candidateResults } = input;

  const baseById = new Map(baseResults.map((r) => [r.case_id, r]));
  const candidateById = new Map(candidateResults.map((r) => [r.case_id, r]));
  const allCaseIds = new Set([...baseById.keys(), ...candidateById.keys()]);

  const sharedBase: EvalCaseResult[] = [];
  const sharedCandidate: EvalCaseResult[] = [];
  const excludedCases: EvalComparisonExcludedCase[] = [];
  const flippedCases: EvalComparisonFlippedCase[] = [];

  for (const caseId of allCaseIds) {
    const inBase = baseById.get(caseId);
    const inCandidate = candidateById.get(caseId);

    if (inBase && !inCandidate) {
      excludedCases.push({ case_id: caseId, case_name: inBase.case_name, reason: 'removed' });
      continue;
    }
    if (!inBase && inCandidate) {
      excludedCases.push({ case_id: caseId, case_name: inCandidate.case_name, reason: 'added' });
      continue;
    }
    if (inBase && inCandidate) {
      if (inBase.fingerprint !== inCandidate.fingerprint) {
        excludedCases.push({ case_id: caseId, case_name: inCandidate.case_name, reason: 'changed' });
        continue;
      }
      // Identical fingerprint — a genuinely shared case.
      sharedBase.push(inBase);
      sharedCandidate.push(inCandidate);

      if (inBase.outcome !== 'errored' && inCandidate.outcome !== 'errored') {
        const wasPassing = inBase.outcome === 'passed';
        const isPassing = inCandidate.outcome === 'passed';
        if (wasPassing !== isPassing) {
          flippedCases.push({
            case_id: caseId,
            case_name: inCandidate.case_name,
            direction: isPassing ? 'now_passing' : 'now_failing',
          });
        }
      }
    }
  }

  const sharedCaseCount = sharedBase.length;
  const configUnavailable = baseConfig === null || candidateConfig === null;
  const sameVersionTag =
    base.agent_version !== null && candidate.agent_version !== null && base.agent_version === candidate.agent_version;
  const effectiveConfigDivergence =
    !configUnavailable && sameVersionTag && canonicalStringify(baseConfig) !== canonicalStringify(candidateConfig);
  const skillDelta =
    !configUnavailable && baseConfig && candidateConfig
      ? computeSkillDelta(baseConfig.skills, candidateConfig.skills)
      : [];

  if (sharedCaseCount === 0) {
    // AC-26: zero fingerprint-identical shared cases ⇒ not comparable — never a delta, never zeros.
    return {
      comparable: false,
      reason: 'no case is shared between the two runs with an identical input fingerprint',
      base,
      candidate,
      base_config: baseConfig,
      candidate_config: candidateConfig,
      config_unavailable: configUnavailable,
      shared_case_count: 0,
      delta: NULL_DELTA,
      excluded_cases: excludedCases,
      flipped_cases: [],
      skill_delta: skillDelta,
      effective_config_divergence: effectiveConfigDivergence,
    };
  }

  // Recompute recall/precision/citation over ONLY the shared subset for each
  // run — not the runs' own full-set metrics — so a delta is attributable to
  // the cases both runs actually shared (AC-26: "a 4-point delta IS one case
  // flipping"), never diluted or inflated by a case that changed underneath.
  const baseMetrics = aggregateSetMetrics(sharedBase.map(toMetricInput));
  const candidateMetrics = aggregateSetMetrics(sharedCandidate.map(toMetricInput));

  return {
    comparable: true,
    reason: null,
    base,
    candidate,
    base_config: baseConfig,
    candidate_config: candidateConfig,
    config_unavailable: configUnavailable,
    shared_case_count: sharedCaseCount,
    delta: metricDelta(baseMetrics, candidateMetrics),
    excluded_cases: excludedCases,
    flipped_cases: flippedCases,
    skill_delta: skillDelta,
    effective_config_divergence: effectiveConfigDivergence,
  };
}
