import type {
  DiscoveredDocument,
  DiscoverySummary,
  DocumentBucket,
  DocumentContent,
  ProjectContextDocs,
  SaveDocumentBody,
} from '@devdigest/shared';
import type { RepoFileEntry } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import { NotFoundError } from '../../platform/errors.js';
import { RepoRepository, type RepoRow } from '../repos/repository.js';
import { ContextRepository } from './repository.js';
import { DEFAULT_BUCKET_DIRS } from './constants.js';

/**
 * Assign a discovered `.md` file to the OUTERMOST folder in its path that
 * matches one of `bucketDirs` (AC-4). Deterministic: path segments are
 * walked left-to-right (repo root first) and the FIRST match wins, so
 * `docs/specs/x.md` always resolves to `docs`, never `specs`, on every call.
 * The final segment (the filename) is never itself treated as a bucket, even
 * if it happens to equal one of the configured names.
 */
export function assignBucket(
  path: string,
  bucketDirs: readonly DocumentBucket[],
): DocumentBucket | null {
  const folderSegments = path.split('/').slice(0, -1);
  for (const segment of folderSegments) {
    // `bucketDirs` is itself `DocumentBucket[]`, so `includes` already only
    // ever matches a valid enum member — the cast below is safe by
    // construction (FIX 6b), not a smuggled-in escape hatch.
    if (bucketDirs.includes(segment as DocumentBucket)) return segment as DocumentBucket;
  }
  return null;
}

/**
 * A caller-supplied path may be read or written ONLY if it is a markdown file
 * (`.md`, matched case-insensitively — the same set discovery surfaces). This
 * is an ALLOWLIST checked BEFORE any filesystem access, in addition to (not
 * instead of) the tree-boundary guard `readFileSafe`/`writeFileSafe` already
 * enforce via `safeResolve` (`simple-git.ts`) — that guard only refuses paths
 * that ESCAPE the clone tree, not paths that are simply the wrong kind of
 * in-tree file. The `.md` requirement is what blocks the direct RCE/secret
 * sink: `path=.git/config` resolves inside the tree and would otherwise be
 * readable/writable, exposing the embedded GitHub token
 * (`modules/repos/helpers.ts` `withGitHubToken`) or letting a caller plant a
 * malicious `.git/config` (e.g. `core.fsmonitor`) that executes on the next
 * `git` operation (AC-30, AC-32). `.git/config` is not `.md`, so it stays
 * refused even though the bucket-folder requirement was dropped to surface
 * every markdown file, not just bucketed ones.
 *
 * NOTE (known residual, pre-existing): a committed in-tree symlink
 * `x.md -> .git/config` passes this `.md` check and `safeResolve` follows it
 * (its realpath is in-tree). Closing that needs a per-component symlink refusal
 * in the write guard — tracked as a follow-up, not addressed here.
 */
export function isAttachableDocumentPath(path: string): boolean {
  return path.toLowerCase().endsWith('.md');
}

/**
 * Categorise every discovered `.md` file: pair each with its `specs`/`docs`/
 * `insights` bucket (outermost match wins, AC-4), or `null` when it lives
 * outside all three. Every file is kept — discovery surfaces ALL markdown in
 * the clone, not just bucketed files; the bucket is a badge, not a filter.
 */
export function categorizeDocuments(
  entries: readonly RepoFileEntry[],
  bucketDirs: readonly DocumentBucket[],
): { entry: RepoFileEntry; bucket: DocumentBucket | null }[] {
  return entries.map((entry) => ({ entry, bucket: assignBucket(entry.path, bucketDirs) }));
}

/**
 * Token estimate from byte size alone — the char/4 heuristic that is the
 * tokenizer adapter's own documented fallback (`adapters/tokenizer/index.ts`'s
 * `approxTokens`). Discovery never reads file contents (AC-6, perf), so this
 * is computed from `RepoFileEntry.bytes`, never from loaded text.
 */
export function estimateTokens(bytes: number): number {
  return Math.ceil(bytes / 4);
}

/** Combine categorized entries + a (possibly empty) usage map into the wire shape. */
export function toDiscoveredDocuments(
  categorized: readonly { entry: RepoFileEntry; bucket: DocumentBucket | null }[],
  usedByAgents: ReadonlyMap<string, number> = new Map(),
): DiscoveredDocument[] {
  return categorized.map(({ entry, bucket }) => ({
    path: entry.path,
    bucket,
    estimated_tokens: estimateTokens(entry.bytes),
    used_by_agents: usedByAgents.get(entry.path) ?? 0,
  }));
}

