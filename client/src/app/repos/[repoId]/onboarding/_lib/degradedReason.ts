/* Degraded/stale reason-code → i18n mapping (AC-12). Closed set aligned to
 * the repo-intel `DegradedReason` vocabulary. Uses the `Set.has()` guard +
 * raw-string fallback idiom (BlastRadiusCard.tsx's `reasonLabel()`) so an
 * unmapped/future reason code never throws next-intl's `MISSING_MESSAGE`
 * (client/INSIGHTS.md:129) — it just renders the raw code instead. */

const KNOWN_ONBOARDING_DEGRADED_REASONS = new Set<string>([
  "flag_off",
  "index_failed",
  "index_partial",
  "repo_too_large",
  "no_data",
]);

/** `t` is the namespaced translator (`useTranslations("onboarding")`); keys
 * live at `degraded.reason.<code>`. */
export function onboardingDegradedReasonLabel(
  t: (key: string) => string,
  reason: string | null | undefined,
): string | null {
  if (!reason) return null;
  return KNOWN_ONBOARDING_DEGRADED_REASONS.has(reason)
    ? t(`degraded.reason.${reason}`)
    : reason;
}
