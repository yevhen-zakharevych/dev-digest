/* GenerationProgress — non-dismissible progress indicator shown WHILE a
 * generation is running (AC-18). Two flavours, both non-dismissible (no
 * close affordance is ever rendered here):
 *   - `events` present (this session triggered the run, has a live
 *     `scanId`): render the streamed SSE tail, reusing the `conventions/`
 *     run-progress pattern.
 *   - `events` absent (reload mid-generation — the GET's `generating` flag
 *     is a boolean only, no scanId survives a reload to re-subscribe SSE
 *     to, client/INSIGHTS.md:92-93): render a generic "still generating"
 *     notice; the view polls the GET (`refetchInterval`) until it resolves.
 * NEVER rendered on the synchronous degraded generate path — that path
 * returns a finished artifact directly, no progress state exists for it. */
"use client";

import React from "react";
import { Icon } from "@devdigest/ui";
import type { RunEvent } from "@devdigest/shared";

export function GenerationProgress({
  title,
  hint,
  events,
}: {
  title: string;
  hint: string;
  /** Present only when this session holds a live SSE subscription. */
  events?: RunEvent[];
}) {
  return (
    <div role="status" aria-live="polite" style={boxStyle} data-testid="onboarding-progress">
      <div style={titleStyle}>
        <Icon.RefreshCw size={14} style={{ animation: "ddspin 1s linear infinite" }} />
        {title}
      </div>
      <div style={tailStyle}>
        {!events || events.length === 0
          ? hint
          : events
              .slice(-6)
              .map((e) => `[${e.t}] ${e.msg}`)
              .join("\n")}
      </div>
    </div>
  );
}

const boxStyle: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "var(--bg-elevated)",
  marginBottom: 16,
};

const titleStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  fontSize: 13,
  fontWeight: 600,
  color: "var(--text-primary)",
};

const tailStyle: React.CSSProperties = {
  marginTop: 6,
  fontSize: 12,
  color: "var(--text-muted)",
  whiteSpace: "pre-wrap",
  fontFamily: "var(--font-mono, monospace)",
};
