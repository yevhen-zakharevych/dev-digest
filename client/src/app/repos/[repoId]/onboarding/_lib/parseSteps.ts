/* Parses the `run_locally` section's markdown body into an ordered list of
 * shell steps (AC-5). The server hands us markdown prose, not a structured
 * step array (the base `Onboarding` contract is reused unchanged — see the
 * spec's non-goals), so the client extracts numbered-list lines itself and
 * strips inline markdown for the clipboard value (the rendered line can stay
 * formatted; the copied text should be a plain, pasteable command). */

export interface RunStep {
  /** Original line content (may carry inline markdown, e.g. backticks). */
  raw: string;
  /** Plain-text command, safe to place on the clipboard. */
  command: string;
}

const NUMBERED_LINE_RE = /^\s*\d+[.)]\s+(.*)$/;

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .trim();
}

/** Returns one `RunStep` per numbered markdown list line (`1. …`, `2) …`).
 * Empty array when the body carries no ordered list — callers fall back to
 * rendering the raw body as prose (e.g. a degraded skeleton's plain note). */
export function parseRunSteps(body: string | null | undefined): RunStep[] {
  const steps: RunStep[] = [];
  for (const line of (body ?? "").split("\n")) {
    const m = NUMBERED_LINE_RE.exec(line);
    if (!m) continue;
    const raw = m[1]!.trim();
    if (!raw) continue;
    steps.push({ raw, command: stripInlineMarkdown(raw) });
  }
  return steps;
}
