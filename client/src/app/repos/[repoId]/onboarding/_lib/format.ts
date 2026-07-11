/* Pure formatting helpers for the Onboarding header subtitle. Route-local
 * (not shared cross-route — mirrors the same small bucketer duplicated at
 * `context/_lib/format.ts:describeRelativeTime`; each route owns its own
 * copy rather than lifting a two-line helper to `lib/`). No i18n here —
 * i18n happens at the call site so this stays unit-testable without a
 * translator. */

export type RelativeUnit = "now" | "minutes" | "hours" | "days";

/** Buckets a past ISO timestamp into a unit + value for a "refreshed Nm ago"
 * label. Never negative (a clock-skewed future timestamp reads as "now"). */
export function describeRelativeTime(
  isoTimestamp: string,
  now: number = Date.now(),
): { unit: RelativeUnit; value: number } {
  const then = Date.parse(isoTimestamp);
  const diffMs = Math.max(0, now - (Number.isNaN(then) ? now : then));
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return { unit: "now", value: 0 };
  if (minutes < 60) return { unit: "minutes", value: minutes };
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { unit: "hours", value: hours };
  const days = Math.floor(hours / 24);
  return { unit: "days", value: days };
}
