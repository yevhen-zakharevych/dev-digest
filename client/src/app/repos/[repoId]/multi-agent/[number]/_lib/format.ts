/* Route-local formatting for the Multi-Agent Review results page.
   Cost formatting is NOT duplicated here — `formatCost` from `@devdigest/ui`
   is the single source for that (it already renders `null` as `—` and keeps
   `0` distinguishable as `$0.0000`). */

/** A run duration for a column header. `null` (a run that never reported one)
 *  renders as an em-dash, never as `0s`. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "—";
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** Whole seconds for the header's `page.meta` summary line (the message already
 *  supplies the trailing "s total"). */
export function totalSeconds(ms: number | null | undefined): number {
  if (ms == null || !Number.isFinite(ms)) return 0;
  return Math.round(ms / 1000);
}
