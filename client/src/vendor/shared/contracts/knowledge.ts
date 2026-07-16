import { z } from 'zod';
import { Finding, FindingKind, Severity, FindingCategory } from './findings.js';

/**
 * Conformance, Onboarding, Eval, Memory, Conventions, Skills,
 * Agents and their DTOs.
 */

// ---- Conformance ----
export const ConformanceStatus = z.enum(['implemented', 'missing', 'out_of_scope']);
export type ConformanceStatus = z.infer<typeof ConformanceStatus>;

export const ConformanceItem = z.object({
  requirement: z.string(),
  status: ConformanceStatus,
  evidence_file: z.string().nullish(),
  notes: z.string().nullish(),
});
export type ConformanceItem = z.infer<typeof ConformanceItem>;

export const Conformance = z.object({
  spec_id: z.string(),
  spec_title: z.string(),
  items: z.array(ConformanceItem),
  completeness_pct: z.number().min(0).max(100),
});
export type Conformance = z.infer<typeof Conformance>;

// ---- Onboarding ----
export const OnboardingLink = z.object({
  label: z.string(),
  path: z.string(),
});
export type OnboardingLink = z.infer<typeof OnboardingLink>;

export const OnboardingSection = z.object({
  kind: z.string(),
  title: z.string(),
  body: z.string(), // markdown
  diagram: z.string().nullish(), // mermaid
  links: z.array(OnboardingLink),
});
export type OnboardingSection = z.infer<typeof OnboardingSection>;

export const Onboarding = z.object({
  sections: z.array(OnboardingSection),
});
export type Onboarding = z.infer<typeof Onboarding>;

/**
 * Closed set of reason codes for a degraded/skeleton onboarding artifact,
 * aligned to the repo-intel `DegradedReason` vocabulary. The client maps each
 * to an i18n string (never renders the raw code).
 */
export const OnboardingDegradedReason = z.enum([
  'flag_off',
  'index_failed',
  'index_partial',
  'repo_too_large',
  'no_data',
]);
export type OnboardingDegradedReason = z.infer<typeof OnboardingDegradedReason>;

/**
 * The onboarding read/generate response wrapper (server → client). Wraps the
 * five fixed sections with freshness + degraded metadata. `GET` returns
 * `OnboardingResponse | null` — `null` when no artifact has ever been
 * generated for the repo; the required fields below apply only when an
 * artifact exists.
 *
 * - `status`: `fresh` when the stored indexed SHA == the repo's current
 *   indexed SHA, `stale` once the indexed SHA has advanced.
 * - `degraded` / `degradedReason`: a skeleton was returned (missing/partial/
 *   degraded/failed index or a model-call failure); no model call was made.
 * - `indexedSha` / `filesIndexed`: drive the subtitle ("index of N files").
 * - `generatedAt`: when the narrative was last produced (the "refreshed X ago").
 * - `generating`: optional in-flight flag — a full generation is currently
 *   running for this repo (lets the client re-seed SSE state after a reload).
 */
export const OnboardingResponse = z.object({
  sections: z.array(OnboardingSection),
  status: z.enum(['fresh', 'stale']),
  degraded: z.boolean(),
  degradedReason: OnboardingDegradedReason.nullish(),
  indexedSha: z.string(),
  filesIndexed: z.number().int(),
  generatedAt: z.string(),
  generating: z.boolean().optional(),
});
export type OnboardingResponse = z.infer<typeof OnboardingResponse>;

// ---- Eval ----
export const EvalPerTrace = z.object({
  name: z.string(),
  pass: z.boolean(),
  expected: z.unknown(),
  actual: z.unknown(),
});
export type EvalPerTrace = z.infer<typeof EvalPerTrace>;

// `recall` / `precision` / `citation_accuracy` / `duration_ms` are nullable —
// null when the run produced no scorable case (AC-37); an absent measurement
// and a measured zero must render distinctly (AC-31/AC-32).
export const EvalRun = z.object({
  recall: z.number().min(0).max(1).nullable(),
  precision: z.number().min(0).max(1).nullable(),
  citation_accuracy: z.number().min(0).max(1).nullable(),
  traces_passed: z.number().int(),
  traces_total: z.number().int(),
  /** Cases whose model call failed — excluded from every metric denominator (AC-36/AC-37). */
  errored_count: z.number().int().default(0),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  per_trace: z.array(EvalPerTrace),
});
export type EvalRun = z.infer<typeof EvalRun>;

export const EvalOwnerKind = z.enum(['skill', 'agent']);
export type EvalOwnerKind = z.infer<typeof EvalOwnerKind>;

// `EvalCase` is defined near the bottom of this file (see "---- Eval — case
// extensions, effective config, drafts (L06) ----"), after `Provider` /
// `ReviewStrategy` — `EvalEffectiveConfig`, which `EvalCase.latest_draft`
// pins on, is a value snapshot over those exact enums.

