import type { CSSProperties } from "react";

/** Co-located styles for BlastRadiusCard — a compact card (mirrors IntentCard's
 *  bordered, elevated-bg box idiom, `IntentCard/styles.ts`) that sits beside
 *  IntentCard in the Overview tab's two-column row. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    minWidth: 0,
  } satisfies CSSProperties,

  statsRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  statsGroup: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  statItem: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  } satisfies CSSProperties,
  statIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  statSep: { color: "var(--border-strong)" } satisfies CSSProperties,

  viewToggle: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
  } satisfies CSSProperties,

  symbolList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,

  symbolRow: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  symbolSummary: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "8px 12px",
    cursor: "pointer",
    fontSize: 13,
    color: "var(--text-primary)",
    background: "var(--bg-hover)",
    listStyle: "none",
  } satisfies CSSProperties,
  chevron: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  symbolIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  symbolName: {
    fontWeight: 700,
    fontSize: 13,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: 1,
    minWidth: 0,
  } satisfies CSSProperties,
  callerCount: {
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  symbolBody: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "10px 12px",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,

  callerList: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    margin: 0,
    padding: 0,
    listStyle: "none",
  } satisfies CSSProperties,
  callerRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    fontSize: 12.5,
  } satisfies CSSProperties,
  callerIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,

  badgeWrap: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,

  emptyNote: { fontSize: 12.5, color: "var(--text-muted)", margin: 0 } satisfies CSSProperties,
  overflowCaption: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
    margin: 0,
  } satisfies CSSProperties,

  badgeRow: { display: "flex", alignItems: "center", gap: 8 } satisfies CSSProperties,
  badgeReason: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

  disclaimerFooter: {
    display: "flex",
    alignItems: "flex-start",
    gap: 6,
    fontSize: 11,
    color: "var(--text-muted)",
    lineHeight: 1.5,
    paddingTop: 2,
  } satisfies CSSProperties,
  disclaimerIcon: { color: "var(--text-muted)", flexShrink: 0, marginTop: 1 } satisfies CSSProperties,

  graphPlaceholder: {
    border: "1px dashed var(--border)",
    borderRadius: 8,
  } satisfies CSSProperties,

  loadingText: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
} as const;
