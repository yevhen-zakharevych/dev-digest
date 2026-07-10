import type { CSSProperties } from "react";

/** Co-located styles for the LEFT pane of the Project Context master-detail
 * layout: header label, search box, scrollable flat list, AC-7 footer. */
export const s = {
  left: {
    width: 300,
    minWidth: 280,
    maxWidth: 320,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid var(--border)",
    padding: "20px 16px 0",
    overflow: "hidden",
  } satisfies CSSProperties,
  header: {
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
    margin: "0 4px 14px",
  } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 10px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    marginBottom: 12,
  } satisfies CSSProperties,
  searchIcon: { color: "var(--text-muted)", flexShrink: 0 } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  list: {
    flex: 1,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 2,
    margin: "0 -16px",
    padding: "0 8px",
  } satisfies CSSProperties,
  noMatches: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "8px 8px",
  } satisfies CSSProperties,
  footer: {
    padding: "12px 4px 16px",
    borderTop: "1px solid var(--border)",
    fontSize: 12.5,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,
};
