/* First-tasks helpers: splitting the markdown body into per-task blocks and
 * pulling out the deterministic complexity badge (AC-8). The badge value
 * itself is server-computed (file size + fan-out heuristic) and arrives as
 * plain text embedded in the section `body` markdown (the base `Onboarding`
 * contract is reused unchanged — first-task cards and their complexity
 * badges render WITHIN the body markdown, per the spec's non-goals). The
 * client's job is only to surface that text as an explicit, always-visible
 * label (never colour alone, AC-8's a11y clause) when present. */

export type ComplexityLevel = "Low" | "Medium" | "High";

const COMPLEXITY_RE = /complexity:\s*(low|medium|high)\b/i;

/** Splits a markdown body into one block per top-level bullet (`- ` / `* `)
 * — the expected shape of the `first_tasks` list. Returns an empty array
 * when the body has no bullets (callers fall back to rendering it as plain
 * prose — e.g. the "no obvious starter gaps" degraded-skeleton note). */
export function splitTaskBlocks(body: string | null | undefined): string[] {
  const lines = (body ?? "").split("\n");
  const blocks: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (/^\s*[-*]\s+/.test(line)) {
      if (current.length) blocks.push(current.join("\n").trim());
      current = [line];
    } else if (current.length) {
      current.push(line);
    }
  }
  if (current.length) blocks.push(current.join("\n").trim());
  return blocks;
}

/** Extracts a `Complexity: <Low|Medium|High>` token from a task block's raw
 * markdown text, if present. Case-insensitive; returns null when the block
 * carries no complexity marker (e.g. a degraded skeleton with no badge). */
export function extractComplexity(block: string): ComplexityLevel | null {
  const m = COMPLEXITY_RE.exec(block);
  if (!m) return null;
  const v = m[1]!.toLowerCase();
  if (v === "low") return "Low";
  if (v === "medium") return "Medium";
  return "High";
}
