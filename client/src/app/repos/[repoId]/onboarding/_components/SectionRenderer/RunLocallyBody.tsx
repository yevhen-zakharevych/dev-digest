/* run_locally body: individually copyable, keyboard-operable shell steps
 * (AC-5), one dark "terminal" block per step. Steps are extracted from the
 * markdown body (`parseRunSteps`) rather than rendered via the generic
 * `<Markdown>` list, because each step needs its own `CopyButton` — a
 * native `<button>`, so keyboard operation (Tab + Enter/Space) is free.
 * Falls back to plain markdown prose when the body carries no numbered
 * list (e.g. a degraded skeleton's short note).
 *
 * The dark block reuses `var(--code-bg)` — the same theme-aware dark-code
 * surface `PromptBlock`/`LiveLogStream` already use (near-black in dark
 * mode, light in light mode) — rather than a hardcoded hex. */
"use client";

import type { CSSProperties } from "react";
import { CopyButton, Markdown } from "@devdigest/ui";
import type { OnboardingSection } from "@devdigest/shared";
import { parseRunSteps } from "../../_lib/parseSteps";

export function RunLocallyBody({
  section,
  copyLabel,
  copiedLabel,
}: {
  section: OnboardingSection;
  copyLabel: string;
  copiedLabel: string;
}) {
  const steps = parseRunSteps(section.body);

  if (steps.length === 0) {
    return <Markdown>{section.body}</Markdown>;
  }

  return (
    <ol style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
      {steps.map((step, i) => (
        <li key={`${i}:${step.command}`} style={blockStyle}>
          <span className="mono" style={stepNumberStyle}>
            {i + 1}
          </span>
          <code className="mono" style={commandStyle}>
            {step.command}
          </code>
          <CopyButton text={step.command} label={copyLabel} copiedLabel={copiedLabel} />
        </li>
      ))}
    </ol>
  );
}

const blockStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "10px 12px",
  borderRadius: 6,
  background: "var(--code-bg)",
};

const stepNumberStyle: CSSProperties = {
  fontSize: 12,
  color: "var(--text-muted)",
  flexShrink: 0,
};

const commandStyle: CSSProperties = {
  flex: 1,
  fontSize: 13,
  color: "var(--text-primary)",
  overflowX: "auto",
  whiteSpace: "pre",
};