// ---- Memory ----
export const MemoryScope = z.enum(['repo', 'global', 'team']);
export type MemoryScope = z.infer<typeof MemoryScope>;

export const MemoryKind = z.enum([
  'decision',
  'convention',
  'preference',
  'fact',
  'learning',
]);
export type MemoryKind = z.infer<typeof MemoryKind>;

export const MemorySource = z.object({
  pr: z.number().int().nullish(),
  context: z.string(),
});
export type MemorySource = z.infer<typeof MemorySource>;

export const MemoryItem = z.object({
  content: z.string(),
  scope: MemoryScope,
  kind: MemoryKind,
  confidence: z.number().min(0).max(1),
  sources: z.array(MemorySource),
});
export type MemoryItem = z.infer<typeof MemoryItem>;

// ---- Skills ----
export const SkillType = z.enum(['rubric', 'convention', 'security', 'custom']);
export type SkillType = z.infer<typeof SkillType>;

export const SkillSource = z.enum(['manual', 'imported_url', 'extracted', 'community']);
export type SkillSource = z.infer<typeof SkillSource>;

export const Skill = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  type: SkillType,
  source: SkillSource,
  body: z.string(),
  enabled: z.boolean(),
  version: z.number().int(),
  evidence_files: z.array(z.string()).nullish(),
  /**
   * Ordered repo-relative paths of project-context documents attached to this
   * skill. Every agent that loads this skill inherits them. Paths only — the
   * document text is read fresh from the clone at run time, never stored here.
   * Mutable config: changing it does NOT snapshot a new skill version.
   */
  attached_docs: z.array(z.string()).default([]),
  /**
   * Number of agents in this workspace that have this skill linked
   * (regardless of per-link enabled). Counted via `agent_skills`; the card on
   * /skills shows "{N} agents". Pull/accept rates are L06/L07 — null until then.
   */
  agents_count: z.number().int().default(0),
});
export type Skill = z.infer<typeof Skill>;

export const RestoreSkillBody = z.object({ version: z.number().int().min(1) });
export type RestoreSkillBody = z.infer<typeof RestoreSkillBody>;

export const SkillDetailStats = z.object({
  used_by: z.number().int(),
  pull_frequency: z.number().nullable(),
  accept_rate: z.number().nullable(),
  findings_30d: z.number().int(),
  agents: z.array(z.object({ id: z.string(), name: z.string() })),
  findings_by_category: z.array(z.object({ label: z.string(), value: z.number().int() })),
});
export type SkillDetailStats = z.infer<typeof SkillDetailStats>;

/** A `skill_versions` snapshot. The body is recorded on every body-change. */
export const SkillVersion = z.object({
  skill_id: z.string(),
  version: z.number().int(),
  body: z.string(),
  created_at: z.string(),
});
export type SkillVersion = z.infer<typeof SkillVersion>;

export const CommunitySkill = z.object({
  name: z.string(),
  repo: z.string(),
  stars: z.number().int(),
  lang: z.string(),
  desc: z.string(),
});
export type CommunitySkill = z.infer<typeof CommunitySkill>;

// ---- Conventions ----
/**
 * A candidate code-style rule extracted from a repository. Each row cites the
 * file + line range it was inferred from (the "evidence"); the snippet is the
 * literal slice from disk after server-side verification.
 *
 * Lifecycle: `pending` (just extracted) → `accepted` | `rejected`. Accepted
 * rows feed `POST /repos/:repoId/conventions/create-skill`, which merges them
 * into one Skill (source=`extracted`, type=`convention`).
 */
export const ConventionStatus = z.enum(['pending', 'accepted', 'rejected']);
export type ConventionStatus = z.infer<typeof ConventionStatus>;

export const ConventionCandidate = z.object({
  id: z.string(),
  repo_id: z.string(),
  scan_id: z.string().nullish(),
  rule: z.string(),
  evidence_path: z.string(),
  evidence_snippet: z.string(),
  confidence: z.number().min(0).max(1),
  status: ConventionStatus,
  created_at: z.string(),
});
export type ConventionCandidate = z.infer<typeof ConventionCandidate>;

/** PATCH /conventions/:id body — status flip and/or rule edit. */
export const UpdateConventionBody = z
  .object({
    status: ConventionStatus.optional(),
    rule: z.string().min(1).max(160).optional(),
  })
  .refine((b) => b.status !== undefined || b.rule !== undefined, {
    message: 'At least one of status or rule is required',
  });
export type UpdateConventionBody = z.infer<typeof UpdateConventionBody>;

/**
 * Latest scan summary for a repo. `scanId` doubles as the SSE runId — the UI
 * subscribes to `/runs/${scanId}/events` to follow extraction progress.
 */
