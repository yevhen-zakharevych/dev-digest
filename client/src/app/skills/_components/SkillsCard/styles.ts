import type { CSSProperties } from "react";

export const cardS = (active: boolean, enabled: boolean): CSSProperties => ({
  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
  borderRadius: 10,
  padding: "14px 14px 12px",
  background: enabled ? "var(--bg-surface)" : "var(--bg-secondary)",
  display: "flex",
  flexDirection: "column",
  gap: 8,
  cursor: "pointer",
  opacity: enabled ? 1 : 0.65,
  transition: "border-color .15s, background .15s",
});

export const s = {
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  iconBox: {
    width: 28,
    height: 28,
    borderRadius: 7,
    background: "var(--bg-secondary)",
    display: "grid",
    placeItems: "center",
    color: "var(--text-secondary)",
    flexShrink: 0,
  } satisfies CSSProperties,
  name: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  description: {
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.4,
    display: "-webkit-box",
    WebkitLineClamp: 2,
    WebkitBoxOrient: "vertical",
    overflow: "hidden",
  } satisfies CSSProperties,
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  } satisfies CSSProperties,
  statsRow: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    fontSize: 12,
    color: "var(--text-secondary)",
    borderTop: "1px solid var(--border)",
    paddingTop: 10,
    marginTop: 4,
  } satisfies CSSProperties,
  stat: { display: "inline-flex", gap: 4, alignItems: "baseline" } satisfies CSSProperties,
  statValue: { color: "var(--text-primary)", fontWeight: 600 } satisfies CSSProperties,
} as const;
