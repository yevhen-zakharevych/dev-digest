import type { CSSProperties } from "react";

/** Co-located styles for EvalCompare. */
export const s = {
  wrap: { padding: "20px 28px 60px", maxWidth: 980, display: "flex", flexDirection: "column", gap: 6 } satisfies CSSProperties,
  head: { marginBottom: 10 } satisfies CSSProperties,
  title: { fontSize: 18, fontWeight: 700 } satisfies CSSProperties,
  subtitle: { fontSize: 13, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  banner: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid var(--border-strong)",
    background: "var(--bg-elevated)",
    fontSize: 13,
    marginBottom: 14,
  } satisfies CSSProperties,
  divergenceBanner: {
    border: "1px solid var(--warn, #b58900)",
    background: "var(--warn-bg, rgba(181,137,0,0.1))",
  } satisfies CSSProperties,
  metricsGrid: { display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 } satisfies CSSProperties,
  metricRow: { display: "grid", gridTemplateColumns: "1.1fr 0.8fr 0.8fr 0.8fr 0.8fr", gap: 10, alignItems: "center", fontSize: 13 } satisfies CSSProperties,
  metricLabel: { fontWeight: 600, color: "var(--text-secondary)" } satisfies CSSProperties,
  sectionHeading: { fontSize: 13, fontWeight: 700, margin: "18px 0 8px" } satisfies CSSProperties,
  caseList: { display: "flex", flexDirection: "column", gap: 4, fontSize: 13 } satisfies CSSProperties,
  promptDiffWrap: {
    fontFamily: "var(--font-mono)",
    fontSize: 12.5,
    lineHeight: 1.6,
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "auto",
    maxHeight: 360,
  } satisfies CSSProperties,
  diffLine: (type: "same" | "add" | "remove"): CSSProperties => ({
    padding: "1px 10px",
    whiteSpace: "pre-wrap",
    background: type === "add" ? "var(--ok-bg, rgba(0,180,90,0.12))" : type === "remove" ? "var(--crit-bg)" : "transparent",
    color: type === "add" ? "var(--ok)" : type === "remove" ? "var(--crit)" : "var(--text-secondary)",
  }),
  actionsRow: { display: "flex", gap: 10, marginTop: 20 } satisfies CSSProperties,
  pickerWrap: { display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 } satisfies CSSProperties,
  pickerRow: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: "1px solid var(--border)", borderRadius: 7 } satisfies CSSProperties,
  modalFooter: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
