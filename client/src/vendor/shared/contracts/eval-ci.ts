import { z } from 'zod';
import { Verdict, Finding } from './findings.js';
import {
  EvalRun,
  EvalOwnerKind,
  Conformance,
  EvalCaseOutcome,
  EvalStatus,
  EvalExpectation,
  EvalExpectedItem,
  EvalForbiddenRegion,
  EvalEffectiveConfig,
} from './knowledge.js';

/**
 * A4 — Eval / CI / Compose / Conformance API contracts (L06).
 *
 * These EXTEND the barrel; they do not modify existing contract files. The base
 * `EvalRun`, `EvalCase`, `EvalOwnerKind`, `Conformance` live in `knowledge.ts`;
 * here we add the *API-facing* request/response shapes (records persisted in
 * `eval_runs`, `composed_reviews`, `ci_installations`, `ci_runs`,
 * `conformance_checks`) plus the eval-dashboard aggregate.
 */

// ===========================================================================
// Eval — case input + persisted run record + dashboard
// ===========================================================================

/** Create/update payload for an eval case (id + owner resolved by the route). */
export const EvalCaseInput = z.object({
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string().min(1),
  expectation: EvalExpectation,
  input_diff: z.string().default(''),
  input_files: z.unknown().nullish(),
  input_meta: z.unknown().nullish(),
  expected_output: z.array(EvalExpectedItem).default([]),
  /** Required only for `must_not_flag` (enforced by the service, not the raw shape). */
  forbidden_region: EvalForbiddenRegion.nullish(),
  /** Set at seed time; absent for a hand-written case. */
  source_finding_id: z.string().nullish(),
  notes: z.string().nullish(),
});
export type EvalCaseInput = z.infer<typeof EvalCaseInput>;

