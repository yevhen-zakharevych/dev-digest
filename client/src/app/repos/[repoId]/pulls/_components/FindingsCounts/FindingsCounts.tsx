"use client";

import React from "react";
import { Icon, SEV, CategoryTag } from "@devdigest/ui";
import type { Category } from "@devdigest/ui";
import type { FindingRecord, Severity } from "@devdigest/shared";

const SEVERITIES: ReadonlyArray<Severity> = ["CRITICAL", "WARNING", "SUGGESTION"];

export type SeverityCounts = {
  CRITICAL: number;
  WARNING: number;
  SUGGESTION: number;
};

export function FindingsCounts({
  counts,
  findings,
  loading = false,
  onOpen,
  align = "left",
}: {
  counts: SeverityCounts;
  /** Full findings list to filter inside the popover; pass null while loading. */
  findings: FindingRecord[] | null;
  loading?: boolean;
  /** Fired the first time the popover opens — parent uses it to lazy-load. */
  onOpen?: () => void;
  /** Anchors the popover left or right of the trigger group. */
  align?: "left" | "right";
}) {
  const [active, setActive] = React.useState<Severity | null>(null);
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const hasFiredOpen = React.useRef(false);

  React.useEffect(() => {
    if (!active) return;
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setActive(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActive(null);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [active]);

  const total = counts.CRITICAL + counts.WARNING + counts.SUGGESTION;
  if (total === 0) {
    return <span style={{ color: "var(--text-muted)" }}>—</span>;
  }

  const handleClick = (sev: Severity, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!hasFiredOpen.current) {
      hasFiredOpen.current = true;
      onOpen?.();
    }
    setActive((cur) => (cur === sev ? null : sev));
  };

  const filtered = findings?.filter((f) => f.severity === active) ?? [];

  return (
    <div
      ref={rootRef}
      style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6 }}
      onClick={(e) => e.stopPropagation()}
    >
      {SEVERITIES.map((sev) => {
        const n = counts[sev];
        if (n === 0) return null;
        const tok = SEV[sev];
        const I = Icon[tok.icon];
        const isActive = active === sev;
        return (
          <button
            key={sev}
            type="button"
            onClick={(e) => handleClick(sev, e)}
            aria-label={`${n} ${tok.label}`}
            title={`${n} ${tok.label}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              padding: "2px 5px",
              borderRadius: 4,
              border: "1px solid " + (isActive ? tok.c : "transparent"),
              background: isActive ? tok.bg : "transparent",
              color: tok.c,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              lineHeight: 1.2,
            }}
          >
            <I size={12.5} />
            <span className="tnum">{n}</span>
          </button>
        );
      })}

      {active && (
        <FindingsPopover
          severity={active}
          findings={filtered}
          loading={loading}
          align={align}
          onClose={() => setActive(null)}
        />
      )}
    </div>
  );
}

function FindingsPopover({
  severity,
  findings,
  loading,
  align,
  onClose,
}: {
  severity: Severity;
  findings: FindingRecord[];
  loading: boolean;
  align: "left" | "right";
  onClose: () => void;
}) {
  const tok = SEV[severity];
  const I = Icon[tok.icon];
  return (
    <div
      role="dialog"
      aria-label={`${tok.label} findings`}
      style={{
        position: "absolute",
        top: "calc(100% + 6px)",
        [align]: 0,
        zIndex: 20,
        minWidth: 360,
        maxWidth: 480,
        maxHeight: 420,
        overflowY: "auto",
        background: "var(--bg-elevated)",
        border: "1px solid var(--border-strong)",
        borderRadius: 8,
        boxShadow: "0 12px 32px rgba(0,0,0,.35)",
        padding: 12,
        color: "var(--text-primary)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: tok.c,
          fontSize: 11,
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          marginBottom: 8,
        }}
      >
        <I size={13} />
        {findings.length} {tok.label} {findings.length === 1 ? "finding" : "findings"}
        <span style={{ flex: 1 }} />
        <button
          onClick={onClose}
          aria-label="Close"
          style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2 }}
        >
          <Icon.X size={13} />
        </button>
      </div>

      {loading ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>Loading findings…</div>
      ) : findings.length === 0 ? (
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No {tok.label.toLowerCase()} findings.</div>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          {findings.map((f) => (
            <li key={f.id} style={{ borderTop: "1px solid var(--border)", paddingTop: 8 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{f.title}</span>
                <CategoryTag category={f.category as Category} />
              </div>
              <div
                className="mono"
                style={{ marginTop: 3, display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-muted)" }}
              >
                <span style={{ color: "var(--accent)" }}>
                  {f.file}:{f.start_line === f.end_line ? f.start_line : `${f.start_line}-${f.end_line}`}
                </span>
                <span style={{ color: confidenceColor(f.confidence) }}>
                  ● {Math.round(f.confidence * 100)}% conf
                </span>
              </div>
              <p
                style={{
                  margin: "4px 0 0",
                  fontSize: 12.5,
                  color: "var(--text-secondary)",
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {f.rationale}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function confidenceColor(conf: number): string {
  if (conf >= 0.85) return "var(--ok)";
  if (conf >= 0.65) return "var(--warn)";
  return "var(--text-muted)";
}