export const ConventionScanSummary = z.object({
  scan_id: z.string().nullable(),
  status: z.enum(['queued', 'running', 'done', 'failed']).nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  error: z.string().nullable(),
});
export type ConventionScanSummary = z.infer<typeof ConventionScanSummary>;

/** Output schema the extraction model is forced to fill. */
export const ConventionCategory = z.enum([
  'naming',
  'async',
  'error-handling',
  'return-types',
  'module-boundaries',
  'import-order',
]);
export type ConventionCategory = z.infer<typeof ConventionCategory>;

export const ConventionCandidatesResponse = z.object({
  candidates: z.array(
    z.object({
      category: ConventionCategory,
      rule: z.string().min(1).max(160),
      evidence_path: z.string().min(1),
      evidence_line_start: z.number().int().min(1),
      evidence_line_end: z.number().int().min(1),
      confidence: z.number().min(0).max(1),
    }),
  ),
});
export type ConventionCandidatesResponse = z.infer<typeof ConventionCandidatesResponse>;

/** POST /repos/:repoId/conventions/create-skill body. */
export const CreateSkillFromConventionsBody = z.object({
  candidate_ids: z.array(z.string()).min(1),
  name: z.string().min(1),
  description: z.string(),
  body: z.string().min(1),
  enabled: z.boolean().optional(),
});
export type CreateSkillFromConventionsBody = z.infer<typeof CreateSkillFromConventionsBody>;

/** Server-computed seed for the "Create skill from conventions" modal. */
export const ConventionSkillPreview = z.object({
  name: z.string(),
  description: z.string(),
  body: z.string(),
});
export type ConventionSkillPreview = z.infer<typeof ConventionSkillPreview>;

// ---- Agents ----
export const Provider = z.enum(['openai', 'anthropic', 'openrouter']);
export type Provider = z.infer<typeof Provider>;

// Review execution strategy (matches @devdigest/reviewer-core's ReviewStrategy):
//  - single-pass: send the WHOLE diff in ONE model call (default)
//  - map-reduce:  one model call PER changed file (for very large diffs)
//  - auto:        single-pass, switching to map-reduce when the diff is large
export const ReviewStrategy = z.enum(['single-pass', 'map-reduce', 'auto']);
export type ReviewStrategy = z.infer<typeof ReviewStrategy>;

// CI gate policy — when a CI review should BLOCK (REQUEST_CHANGES + fail the
// check) vs just comment. Deterministic from severities; acted on ONLY in CI.
export const CiFailOn = z.enum(['never', 'critical', 'warning', 'any']);
export type CiFailOn = z.infer<typeof CiFailOn>;

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  provider: Provider,
  model: z.string(),
  system_prompt: z.string(),
  output_schema: z.unknown().nullish(),
  enabled: z.boolean(),
  version: z.number().int(),
  strategy: ReviewStrategy.default('single-pass'),
  ci_fail_on: CiFailOn.default('critical'),
  // Inject repo-intel context (repo skeleton + callers + rank note) into this
  // agent's review prompt. Default on; gated again by the global flag.
  repo_intel: z.boolean().default(true),
  /**
   * Ordered repo-relative paths of project-context documents attached to this
   * agent. At run time these are unioned with the docs contributed by the
   * agent's ENABLED skills, deduped by path (first wins), read fresh from the
   * clone, and injected into the untrusted `## Project context` prompt slot.
   * Paths only — never the document text. Mutable config: changing it does NOT
   * snapshot a new agent version (so it is absent from `AgentVersionConfig`).
   */
  attached_docs: z.array(z.string()).default([]),
  skills_count: z.number().int().default(0),
});
export type Agent = z.infer<typeof Agent>;

export const AgentSkillLink = z.object({
  agent_id: z.string(),
  skill_id: z.string(),
  order: z.number().int(),
  enabled: z.boolean().default(true),
});
export type AgentSkillLink = z.infer<typeof AgentSkillLink>;

// ---- Eval — case extensions, effective config, drafts (L06) ----

/** Why a case exists: the agent's output must include this, or must never flag it. */
export const EvalExpectation = z.enum(['must_find', 'must_not_flag']);
export type EvalExpectation = z.infer<typeof EvalExpectation>;

/**
 * One item an agent is expected to find (`must_find`). `kind` is
 * load-bearing: it selects the locality rule the scorer applies — file
 * equality only for a full-file kind (`secret_leak` | `lethal_trifecta` |
 * `phantom` | `hook`, mirroring the grounding gate), file + line overlap
 * otherwise (AC-17). `severity` / `category` / `title` are display-only
 * provenance and participate in no match.
 */
export const EvalExpectedItem = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  kind: FindingKind,
  severity: Severity.nullish(),
  category: FindingCategory.nullish(),
  title: z.string().nullish(),
});
export type EvalExpectedItem = z.infer<typeof EvalExpectedItem>;

