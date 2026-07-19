/* format.ts — shared, pure formatting helpers for the eval surfaces
   (dashboard, case editor, compare). Colocated under `evals/_lib` because
   all three route subtrees (T13/T14/T15) need the identical "absent vs
   measured-zero" rendering rule (AC-31/AC-32) and duplicating it three times
   would let the three screens silently drift on the one rule that matters
   most in this feature. */

/** A null metric is an ABSENT measurement, not a zero (AC-31/AC-32) — render "—". */
export function formatPercent(v: number | null | undefined, dash = "—"): string {
  if (v == null) return dash;
  return `${Math.round(v * 100)}%`;
}

export function formatCost(v: number | null | undefined, dash = "—"): string {
  if (v == null) return dash;
  return `$${v.toFixed(2)}`;
}

export function formatDurationSeconds(ms: number | null | undefined, dash = "—"): string {
  if (ms == null) return dash;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatDateTime(iso: string | null | undefined, dash = "—"): string {
  if (!iso) return dash;
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

/** Signed delta with an explicit sign — direction must never be colour alone (a11y NFR). */
export function formatSignedPercent(delta: number | null | undefined): string {
  if (delta == null) return "—";
  const pct = Math.round(delta * 100);
  const sign = pct > 0 ? "+" : pct < 0 ? "" : "±";
  return `${sign}${pct}%`;
}
