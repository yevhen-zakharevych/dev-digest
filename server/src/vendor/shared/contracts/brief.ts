import { z } from 'zod';

/**
 * PR Brief building blocks: Intent, Blast radius, Risks, PR History,
 * Smart Diff. Composed into PrBrief.
 */

// ---- Intent ----
export const Intent = z.object({
  intent: z.string(),
  in_scope: z.array(z.string()),
  out_of_scope: z.array(z.string()),
});
export type Intent = z.infer<typeof Intent>;

// ---- PR History ----
// Defined before Blast radius: BlastRadius.prior_prs reuses PrHistoryItem.
export const PrHistoryItem = z.object({
  pr_number: z.number().int(),
  title: z.string(),
  merged_at: z.string(),
  author: z.string(),
  files_overlap: z.array(z.string()),
  notes: z.string(),
});
export type PrHistoryItem = z.infer<typeof PrHistoryItem>;

export const PrHistory = z.object({
  history: z.array(PrHistoryItem),
});
export type PrHistory = z.infer<typeof PrHistory>;

// ---- Blast radius ----
export const ChangedSymbol = z.object({
  name: z.string(),
  file: z.string(),
  kind: z.string(),
});
export type ChangedSymbol = z.infer<typeof ChangedSymbol>;

export const BlastCaller = z.object({
  name: z.string(),
  file: z.string(),
  line: z.number().int(),
});
export type BlastCaller = z.infer<typeof BlastCaller>;

export const DownstreamImpact = z.object({
  symbol: z.string(),
  callers: z.array(BlastCaller),
  endpoints_affected: z.array(z.string()),
  crons_affected: z.array(z.string()),
});
export type DownstreamImpact = z.infer<typeof DownstreamImpact>;

export const BlastRadius = z.object({
  changed_symbols: z.array(ChangedSymbol),
  downstream: z.array(DownstreamImpact),
  summary: z.string(),
  prior_prs: z.array(PrHistoryItem),
});
export type BlastRadius = z.infer<typeof BlastRadius>;

// ---- Risks ----
export const RiskSeverity = z.enum(['high', 'medium', 'low']);
export type RiskSeverity = z.infer<typeof RiskSeverity>;

export const Risk = z.object({
  kind: z.string(),
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  file_refs: z.array(z.string()),
});
export type Risk = z.infer<typeof Risk>;

export const Risks = z.object({
  risks: z.array(Risk),
});
export type Risks = z.infer<typeof Risks>;

// ---- Smart Diff ----
export const SmartDiffRole = z.enum(['core', 'wiring', 'boilerplate']);
export type SmartDiffRole = z.infer<typeof SmartDiffRole>;

export const SmartDiffFile = z.object({
  path: z.string(),
  pseudocode_summary: z.string().nullish(),
  additions: z.number().int(),
  deletions: z.number().int(),
  finding_lines: z.array(z.number().int()),
});
export type SmartDiffFile = z.infer<typeof SmartDiffFile>;

export const SmartDiffGroup = z.object({
  role: SmartDiffRole,
  files: z.array(SmartDiffFile),
});
export type SmartDiffGroup = z.infer<typeof SmartDiffGroup>;

export const ProposedSplit = z.object({
  name: z.string(),
  files: z.array(z.string()),
});
export type ProposedSplit = z.infer<typeof ProposedSplit>;

export const SmartDiff = z.object({
  groups: z.array(SmartDiffGroup),
  split_suggestion: z.object({
    too_big: z.boolean(),
    total_lines: z.number().int(),
    proposed_splits: z.array(ProposedSplit),
  }),
});
export type SmartDiff = z.infer<typeof SmartDiff>;

// ---- Composed PR Brief (pr_brief.json) ----
export const PrBrief = z.object({
  intent: Intent,
  blast: BlastRadius,
  risks: Risks,
  history: PrHistory,
});
export type PrBrief = z.infer<typeof PrBrief>;

// ============================================================ Why+Risk Brief OUTPUT
// Net-new, separate output contract for the Why+Risk Brief feature
// (SPEC-2026-07-10-why-risk-brief). Distinct from the input-bundle `PrBrief`
// above, which is left untouched. Reuses the `RiskSeverity` vocabulary.

/** A grounded "read this first" pointer: a real file + line + a plain reason. */
export const ReviewFocusItem = z.object({
  file: z.string(),
  line: z.number().int(),
  reason: z.string(),
});
export type ReviewFocusItem = z.infer<typeof ReviewFocusItem>;

/** A line-bearing file reference on a brief risk (distinct from input `Risk.file_refs`). */
export const BriefRiskRef = z.object({
  file: z.string(),
  line: z.number().int().nullish(),
});
export type BriefRiskRef = z.infer<typeof BriefRiskRef>;

/** A single grounded reference: a file (+optional line) or a bare endpoint string. */
export const BriefRiskReference = z.union([BriefRiskRef, z.string()]);
export type BriefRiskReference = z.infer<typeof BriefRiskReference>;

export const BriefRisk = z.object({
  title: z.string(),
  explanation: z.string(),
  severity: RiskSeverity,
  references: z.array(BriefRiskReference),
});
export type BriefRisk = z.infer<typeof BriefRisk>;

/** The model-produced brief body persisted as `pr_brief.json`. */
export const RiskBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: RiskSeverity,
  risks: z.array(BriefRisk),
  review_focus: z.array(ReviewFocusItem),
});
export type RiskBrief = z.infer<typeof RiskBrief>;

/** Closed set of reasons a generation degraded (mapped to i18n on the client). */
export const BriefDegradedReason = z.enum(['model_failed', 'no_inputs']);
export type BriefDegradedReason = z.infer<typeof BriefDegradedReason>;

export const BriefStatus = z.enum(['fresh', 'stale', 'not_generated', 'degraded']);
export type BriefStatus = z.infer<typeof BriefStatus>;

/** The brief generation call's OWN cost/tokens (not the review run's). */
export const BriefCost = z.object({
  usd: z.number(),
  tokens_in: z.number().int(),
  tokens_out: z.number().int(),
  model: z.string(),
});
export type BriefCost = z.infer<typeof BriefCost>;

/**
 * GET /pulls/:id/brief return — a non-null wrapper discriminated by `status`.
 * `brief`/`head_sha`/`generated_at`/`cost` are present for fresh/stale (and the
 * prior brief on degraded), absent for `not_generated`.
 */
export const BriefResponse = z.object({
  status: BriefStatus,
  brief: RiskBrief.nullish(),
  degraded_reason: BriefDegradedReason.nullish(),
  head_sha: z.string().nullish(),
  generated_at: z.string().nullish(),
  cost: BriefCost.nullish(),
});
export type BriefResponse = z.infer<typeof BriefResponse>;

/** POST /pulls/:id/brief body — `force: true` is Regenerate. */
export const GenerateBriefRequest = z.object({
  force: z.boolean().nullish(),
});
export type GenerateBriefRequest = z.infer<typeof GenerateBriefRequest>;
