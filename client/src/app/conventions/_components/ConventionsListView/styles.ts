import type { CSSProperties } from "react";

export const s = {
  page: {
    padding: "24px 32px 44px",
    maxWidth: 1200,
    margin: "0 auto",
    overflowY: "auto",
    height: "100%",
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 24,
  } satisfies CSSProperties,
  headerText: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  h1: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: "-0.02em",
    marginBottom: 4,
  } satisfies CSSProperties,
  h1Repo: {
    fontFamily: "var(--font-mono)",
    fontWeight: 600,
    background: "var(--bg-secondary)",
    padding: "1px 8px",
    borderRadius: 6,
    marginLeft: 4,
  } satisfies CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  actionRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 18,
    minHeight: 32,
  } satisfies CSSProperties,
  counter: {
    fontSize: 13,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  spacer: { flex: 1 } satisfies CSSProperties,
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
  } satisfies CSSProperties,
  scanningBox: {
    border: "1px solid var(--border)",
    background: "var(--bg-secondary)",
    borderRadius: 10,
    padding: "20px 24px",
    marginBottom: 18,
  } satisfies CSSProperties,
  scanningTitle: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    fontWeight: 600,
    marginBottom: 8,
  } satisfies CSSProperties,
  scanningTail: {
    fontFamily: "var(--font-mono)",
    fontSize: 12,
    color: "var(--text-muted)",
    whiteSpace: "pre-wrap",
    maxHeight: 80,
    overflowY: "auto",
  } satisfies CSSProperties,
} as const;