/**
 * The region a `must_not_flag` case's pass rule tests against — a file plus
 * a line range inherited from the dismissed finding, carrying the same
 * `kind` for the same file-vs-line-overlap locality rule (AC-22).
 */
export const EvalForbiddenRegion = z.object({
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
  kind: FindingKind,
});
export type EvalForbiddenRegion = z.infer<typeof EvalForbiddenRegion>;

/**
 * The frozen snapshot of the finding a case was seeded from — its original
 * rationale (AC-4) and its severity/category/kind for the provenance chip
 * (AC-17). Distinct from `EvalCase.notes`, which is the user's own recorded
 * reason for a `must_not_flag` case.
 */
export const EvalSourceFinding = z.object({
  finding_id: z.string(),
  title: z.string(),
  rationale: z.string(),
  severity: Severity,
  category: FindingCategory,
  kind: FindingKind,
  file: z.string(),
  start_line: z.number().int(),
  end_line: z.number().int(),
});
export type EvalSourceFinding = z.infer<typeof EvalSourceFinding>;

/** Outcome of scoring one case — `errored` (infra/model failure) is distinct from `failed` (AC-36). */
export const EvalCaseOutcome = z.enum(['passed', 'failed', 'errored']);
export type EvalCaseOutcome = z.infer<typeof EvalCaseOutcome>;

/** One resolved skill in an effective config, pinned BY VALUE, including its version (AC-10). */
export const EvalSkillPin = z.object({
  id: z.string(),
  name: z.string(),
  version: z.number().int(),
  order: z.number().int(),
  enabled: z.boolean(),
});
export type EvalSkillPin = z.infer<typeof EvalSkillPin>;

/**
 * The agent configuration an eval run or draft actually ran against — a
 * value snapshot, never a reference to `agent_versions` (whose `configJson`
 * stores skill IDS ONLY and is not re-snapshotted by a skill re-link; see
 * `AgentVersionConfig` above). `skills` is a resolved `EvalSkillPin[]`, NOT a
 * bare id array — an id-only pin is exactly the landmine this shape exists
 * to avoid (AC-10, AC-51).
 */
export const EvalEffectiveConfig = z.object({
  system_prompt: z.string(),
  provider: Provider,
  model: z.string(),
  strategy: ReviewStrategy,
  repo_intel: z.boolean(),
  skills: z.array(EvalSkillPin),
});
export type EvalEffectiveConfig = z.infer<typeof EvalEffectiveConfig>;

/**
 * A scratch result of running one case outside a batch (AC-47). Carries no
 * run identity, is absent from the run history and the trend, and is never
 * an operand of a comparison (AC-47). `stale` is true once the case's
 * current effective config or input fingerprint has moved on from what this
 * draft ran against (AC-48).
 */
/**
 * Lifecycle of an eval run OR a draft. One vocabulary, defined once — a draft
 * is asynchronous (it issues a real model call), so it needs an in-flight state
 * exactly as a run does; without it the client cannot tell "running" from
 * "never drafted", and the one-draft-per-case guard has nothing to render.
 */
export const EvalStatus = z.enum(['running', 'done', 'failed', 'cancelled']);
export type EvalStatus = z.infer<typeof EvalStatus>;

export const EvalDraftResult = z.object({
  case_id: z.string(),
  ran_at: z.string(),
  status: EvalStatus,
  effective_config: EvalEffectiveConfig,
  fingerprint: z.string(),
  /** Null while the draft is still running — an unfinished draft has no outcome. */
  outcome: EvalCaseOutcome.nullable(),
  expected_count: z.number().int(),
  actual_count: z.number().int(),
  findings: z.array(Finding),
  duration_ms: z.number().int().nullable(),
  cost_usd: z.number().nullable(),
  stale: z.boolean(),
});
export type EvalDraftResult = z.infer<typeof EvalDraftResult>;

export const EvalCase = z.object({
  id: z.string(),
  owner_kind: EvalOwnerKind,
  owner_id: z.string(),
  name: z.string(),
  expectation: EvalExpectation,
  input_diff: z.string(),
  input_files: z.unknown(),
  input_meta: z.unknown(),
  expected_output: z.array(EvalExpectedItem),
  forbidden_region: EvalForbiddenRegion.nullable(),
  source_finding_id: z.string().nullable(),
  /** Read-only to the client — set on seed, never accepted via `EvalCaseInput`. */
  source_finding: EvalSourceFinding.nullable(),
  /** Server-derived, read-only — a content hash over the frozen inputs + expectation (AC-14). */
  input_fingerprint: z.string(),
  notes: z.string().nullish(),
  latest_draft: EvalDraftResult.nullable(),
});
export type EvalCase = z.infer<typeof EvalCase>;
