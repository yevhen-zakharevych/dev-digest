import type React from "react";

export const s = {
  toggleLabel: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
  } as React.CSSProperties,
  toggleText: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-secondary)",
    textTransform: "none",
    letterSpacing: 0,
  } as React.CSSProperties,
  groups: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as React.CSSProperties,
  group: {
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    borderRadius: 8,
    padding: 14,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } as React.CSSProperties,
  groupHeader: {
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } as React.CSSProperties,
  location: {
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,
  groupTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } as React.CSSProperties,
  takes: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
  } as React.CSSProperties,
  take: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  } as React.CSSProperties,
  persona: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    minWidth: 140,
  } as React.CSSProperties,
  didNotFlag: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } as React.CSSProperties,
  pending: {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--accent)",
  } as React.CSSProperties,
  note: {
    fontSize: 12,
    color: "var(--text-secondary)",
    flex: 1,
    minWidth: 0,
  } as React.CSSProperties,
};
