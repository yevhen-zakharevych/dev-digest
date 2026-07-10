import type { CSSProperties } from "react";

/** Co-located styles for one discovered-document row in the LEFT pane's flat
 * list. The row is a native `<button>` (keyboard-operable for free); the
 * selected row is highlighted via background + a left accent bar — colour is
 * never the ONLY cue (the row's own text stays fully legible either way, and
 * the bucket badge pairs its colour with a text label). */
export const s = {
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "8px 8px",
    border: "none",
    // Longhand left-border trio (NOT the `borderLeft` shorthand) so
    // `rowSelected` can override just `borderLeftColor` on rerender without
    // React's shorthand/non-shorthand style warning (client/INSIGHTS.md).
    borderLeftWidth: 3,
    borderLeftStyle: "solid",
    borderLeftColor: "transparent",
    borderRadius: 6,
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    font: "inherit",
    color: "inherit",
  } satisfies CSSProperties,
  rowSelected: {
    background: "var(--bg-hover)",
    borderLeftColor: "var(--accent-text)",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  titleWrap: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    flex: 1,
  } satisfies CSSProperties,
  filename: {
    fontSize: 13.5,
    fontWeight: 550,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  dirPath: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  bucketBadge: { flexShrink: 0 } satisfies CSSProperties,
};
