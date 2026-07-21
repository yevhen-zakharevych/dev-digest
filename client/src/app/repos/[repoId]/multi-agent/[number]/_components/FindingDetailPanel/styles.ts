import type React from "react";

export const s = {
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } as React.CSSProperties,
  closeRow: {
    display: "flex",
    justifyContent: "flex-end",
  } as React.CSSProperties,
  fallback: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "18px 4px",
  } as React.CSSProperties,
};
