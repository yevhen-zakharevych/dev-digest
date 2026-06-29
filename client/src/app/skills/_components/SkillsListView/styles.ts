import type { CSSProperties } from "react";

export const s = {
  page: { display: "flex", height: "100%", overflow: "hidden" } satisfies CSSProperties,
  left: {
    width: 380,
    padding: "24px 24px 44px",
    overflowY: "auto",
    borderRight: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  right: {
    flex: 1,
    background: "var(--bg-surface)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  } satisfies CSSProperties,
  h1: {
    fontSize: 20,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    flex: 1,
  } satisfies CSSProperties,
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 12px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    marginBottom: 16,
  } satisfies CSSProperties,
  searchInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  grid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 12,
  } satisfies CSSProperties,
} as const;
