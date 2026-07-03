import type { CSSProperties } from "react";

/** Co-located styles for IntentCard — mirrors VerdictBanner's card idiom
   (bordered, elevated-bg box) with a two-column IN SCOPE / OUT OF SCOPE grid. */
export const s = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    gap: 14,
    padding: 18,
    borderRadius: 10,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  quote: {
    margin: 0,
    fontSize: 14,
    fontStyle: "italic",
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 20,
  } satisfies CSSProperties,
  scopeCol: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minWidth: 0,
  } satisfies CSSProperties,
  scopeHeading: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  scopeList: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 5,
  } satisfies CSSProperties,
  scopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  inScopeIcon: {
    color: "var(--good, #2e7d32)",
    flexShrink: 0,
    marginTop: 2,
  } satisfies CSSProperties,
  outOfScopeItem: {
    display: "flex",
    alignItems: "flex-start",
    gap: 7,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  emptyDash: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  loadingText: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