/** A persisted eval run row (one execution of a case), returned by the API. */
export const EvalRunRecord = z.object({
  id: z.string(),
  case_id: z.string(),
  case_name: z.string().nullish(),
  ran_at: z.string(),
  actual_output: z.unknown(),
  pass: z.boolean().nullable(),
  recall: z.number().nullable(),
  precision: z.number().nullable(),
  citation_accuracy: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalRunRecord = z.infer<typeof EvalRunRecord>;

/** Result of running a single case: the metrics (EvalRun) + the persisted row id. */
export const EvalRunResult = z.object({
  run_id: z.string(),
  case_id: z.string(),
  result: EvalRun,
});
export type EvalRunResult = z.infer<typeof EvalRunResult>;

/** Run lifecycle — mirrors the review-run vocabulary (`running/done/failed/cancelled`), not a second one. */
/** Alias of `EvalStatus` — a run and a draft share ONE lifecycle vocabulary. */
export const EvalRunStatus = EvalStatus;
export type EvalRunStatus = z.infer<typeof EvalRunStatus>;

/**
 * One case's result within a run. `outcome: 'errored'` is distinct from
 * `'failed'` — an errored case is excluded from every metric denominator,
 * never scored as a fail (AC-36).
 */
export const EvalCaseResult = z.object({
  case_id: z.string(),
  case_name: z.string(),
  /** The case's `input_fingerprint` AT RUN TIME (AC-14) — may differ from its current one if the case has since changed. */
  fingerprint: z.string(),
  outcome: EvalCaseOutcome,
  error_reason: z.string().nullable(),
  expected: z.array(EvalExpectedItem),
  /** Indices into `expected` that a survivor matched. */
  matched_expected_indices: z.array(z.number().int()),
  findings: z.array(Finding),
  /** Finding ids among `findings` that matched no expected item / forbidden region. */
  unmatched_finding_ids: z.array(z.string()),
  /** Every finding the model emitted for this case, before the grounding gate (AC-20). */
  emitted_count: z.number().int(),
  /** Findings the grounding gate kept — the numerator of citation accuracy (AC-20). */
  kept_count: z.number().int(),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
});
export type EvalCaseResult = z.infer<typeof EvalCaseResult>;

/**
 * The batch-shaped run row for a run-history table (dashboard `recent_runs`,
 * per-agent run history) — replaces the per-case `EvalRunRecord` there, which
 * cannot carry a version chip or a passed/total count.
 */
export const EvalRunSummary = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  /** Human-facing label only (the mockup's "v7" chip) — NOT the comparability key (AC-10, AC-51). */
  agent_version: z.number().int().nullable(),
  status: EvalRunStatus,
  started_at: z.string(),
  finished_at: z.string().nullable(),
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  errored_count: z.number().int(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullable(),
  /** The whole set's size as it stood at run start (AC-44). */
  cases_total: z.number().int(),
  /** True once the owner's live case set has diverged from what this run measured (AC-44/AC-45). */
  set_drifted: z.boolean(),
});
export type EvalRunSummary = z.infer<typeof EvalRunSummary>;

/** `EvalRunSummary` + the pinned config and every per-case result (the AC-12 poll target). */
export const EvalRunDetail = EvalRunSummary.extend({
  effective_config: EvalEffectiveConfig,
  results: z.array(EvalCaseResult),
});
export type EvalRunDetail = z.infer<typeof EvalRunDetail>;

/** An agent's eval spend, decomposed so the run-history cost column sums to it (AC-49). */
export const EvalSpend = z.object({
  total_usd: z.number(),
  run_usd: z.number(),
  draft_usd: z.number(),
});
export type EvalSpend = z.infer<typeof EvalSpend>;

export const EvalComparisonExcludedCase = z.object({
  case_id: z.string(),
  case_name: z.string(),
  reason: z.enum(['changed', 'added', 'removed']),
});
export type EvalComparisonExcludedCase = z.infer<typeof EvalComparisonExcludedCase>;

export const EvalComparisonFlippedCase = z.object({
  case_id: z.string(),
  case_name: z.string(),
  direction: z.enum(['now_passing', 'now_failing']),
});
export type EvalComparisonFlippedCase = z.infer<typeof EvalComparisonFlippedCase>;

/** One skill's difference between two effective configs (AC-51). */
export const EvalSkillDelta = z.object({
  skill_id: z.string(),
  name: z.string(),
  // `reordered` is load-bearing: skill ORDER is part of the prompt, so a pure
  // re-link that changes only the order changes behaviour — and it bumps no
  // agent version, so it is invisible unless the comparison names it (AC-51).
  change: z.enum(['added', 'removed', 'version_changed', 'reordered']),
  from_version: z.number().int().nullable(),
  to_version: z.number().int().nullable(),
});
export type EvalSkillDelta = z.infer<typeof EvalSkillDelta>;

/**
 * Two runs of the SAME agent, compared. Deltas are computed only over
 * fingerprint-identical shared cases (AC-26); comparability is decided
 * against the two pinned effective configs, never the agent-version tag
 * alone (AC-51). WHERE no case is shared, `comparable` is false and no
 * deltas are carried (AC-26) — this shape never returns zeros in place of
 * "not comparable".
 */
export const EvalComparison = z.object({
  comparable: z.boolean(),
  /** Why `comparable` is false — null when it is true. */
  reason: z.string().nullable(),
  base: EvalRunSummary,
  candidate: EvalRunSummary,
  /** Null when that run has no stored snapshot (AC-52) — an older/legacy row. */
  base_config: EvalEffectiveConfig.nullable(),
  candidate_config: EvalEffectiveConfig.nullable(),
  /** True when either snapshot is missing — the prompt diff and skill delta below render as unavailable, not a failure (AC-52). */
  config_unavailable: z.boolean(),
  shared_case_count: z.number().int(),
  delta: z.object({
    recall: z.number().nullable(),
    precision: z.number().nullable(),
    citation_accuracy: z.number().nullable(),
  }),
  excluded_cases: z.array(EvalComparisonExcludedCase),
  flipped_cases: z.array(EvalComparisonFlippedCase),
  skill_delta: z.array(EvalSkillDelta),
  /** True when the two runs share an `agent_version` label but their pinned effective configs differ (AC-51). */
  effective_config_divergence: z.boolean(),
});
export type EvalComparison = z.infer<typeof EvalComparison>;

/** One point on the dashboard trend (per run, chronological). */
export const EvalTrendPoint = z.object({
  run_id: z.string(),
  ran_at: z.string(),
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  pass_rate: z.number().nullable(),
  cost_usd: z.number().nullable(),
  /** True when the run's set has since drifted from the owner's current case set (AC-44). */
  set_drifted: z.boolean(),
});
export type EvalTrendPoint = z.infer<typeof EvalTrendPoint>;

/** Aggregate dashboard for an owner (agent/skill) or the whole workspace. */
export const EvalDashboard = z.object({
  owner_kind: EvalOwnerKind.nullable(),
  owner_id: z.string().nullable(),
  cases_total: z.number().int(),
  // An absent measurement (no cases / never run) and a measured zero must be
  // visually distinct (AC-31/AC-32) — hence nullable metrics, not 0.
  current: z.object({
    recall: z.number().min(0).max(1).nullable(),
    precision: z.number().min(0).max(1).nullable(),
    citation_accuracy: z.number().min(0).max(1).nullable(),
    traces_passed: z.number().int(),
    traces_total: z.number().int(),
    cost_usd: z.number().nullable(),
  }),
  delta: z.object({
    recall: z.number(),
    precision: z.number(),
    citation_accuracy: z.number(),
  }),
  trend: z.array(EvalTrendPoint),
  recent_runs: z.array(EvalRunSummary),
  alert: z.string().nullable(),
  spend: EvalSpend,
});
export type EvalDashboard = z.infer<typeof EvalDashboard>;

export const EvalAgentEvalSummary = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  agent_version: z.number().int(),
  cases_total: z.number().int(),
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  /**
   * Run spend and draft spend, kept as separate components (AC-49). A single
   * blended total would never tie out against the run-history cost column, and
   * that discrepancy reads as a bug — a draft costs real money but moves no metric.
   */
  spend: EvalSpend,
});
export type EvalAgentEvalSummary = z.infer<typeof EvalAgentEvalSummary>;

