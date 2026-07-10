/* ContextTab/helpers.ts — pure helpers for the agent Context tab
   (AC-8 .. AC-13, specs/2026-07-10-project-context.md). Kept framework-free
   so they're unit-testable without rendering anything. */
import type { DiscoveredDocument } from "@devdigest/shared";

/** Split a repo-relative path into its filename and containing folder. */
export function splitPath(path: string): { filename: string; folder: string } {
  const idx = path.lastIndexOf("/");
  if (idx === -1) return { filename: path, folder: "" };
  return { filename: path.slice(idx + 1), folder: path.slice(0, idx) };
}

/**
 * Union of the agent's own attached paths and the attached paths contributed
 * by its ENABLED linked skills (in skill-load order), deduped by path with
 * the FIRST occurrence kept — mirrors the run-time injection order (AC-21)
 * so the token estimate (AC-11) matches what is actually injected.
 */
export function computeEffectivePaths(
  agentPaths: readonly string[],
  skillPathsInOrder: readonly (readonly string[])[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of [...agentPaths, ...skillPathsInOrder.flat()]) {
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/** Sum `estimated_tokens` over a set of paths, using the discovered-document
 *  catalog to resolve each path's token count. A path absent from the
 *  catalog (stale/unknown) contributes 0. */
export function sumEstimatedTokens(
  paths: readonly string[],
  documents: readonly DiscoveredDocument[],
): number {
  const byPath = new Map(documents.map((d) => [d.path, d.estimated_tokens]));
  return paths.reduce((sum, p) => sum + (byPath.get(p) ?? 0), 0);
}

/** Case-insensitive filter over filename OR full path — does not mutate
 *  attach state (AC-12). */
export function filterDocuments(
  documents: readonly DiscoveredDocument[],
  query: string,
): DiscoveredDocument[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...documents];
  return documents.filter((d) => d.path.toLowerCase().includes(q));
}

/** Order rows for display: attached documents first, in the agent's
 *  persisted order (this is the reorderable region), then every unattached
 *  document sorted by path. */
export function orderRows(
  documents: readonly DiscoveredDocument[],
  attachedPaths: readonly string[],
): DiscoveredDocument[] {
  const byPath = new Map(documents.map((d) => [d.path, d]));
  const attached = attachedPaths
    .map((p) => byPath.get(p))
    .filter((d): d is DiscoveredDocument => d != null);
  const attachedSet = new Set(attachedPaths);
  const unattached = documents
    .filter((d) => !attachedSet.has(d.path))
    .sort((a, b) => a.path.localeCompare(b.path));
  return [...attached, ...unattached];
}
