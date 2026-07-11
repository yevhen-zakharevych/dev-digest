import type { CSSProperties } from "react";

export const s = {
  /** Two-column row for IntentCard | BlastRadiusCard. `auto-fit` +
   *  `minmax(360px, 1fr)` mirrors the codebase's existing responsive-grid
   *  idiom (`AgentsListView/constants.ts` `CARD_GRID_COLS`) — collapses to a
   *  single column once the row is narrower than ~2*360px+gap, no media
   *  query needed. */
  cardRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))",
    gap: 20,
  } satisfies CSSProperties,
  /** Stacks IntentCard + RiskAreasCard so Risk Areas reads as a continuation
   *  of the Intent panel while staying a separate component/data source
   *  (`RiskAreasCard/RiskAreasCard.tsx`'s header comment). */
  intentColumn: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    minWidth: 0,
  } satisfies CSSProperties,
  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
