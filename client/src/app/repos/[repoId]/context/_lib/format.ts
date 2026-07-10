/* Pure formatting helpers for the Project Context footer + document rows.
   No i18n here (i18n happens at the call site) so these stay unit-testable
   without a translator. */

/** Token-count formatting: plain below 1000, "X.Yk" at/above (matches the
 * spec's footer example "≈ 4.1k tokens total"). */
export function formatTokenCount(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(1)}k`;
}

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

/** Split a repo-relative document path into its folder and filename parts. */
export function splitDocPath(path: string): { dir: string; file: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { dir: "", file: path };
  return { dir: path.slice(0, idx), file: path.slice(idx + 1) };
}
