/**
 * Project Context (SPEC-2026-07-10-project-context) — the pure run-time
 * resolver that turns an agent's + its enabled skills' attached document
 * paths into the whole-document texts injected as reviewer-core's existing
 * `## Project context` slot (`ReviewInput.specs`), plus the paths actually
 * read vs skipped for the run trace (`specs_read` / `specs_missing`).
 *
 * Deliberately I/O-free: the caller injects a `read` function (in
 * production, `GitClient.readFileSafe` bound to the repo). This keeps the
 * union/dedupe/ordering/skip logic unit-testable without a DB or a clone.
 */

export interface ResolvedProjectContext {
  /**
   * Whole-document texts, in final injection order — feeds `ReviewInput.specs`.
   * Each entry is prefixed with a `Source: <path>` header (AC-20's "per-document
   * source label") naming the document's repo-relative path, so the model can
   * cite the exact document by name in a finding. The header sits INSIDE the
   * text that reviewer-core wraps in the untrusted fence (`prompt.ts:126-128`)
   * — it is untrusted data (a path), never an instruction, so AC-29 is unaffected.
   */
  texts: string[];
  /** Repo-relative paths actually read, same order as `texts` — feeds `specs_read`. Bare paths, no header. */
  read: string[];
  /** Repo-relative paths that were attached but could not be read — feeds `specs_missing`. Bare paths, no header. */
  missing: string[];
}

/** Prepends the per-document source label (AC-20) to a document's raw text. */
function withSourceHeader(path: string, text: string): string {
  return `Source: ${path}\n\n${text}`;
}

/**
 * Compute the ordered, deduped set of attached document paths — agent's own
 * attached docs first (in the agent's persisted order), then each ENABLED/
 * loaded skill's contributed docs in skill-load order, each skill's own
 * persisted doc order preserved. A path attached more than once (agent+skill,
 * or two skills) is kept only at its FIRST occurrence (AC-19/AC-21).
 *
 * `skillDocs` must already be filtered down to enabled/loaded skills only —
 * a disabled skill's docs must never be passed in (AC-18).
 */
function orderedUniquePaths(agentDocs: readonly string[], skillDocs: readonly (readonly string[])[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  const add = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    ordered.push(path);
  };
  for (const path of agentDocs) add(path);
  for (const docs of skillDocs) {
    for (const path of docs) add(path);
  }
  return ordered;
}

/**
 * Read the union of attached document paths fresh (AC-33: never cached —
 * call this once per run, right before assembling the prompt). Reads that
 * come back `null` (missing, unreadable, non-UTF-8, guard-refused, or the
 * clone absent — `GitClient.readFileSafe`'s contract) are fail-soft: they're
 * skipped and recorded in `missing`, and the run proceeds with the survivors
 * (AC-22). An empty file is NOT a skip — it's a zero-length doc that's still
 * read and still injected.
 */
export async function resolveProjectContext(
  agentDocs: readonly string[],
  skillDocs: readonly (readonly string[])[],
  read: (path: string) => Promise<string | null>,
): Promise<ResolvedProjectContext> {
  const orderedPaths = orderedUniquePaths(agentDocs, skillDocs);
  const results = await Promise.all(
    orderedPaths.map(async (path) => ({ path, text: await read(path) })),
  );

  const texts: string[] = [];
  const readPaths: string[] = [];
  const missing: string[] = [];
  for (const { path, text } of results) {
    if (text == null) {
      missing.push(path);
    } else {
      texts.push(withSourceHeader(path, text));
      readPaths.push(path);
    }
  }
  return { texts, read: readPaths, missing };
}
