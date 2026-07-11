import type { IconName } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";

export interface RiskLevelMeta {
  color: string;
  bg: string;
  icon: IconName;
}

/**
 * Color + icon per brief `risk_level` / `BriefRisk.severity`. Route-local
 * (not `lib/constants/`): only the Why+Risk Brief cards on this route
 * consume it. Promoted here from `PrBriefCard.helpers.ts` once `RiskAreasCard`
 * became a second consumer (client/AGENTS.md co-location rule). The card
 * ALWAYS pairs this with a text label (AC-12 — color is a supplement, never
 * the sole signal). Deliberately a separate table from `vendor/ui/primitives/
 * tokens.ts`'s `UISeverity`/`SEV` — that vocabulary (CRITICAL/WARNING/
 * SUGGESTION/INFO) belongs to review findings, not the brief's independent
 * risk judgement (AC-11: never derived from or reconciled with review data).
 */
export const RISK_LEVEL_META: Record<RiskSeverity, RiskLevelMeta> = {
  high: { color: "var(--crit)", bg: "var(--crit-bg)", icon: "AlertOctagon" },
  medium: { color: "var(--warn)", bg: "var(--warn-bg)", icon: "AlertTriangle" },
  low: { color: "var(--ok)", bg: "var(--ok-bg)", icon: "CheckCircle" },
};
