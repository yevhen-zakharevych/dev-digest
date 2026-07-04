import type { CSSProperties } from "react";

/** Co-located styles for SmartDiffViewer + SmartDiffFileCard (mirrors the
 * sibling `src/components/diff-viewer/styles.ts` conventions). */
export const s = {
  root: { display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,

  banner: {
    border: "1px solid var(--warn)",
    borderRadius: 8,
    padding: "12px 14px",
    background: "var(--accent-bg)",
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } satisfies CSSProperties,
  bannerTitle: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  bannerBody: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  bannerList: { margin: "2px 0 0", paddingLeft: 20, fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,

  section: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  sectionSummary: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontSize: 13,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    color: "var(--text-secondary)",
    background: "var(--bg-hover)",
    listStyle: "none",
  } satisfies CSSProperties,
  sectionCount: {
    fontWeight: 500,
    textTransform: "none",
    letterSpacing: "normal",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  sectionBody: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 10,
  } satisfies CSSProperties,
  emptyGroup: {
    padding: "10px 14px",
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  fileCard: {
    border: "1px solid var(--border)",
    borderRadius: 7,
    overflow: "hidden",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  fileHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 12px",
    cursor: "pointer",
  } satisfies CSSProperties,
  fileIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filePath: {
    fontSize: 13,
    fontWeight: 500,
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileStat: { fontSize: 12 } satisfies CSSProperties,
  addText: { color: "var(--code-add-text)" } satisfies CSSProperties,
  delText: { color: "var(--code-del-text)" } satisfies CSSProperties,
  findingCount: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "var(--warn)",
    cursor: "pointer",
    border: "1px solid var(--border)",
    borderRadius: 5,
    padding: "2px 7px",
    background: "var(--bg-surface)",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  fileBody: {
    borderTop: "1px solid var(--border)",
    padding: "8px 0",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  noDiff: {
    padding: "14px 18px",
    fontSize: 13,
    color: "var(--text-muted)",
    textAlign: "center",
  } satisfies CSSProperties,

  /** Wraps one CodeLine so the severity badge can overlay its right edge. */
  lineRow: { position: "relative" } satisfies CSSProperties,
  /** Severity badges pinned to the right of the diff line (like the mockup),
   * only as wide as their content so they never block clicks on the code. */
  lineBadges: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 12,
    display: "flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,
  badgeButton: {
    display: "inline-flex",
    alignItems: "center",
    cursor: "pointer",
    border: "none",
    background: "none",
    padding: 0,
  } satisfies CSSProperties,
} as const;

/** A severity-colored accent bar pinned to the left OR right edge of a finding
 * line (overlaid on CodeLine so its own background can't hide it). */
export function lineBar(color: string, side: "left" | "right"): CSSProperties {
  const base: CSSProperties = {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 3,
    background: color,
    pointerEvents: "none",
    zIndex: 1,
  };
  return side === "left" ? { ...base, left: 0 } : { ...base, right: 0 };
}

/** Chevron rotates 90deg when the file card is open. */
export function chevronFor(open: boolean): CSSProperties {
  return {
    color: "var(--text-muted)",
    transform: open ? "rotate(90deg)" : "none",
    transition: "transform .12s",
  };
}
