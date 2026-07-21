import type React from "react";

export const s = {
  card: {
    display: "flex",
    flexDirection: "column",
    minWidth: 260,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } as React.CSSProperties,
  header: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: "14px 14px 12px",
    borderBottom: "1px solid var(--border)",
  } as React.CSSProperties,
  titleRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  } as React.CSSProperties,
  agentName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } as React.CSSProperties,
  metaRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "4px 12px",
  } as React.CSSProperties,
  meta: {
    fontSize: 12,
    color: "var(--text-secondary)",
  } as React.CSSProperties,
  traceLink: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
    textDecoration: "none",
    alignSelf: "flex-start",
  } as React.CSSProperties,
  list: {
    listStyle: "none",
    margin: 0,
    padding: 8,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } as React.CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "10px 6px",
  } as React.CSSProperties,
  findingRow: (selected: boolean): React.CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    textAlign: "left",
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid " + (selected ? "var(--accent)" : "transparent"),
    background: selected ? "var(--accent-bg)" : "transparent",
    cursor: "pointer",
  }),
  /* Title and location stack, each getting the FULL row width. Side by side they
     cannot both fit: a repo path here runs ~60 chars, and `findingLoc` sets
     `white-space: nowrap`, whose min-content width is the whole string — so as a
     flex sibling it refuses to shrink and starves the title down to one letter. */
  findingBody: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 2,
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
  findingTitle: {
    fontSize: 13,
    color: "var(--text-primary)",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
  findingLoc: {
    fontSize: 11,
    color: "var(--text-muted)",
    whiteSpace: "nowrap",
    maxWidth: "100%",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as React.CSSProperties,
};