/** The fleet-wide Eval Dashboard — every agent's latest metrics + a recent-runs table spanning all agents (AC-29). */
export const EvalWorkspaceDashboard = z.object({
  agents: z.array(EvalAgentEvalSummary),
  recent_runs: z.array(EvalRunSummary),
  alert: z.string().nullable(),
});
export type EvalWorkspaceDashboard = z.infer<typeof EvalWorkspaceDashboard>;

export const EvalRunAllPreviewAgent = z.object({
  agent_id: z.string(),
  agent_name: z.string(),
  cases_total: z.number().int(),
});
export type EvalRunAllPreviewAgent = z.infer<typeof EvalRunAllPreviewAgent>;

/**
 * What "Run all agents" is about to do — named totals for the confirmation
 * (AC-35). Agents with zero cases are already excluded from both totals and
 * `agents`.
 */
export const EvalRunAllPreview = z.object({
  agents_total: z.number().int(),
  cases_total: z.number().int(),
  agents: z.array(EvalRunAllPreviewAgent),
});
export type EvalRunAllPreview = z.infer<typeof EvalRunAllPreview>;

/** A pinned skill whose live version has since moved on from what was promoted (REC-3 / A-2). */
export const EvalSkillVersionDivergence = z.object({
  skill_id: z.string(),
  name: z.string(),
  pinned_version: z.number().int(),
  live_version: z.number().int(),
});
export type EvalSkillVersionDivergence = z.infer<typeof EvalSkillVersionDivergence>;

/**
 * Response of promoting a run's effective config — the agent's whole config,
 * skill links included, becomes its live config, and a new version appears
 * at the head of its history (AC-27).
 */
export const EvalPromoteResult = z.object({
  agent_id: z.string(),
  agent_version: z.number().int(),
  effective_config: EvalEffectiveConfig,
  skill_version_divergence: z.array(EvalSkillVersionDivergence),
});
export type EvalPromoteResult = z.infer<typeof EvalPromoteResult>;

// ===========================================================================
// Compose Review
// ===========================================================================

export const ComposeReviewInput = z.object({
  /** Finding ids to fold into the draft (optional — body may be hand-written). */
  finding_ids: z.array(z.string()).default([]),
  /** Editable markdown body. If omitted, the server composes one from findings. */
  body: z.string().nullish(),
  verdict: Verdict.default('comment'),
  /** When true, attach selected findings as inline comments (path+line+body). */
  inline_comments: z.boolean().default(false),
});
export type ComposeReviewInput = z.infer<typeof ComposeReviewInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type ComposeReviewInputBody = z.input<typeof ComposeReviewInput>;

/** A persisted composed review (mirrors the `composed_reviews` row). */
export const ComposedReview = z.object({
  id: z.string(),
  pr_id: z.string(),
  body: z.string(),
  verdict: Verdict.nullable(),
  posted_at: z.string().nullable(),
  github_review_id: z.string().nullable(),
});
export type ComposedReview = z.infer<typeof ComposedReview>;

/** A preview (no GitHub side-effect) of what would be posted. */
export const ComposeReviewPreview = z.object({
  body: z.string(),
  verdict: Verdict,
  inline_comments: z.array(
    z.object({ path: z.string(), line: z.number().int(), body: z.string() }),
  ),
});
export type ComposeReviewPreview = z.infer<typeof ComposeReviewPreview>;

// ===========================================================================
// Export-to-CI + CI Runs
// ===========================================================================

