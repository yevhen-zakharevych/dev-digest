import { z } from 'zod';
import {
  RiskSeverity,
  type BriefRisk,
  type BriefRiskReference,
  type ReviewFocusItem,
  type RiskBrief,
} from '@devdigest/shared';

/**
 * L06 — Why+Risk Brief GROUNDING (pure, no I/O).
 *
 * Two jobs, both deterministic and safe to assert on (spec §LLM-usage):
 *   1. Reference grounding (AC-7): every `risks[].references` entry and every
 *      `review_focus[]` entry must resolve to a reference present in the
 *      ASSEMBLED INPUTS. `review_focus` is grounded by file-in-changed-set
 *      (keeping the model-emitted line); risk file refs by file presence, risk
 *      endpoint (bare-string) refs by endpoint presence. Anything the inputs
 *      don't contain is DROPPED — the model cannot invent a location.
 *   2. `risk_level` normalization (AC-8): the model's raw string is normalized
 *      into the closed {high,medium,low} vocabulary; an out-of-vocabulary value
 *      is coerced (never reaches the response).
 *
 * The model call uses the LOOSE `RawRiskBrief` envelope below (NOT the shared
 * `RiskBrief` wire contract) so an out-of-vocab `risk_level` or a hallucinated
 * reference arrives HERE for grounding instead of throwing at schema-parse time.
 * `groundBrief` converts it into the strict, shared `RiskBrief`.
 */

// ---- Raw model envelope (module-internal — NOT a wire contract) ------------

/** A raw, line-bearing file reference (line optional). */
const RawBriefRiskRef = z.object({
  file: z.string(),
  line: z.number().int().nullish(),
});

/** A raw reference: a file (+optional line) or a bare endpoint string. */
const RawReference = z.union([RawBriefRiskRef, z.string()]);

const RawRisk = z.object({
  title: z.string(),
  explanation: z.string(),
  // Loose on purpose — normalized to RiskSeverity by grounding (AC-8).
  severity: z.string(),
  references: z.array(RawReference).nullish(),
});

const RawReviewFocus = z.object({
  file: z.string(),
  line: z.number().int().nullish(),
  reason: z.string(),
});

/**
 * The loose envelope the `risk_brief` structured call is validated against.
 * Deliberately permissive so grounding — not the schema parser — decides what
 * survives (AC-7/AC-8).
 */
export const RawRiskBrief = z.object({
  what: z.string(),
  why: z.string(),
  risk_level: z.string(),
  risks: z.array(RawRisk).nullish(),
  review_focus: z.array(RawReviewFocus).nullish(),
});
export type RawRiskBrief = z.infer<typeof RawRiskBrief>;

// ---- Grounding inputs ------------------------------------------------------

/**
 * The reference universe the brief is grounded against — built from the SAME
 * structured facts fed to the model, so grounding can never disagree with the
 * prompt. All file paths are compared verbatim (repo-relative).
 */
export interface GroundingInputs {
  /** PR changed-file set (from smart-diff / pr_files) — `review_focus` grounds against THIS. */
  changedFiles: string[];
  /** Extra files a risk may cite: changed files ∪ blast caller files ∪ changed-symbol files. */
  riskFiles: string[];
  /** Endpoints/crons from the blast summary a risk may cite as a bare string. */
  endpoints: string[];
}

/**
 * Normalize a raw model `risk_level` string into the closed {high,medium,low}
 * vocabulary (AC-8). Case/whitespace-insensitive; a handful of common synonyms
 * map to the nearest band; anything else falls back to `medium` (never throws,
 * never emits an out-of-vocab value).
 */
export function normalizeRiskLevel(raw: string): RiskSeverity {
  const v = raw.trim().toLowerCase();
  const direct = RiskSeverity.safeParse(v);
  if (direct.success) return direct.data;
  if (v === 'critical' || v === 'severe' || v === 'blocker') return 'high';
  if (v === 'none' || v === 'minimal' || v === 'info' || v === 'trivial') return 'low';
  return 'medium';
}

/** A file reference is grounded when its file is in `allowed`. */
function groundReference(ref: BriefRiskReference, inputs: GroundingInputs): BriefRiskReference | null {
  if (typeof ref === 'string') {
    const endpoint = ref.trim();
    return inputs.endpoints.includes(endpoint) ? endpoint : null;
  }
  if (!inputs.riskFiles.includes(ref.file)) return null;
  // Keep the model-emitted line only when present (a line is optional on a risk ref).
  return ref.line == null ? { file: ref.file } : { file: ref.file, line: ref.line };
}

/**
 * Ground + normalize a raw model brief into the strict shared `RiskBrief`.
 *
 * - `review_focus`: dropped unless its `file` is in the PR changed-file set and
 *   it carries a real line (AC-7/AC-9); the emitted line is kept as-is.
 * - `risks[].references`: each ref grounded independently (file presence for
 *   file refs, endpoint presence for bare strings); a risk whose references are
 *   ALL dropped is removed, so every surviving risk cites ≥1 input-present
 *   reference (AC-9).
 * - `risk_level`: normalized to {high,medium,low} (AC-8).
 */
export function groundBrief(raw: RawRiskBrief, inputs: GroundingInputs): RiskBrief {
  const review_focus: ReviewFocusItem[] = (raw.review_focus ?? [])
    .filter((entry) => entry.line != null && inputs.changedFiles.includes(entry.file))
    .map((entry) => ({ file: entry.file, line: entry.line as number, reason: entry.reason }));

  const risks: BriefRisk[] = [];
  for (const risk of raw.risks ?? []) {
    const references = (risk.references ?? [])
      .map((ref) => groundReference(ref, inputs))
      .filter((ref): ref is BriefRiskReference => ref !== null);
    // A risk that cites nothing input-present is treated as ungrounded → dropped (AC-9).
    if (references.length === 0) continue;
    risks.push({
      title: risk.title,
      explanation: risk.explanation,
      severity: normalizeRiskLevel(risk.severity),
      references,
    });
  }

  return {
    what: raw.what,
    why: raw.why,
    risk_level: normalizeRiskLevel(raw.risk_level),
    risks,
    review_focus,
  };
}
