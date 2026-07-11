import type { CSSProperties } from "react";

/** Co-located styles for RiskAreasCard — same collapsible-row idiom as
 *  BlastRadiusCard's SymbolRow (`BlastRadiusCard/styles.ts`), but the
 *  reference chip(s) live INSIDE `<summary>` (not the collapsible body) so
 *  they stay visible while the row is collapsed, matching the design mock. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,

  riskRow: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  riskSummary: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    padding: "8px 12px",
    cursor: "pointer",
    background: "var(--bg-hover)",
    listStyle: "none",
  } satisfies CSSProperties,
  riskSummaryTop: {
    display: "flex",
    alignItems: "center",
    gap: 7,
  } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  severityIcon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),
  riskTitle: {
    fontWeight: 700,
    fontSize: 13,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,

  refsRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
    paddingLeft: 20,
  } satisfies CSSProperties,
  // Long paths truncate with an ellipsis instead of overflowing the card;
  // the native `title` attribute (component, not here) shows the full path
  // on hover — same pattern as BlastRadiusCard's caller row (`title={c.name}`,
  // `BlastRadiusCard.tsx:135`).
  refChip: {
    display: "inline-block",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    background: "none",
    border: "none",
    padding: 0,
    fontSize: 12,
    cursor: "pointer",
    color: "var(--accent-text)",
    textUnderlineOffset: 2,
  } satisfies CSSProperties,
  refChipStatic: {
    display: "inline-block",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  riskBody: {
    padding: "10px 12px",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  explanation: {
    margin: 0,
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
