import type { CSSProperties } from "react";

/** Co-located styles for the RIGHT pane of the Project Context master-detail
 * layout: the selected document's header row (filename, Preview/Edit toggle,
 * "Used by N agents"), and the Preview/Edit content area below it. */
export const s = {
  right: {
    flex: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  } satisfies CSSProperties,
  emptyState: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "var(--text-muted)",
    fontSize: 13.5,
  } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    padding: "20px 24px",
    borderBottom: "1px solid var(--border)",
    flexShrink: 0,
  } satisfies CSSProperties,
  filename: {
    fontSize: 15,
    fontWeight: 650,
    color: "var(--text-primary)",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  modeToggle: {
    display: "inline-flex",
    gap: 4,
    padding: 3,
    borderRadius: 8,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    width: "fit-content",
    flexShrink: 0,
  } satisfies CSSProperties,
  modeActive: {
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    borderColor: "var(--border-strong)",
    fontWeight: 600,
  } satisfies CSSProperties,
  usedBy: {
    marginLeft: "auto",
    fontSize: 12.5,
    color: "var(--text-muted)",
    flexShrink: 0,
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  body: {
    flex: 1,
    overflowY: "auto",
    padding: "20px 24px",
  } satisfies CSSProperties,
  muted: { fontSize: 13, color: "var(--text-muted)" } satisfies CSSProperties,
  editArea: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,
  editWarning: {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    padding: "8px 12px",
    borderRadius: 6,
    background: "var(--warn-bg)",
    color: "var(--warn)",
    fontSize: 12.5,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  warnIcon: { flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  editActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  } satisfies CSSProperties,
  saveError: {
    fontSize: 12.5,
    color: "var(--crit)",
  } satisfies CSSProperties,
};
