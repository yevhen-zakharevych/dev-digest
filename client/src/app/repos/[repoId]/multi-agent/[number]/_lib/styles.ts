import type React from "react";

export const s = {
  page: {
    padding: "28px 32px 44px",
    display: "flex",
    flexDirection: "column",
    gap: 24,
    maxWidth: 1240,
    margin: "0 auto",
  } as React.CSSProperties,
  header: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 16,
    flexWrap: "wrap",
  } as React.CSSProperties,
  headerMain: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    minWidth: 0,
  } as React.CSSProperties,
  title: {
    fontSize: 20,
    fontWeight: 700,
    color: "var(--text-primary)",
    margin: 0,
  } as React.CSSProperties,
  prTitle: {
    fontSize: 15,
    color: "var(--text-primary)",
  } as React.CSSProperties,
  subtitle: {
    fontSize: 13,
    color: "var(--text-secondary)",
  } as React.CSSProperties,
  meta: {
    fontSize: 12,
    color: "var(--text-muted)",
  } as React.CSSProperties,
  configureLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 14px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
    color: "var(--text-primary)",
    fontSize: 13,
    fontWeight: 600,
    textDecoration: "none",
    whiteSpace: "nowrap",
  } as React.CSSProperties,
};