export function buildSummary(
  documents: readonly DiscoveredDocument[],
  refreshedAt: string,
): DiscoverySummary {
  return {
    document_count: documents.length,
    total_estimated_tokens: documents.reduce((sum, d) => sum + d.estimated_tokens, 0),
    refreshed_at: refreshedAt,
  };
}

/**
 * Discovery + guarded doc read/write for the Project Context feature.
 *
 * NOT to be confused with the orphaned semantic-indexing scaffold
 * (`db/schema/context.ts`, `SpecFile`/`IndexStatus` in `contracts/platform.ts`)
 * — this module owns only the `/repos/:repoId/project-context*` routes and
 * touches none of that scaffold.
 */
export class ContextService {
  private repos: RepoRepository;
  private usage: ContextRepository;

  constructor(
    private container: Container,
    private bucketDirs: readonly DocumentBucket[] = DEFAULT_BUCKET_DIRS,
  ) {
    this.repos = new RepoRepository(container.db);
    this.usage = new ContextRepository(container.db);
  }

  /**
   * Walk the repo's clone for `.md` files under a configured bucket folder
   * (AC-1–4), estimate tokens by byte size only — no file contents read, no
   * model/network call (AC-6, AC-24) — and attach the "used by N agents"
   * count (AC-13). Clone absent → empty set + `clone_available: false`, HTTP
   * 200 (AC-5), never a thrown error.
   */
  async discover(workspaceId: string, repoId: string): Promise<ProjectContextDocs> {
    const repo = await this.getWorkspaceRepo(workspaceId, repoId);
    const refreshedAt = new Date().toISOString();

    const entries = await this.container.git.listMarkdownFilesSafe({
      owner: repo.owner,
      name: repo.name,
    });
    if (entries === null) {
      return { clone_available: false, documents: [], summary: buildSummary([], refreshedAt) };
    }

    const categorized = categorizeDocuments(entries, this.bucketDirs);
    // FIX 2: pass THIS repo's own discovered paths so the count can never be
    // attributed to a path this repo didn't itself discover (see
    // `ContextRepository.usedByAgentsCounts` for the residual limitation —
    // `attached_docs` carries no repo binding, so an identical repo-relative
    // path genuinely present in two different repos' clones cannot be
    // disambiguated by path alone).
    const counts = await this.usage.usedByAgentsCounts(
      workspaceId,
      categorized.map(({ entry }) => entry.path),
    );
    const documents = toDiscoveredDocuments(categorized, counts);

    return { clone_available: true, documents, summary: buildSummary(documents, refreshedAt) };
  }

  /**
   * Guarded read (AC-30 read, via the existing `readFileSafe`/`safeResolve`
   * guard, PLUS the `isAttachableDocumentPath` allowlist checked BEFORE any
   * filesystem access — FIX 1). A missing, unreadable, traversal-refused, or
   * not-an-attachable-document path is a handled 404 — never a 5xx.
   */
  async readDocument(workspaceId: string, repoId: string, path: string): Promise<DocumentContent> {
    const repo = await this.getWorkspaceRepo(workspaceId, repoId);
    if (!isAttachableDocumentPath(path)) {
      throw new NotFoundError('Document not found');
    }
    const text = await this.container.git.readFileSafe(
      { owner: repo.owner, name: repo.name },
      path,
    );
    if (text === null) throw new NotFoundError('Document not found');
    return { path, text };
  }

  /**
   * Guarded save (AC-30 write, AC-32) — `writeFileSafe` issues no git
   * add/commit/push and no LLM call. The `isAttachableDocumentPath` allowlist
   * (FIX 1) is checked BEFORE the write is attempted, same as the read path.
   * A refused, not-an-attachable-document, or vanished path reports a handled
   * 404 rather than silently dropping the edit.
   */
  async saveDocument(
    workspaceId: string,
    repoId: string,
    body: SaveDocumentBody,
  ): Promise<DocumentContent> {
    const repo = await this.getWorkspaceRepo(workspaceId, repoId);
    if (!isAttachableDocumentPath(body.path)) {
      throw new NotFoundError('Document not found, or the path was refused');
    }
    const ok = await this.container.git.writeFileSafe(
      { owner: repo.owner, name: repo.name },
      body.path,
      body.text,
    );
    if (!ok) throw new NotFoundError('Document not found, or the path was refused');
    return { path: body.path, text: body.text };
  }

  /** Workspace-scoped repo lookup — out-of-workspace resolves as 404, never 403. */
  private async getWorkspaceRepo(workspaceId: string, repoId: string): Promise<RepoRow> {
    const repo = await this.repos.getById(workspaceId, repoId);
    if (!repo) throw new NotFoundError('Repo not found');
    return repo;
  }
}
