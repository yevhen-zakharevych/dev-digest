import { z } from 'zod';

/**
 * Project Context — markdown documents discovered in a repo's clone and
 * manually attached to agents/skills, then injected into the untrusted
 * `## Project context` prompt slot at review time.
 *
 * Whole-document only: no chunking, no embeddings, no similarity retrieval.
 * The single computed quantity is a token ESTIMATE. Deliberately distinct from
 * the orphaned semantic-indexing scaffold (`SpecFile`/`IndexStatus` in
 * `contracts/platform.ts`), which belongs to a separate, future feature.
 */

/**
 * Named category a document falls under when it lives inside a `specs`/`docs`/
 * `insights` folder (outermost match wins). Discovery surfaces EVERY `.md` file
 * in the clone, so a file outside all of these folders (e.g. a repo-root
 * `README.md`) has `bucket: null` and simply carries no category badge.
 */
export const DocumentBucket = z.enum(['specs', 'docs', 'insights']);
export type DocumentBucket = z.infer<typeof DocumentBucket>;

export const DiscoveredDocument = z.object({
  /** Repo-relative path, e.g. `docs/architecture/invariants.md`. */
  path: z.string(),
  /** The doc's `specs`/`docs`/`insights` category, or `null` when it's outside all three. */
  bucket: DocumentBucket.nullable(),
  /**
   * Token estimate. Derived from the file's byte size via the char/4 heuristic
   * — the tokenizer adapter's own documented fallback — so discovery walks the
   * tree without reading any file contents.
   */
  estimated_tokens: z.number().int(),
  /**
   * Agents in this workspace that would inject this document on a run: those
   * attaching it directly, plus those inheriting it through an enabled linked
   * skill (the same effective set the run executor computes).
   */
  used_by_agents: z.number().int().default(0),
});
export type DiscoveredDocument = z.infer<typeof DiscoveredDocument>;

/** Footer figures for the Project Context page. No index/chunk state exists. */
export const DiscoverySummary = z.object({
  document_count: z.number().int(),
  total_estimated_tokens: z.number().int(),
  /** When this discovery walk ran — not an index-freshness metric. */
  refreshed_at: z.string(),
});
export type DiscoverySummary = z.infer<typeof DiscoverySummary>;

export const ProjectContextDocs = z.object({
  /**
   * False when the repo has no clone on disk yet. Discovery then reports an
   * empty document set rather than erroring — the page shows a "clone not
   * available" state and a review run skips every attached document.
   */
  clone_available: z.boolean(),
  documents: z.array(DiscoveredDocument),
  summary: DiscoverySummary,
});
export type ProjectContextDocs = z.infer<typeof ProjectContextDocs>;

/** Raw markdown of one discovered document. Read fresh; never cached. */
export const DocumentContent = z.object({
  path: z.string(),
  text: z.string(),
});
export type DocumentContent = z.infer<typeof DocumentContent>;

/**
 * Edit-in-place save. Writes the file in the clone working tree, guarded
 * against traversal/symlink escape. Never commits or pushes — a subsequent
 * repo "Re-analyze" (`git reset --hard`) discards the edit if the file is
 * git-tracked.
 */
export const SaveDocumentBody = z.object({
  path: z.string(),
  text: z.string(),
});
export type SaveDocumentBody = z.infer<typeof SaveDocumentBody>;

/** Query params for reading a single document. */
export const DocumentQuery = z.object({ path: z.string() });
export type DocumentQuery = z.infer<typeof DocumentQuery>;

/** Body of the attach/detach/reorder call on an agent or a skill. */
export const SetAttachedDocsBody = z.object({
  /** Ordered repo-relative paths. Order drives injection order. */
  paths: z.array(z.string()),
});
export type SetAttachedDocsBody = z.infer<typeof SetAttachedDocsBody>;