export const CiTarget = z.enum(['gha', 'circle', 'jenkins', 'cli']);
export type CiTarget = z.infer<typeof CiTarget>;

/** One generated file in the CI bundle (path + editable contents). */
export const CiFile = z.object({
  path: z.string(),
  contents: z.string(),
  editable: z.boolean().default(true),
});
export type CiFile = z.infer<typeof CiFile>;

/** Request body for `POST /agents/:id/export-ci`. */
export const CiExportInput = z.object({
  repo: z.string().min(1), // "owner/name"
  target: CiTarget.default('gha'),
  /** "open_pr" opens a PR with the files; "files" just returns/persists them. */
  action: z.enum(['open_pr', 'files']).default('open_pr'),
  post_as: z.enum(['github_review', 'pr_comment', 'none']).default('github_review'),
  triggers: z.array(z.string()).default(['opened', 'synchronize', 'reopened']),
  base: z.string().default('main'),
});
export type CiExportInput = z.infer<typeof CiExportInput>;
/** Caller-facing input type — `.default()` fields stay optional (web hooks). */
export type CiExportInputBody = z.input<typeof CiExportInput>;

/** A persisted CI installation (mirrors `ci_installations`). */
export const CiInstallation = z.object({
  id: z.string(),
  agent_id: z.string(),
  repo: z.string(),
  target_type: CiTarget,
  installed_at: z.string(),
});
export type CiInstallation = z.infer<typeof CiInstallation>;

/** Response of `POST /agents/:id/export-ci`. */
export const CiExport = z.object({
  installation: CiInstallation,
  files: z.array(CiFile),
  pr_url: z.string().nullable(),
});
export type CiExport = z.infer<typeof CiExport>;

export const CiRunStatus = z.enum(['succeeded', 'failed', 'no_findings', 'running']);
export type CiRunStatus = z.infer<typeof CiRunStatus>;

/** A CI run row (mirrors `ci_runs`) — ingested from GitHub Actions artifacts. */
export const CiRun = z.object({
  id: z.string(),
  ci_installation_id: z.string().nullable(),
  pr_number: z.number().int().nullable(),
  ran_at: z.string().nullable(),
  status: z.string().nullable(),
  findings_count: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  github_url: z.string().nullable(),
  source: z.string().nullable(),
  agent: z.string().nullish(),
  duration_s: z.number().nullish(),
});
export type CiRun = z.infer<typeof CiRun>;

/**
 * The artifact shape uploaded by the CI action (`devdigest-result.json`).
 * Ingested back on refresh to populate `ci_runs` (L06).
 */
export const CiResultArtifact = z.object({
  findings_count: z.number().int(),
  critical: z.number().int().nullish(),
  warning: z.number().int().nullish(),
  suggestion: z.number().int().nullish(),
  cost_usd: z.number().nullable(),
  duration_ms: z.number().int().nullish(),
  agent: z.string(),
  version: z.string().nullish(),
  pr_number: z.number().int().nullish(),
});
export type CiResultArtifact = z.infer<typeof CiResultArtifact>;

// ===========================================================================
// Conformance (PRD ↔ PR) — API record (the analysis shape is `Conformance`)
// ===========================================================================

/** Request body for `POST /pulls/:id/conformance`. */
export const ConformanceInput = z.object({
  /** Spec path/id to compare against; if omitted, the first available spec. */
  spec: z.string().nullish(),
  // Was missing 'openrouter' while the server copy had it — a real dual-vendor
  // drift (the client would reject a payload the server happily emits). Closed
  // 2026-07-14. The other server/client asymmetries in this file (AgentManifest)
  // are deliberate: server-only, never cross the wire.
  provider: z.enum(['openai', 'anthropic', 'openrouter']).nullish(),
  model: z.string().nullish(),
});
export type ConformanceInput = z.infer<typeof ConformanceInput>;

/** A persisted conformance check (mirrors `conformance_checks` + the report). */
export const ConformanceReport = z.object({
  id: z.string(),
  pr_id: z.string(),
  report: Conformance,
});
export type ConformanceReport = z.infer<typeof ConformanceReport>;

// ===========================================================================
// Hooks (Secret-Leak + Phantom-API detectors) — emit grounding-exempt findings
// ===========================================================================

export const HookKind = z.enum(['secret_leak', 'phantom']);
export type HookKind = z.infer<typeof HookKind>;

/** Result of running the built-in detectors over a PR. */
export const HookScanResult = z.object({
  pr_id: z.string(),
  review_id: z.string().nullable(),
  findings: z.array(Finding),
});
export type HookScanResult = z.infer<typeof HookScanResult>;
