/* PrBriefCard.helpers.ts — pure, render-free helpers for PrBriefCard.
   Split out so the reason->i18n mapping and the risk-level color/icon table
   are unit-testable without mounting React (frontend-architecture: co-located
   helpers for a single-consumer component). */
import type { IconName } from "@devdigest/ui";
import type { BriefDegradedReason, RiskSeverity } from "@devdigest/shared";
import type { useTranslations } from "next-intl";

type Translator = ReturnType<typeof useTranslations>;

/** Closed set of `BriefDegradedReason` values this card knows how to render
 * as an i18n message. A dynamic `t(\`prefix.${code}\`)` MUST guard like this
 * or next-intl throws MISSING_MESSAGE for any value it doesn't recognize
 * (client/INSIGHTS.md:129, precedent BlastRadiusCard.tsx:56-63) — this also
 * future-proofs the card against a `BriefDegradedReason` the server adds
 * later without a matching translation yet. */
const KNOWN_DEGRADED_REASONS = new Set<BriefDegradedReason>(["model_failed", "no_inputs"]);

/** Map a degraded reason code to its i18n message; any reason next-intl
 * doesn't know about yet falls back to the raw code instead of crashing the
 * build. Returns `null` when there is no reason to show. */
export function degradedReasonLabel(
  t: Translator,
  reason: BriefDegradedReason | string | null | undefined,
): string | null {
  if (!reason) return null;
  return KNOWN_DEGRADED_REASONS.has(reason as BriefDegradedReason)
    ? t(`degraded.reason.${reason}`)
    : reason;
}

export interface RiskLevelMeta {
  color: string;
  bg: string;
  icon: IconName;
}

/**
 * Color + icon per brief `risk_level`. The component ALWAYS pairs this with
 * a text label (AC-12 — color is a supplement, never the sole signal).
 * Deliberately a separate table from `vendor/ui/primitives/tokens.ts`'
 * `UISeverity`/`SEV` — that vocabulary (CRITICAL/WARNING/SUGGESTION/INFO)
 * belongs to review findings, not the brief's independent risk judgement
 * (AC-11: `risk_level` is never derived from or reconciled with review data).
 */
export const RISK_LEVEL_META: Record<RiskSeverity, RiskLevelMeta> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
};
