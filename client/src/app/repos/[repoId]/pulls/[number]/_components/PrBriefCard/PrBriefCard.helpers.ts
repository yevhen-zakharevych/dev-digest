/* PrBriefCard.helpers.ts — pure, render-free helpers for PrBriefCard.
   Split out so the reason->i18n mapping is unit-testable without mounting
   React (frontend-architecture: co-located helpers for a single-consumer
   component). The risk-level color/icon table moved to
   `../../_lib/riskLevel.constants.ts` once `RiskAreasCard` became a second
   consumer. */
import type { BriefDegradedReason } from "@devdigest/shared";
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
