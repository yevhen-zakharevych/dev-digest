import type { Container } from '../platform/container.js';
import { RepoRepository, type RepoRow } from '../modules/repos/repository.js';
import type { PullRow } from '../modules/reviews/repository.js';

/**
 * MCP input-resolution layer. Turns human-friendly flat tool args
 * ("owner/name" slugs, PR numbers) into internal workspace/repo/PR ids.
 *
 * Per the "error leads onward" tool-design principle: expected not-found
 * cases (bad slug, unknown repo, unknown PR) are returned as typed
 * discriminated-union results, NEVER thrown — so tool handlers can branch
 * cleanly and emit `isError:true` with an actionable message. Only truly
 * unexpected failures (DB down, etc.) should propagate as exceptions.
 *
 * No LLM calls, no DB writes, no direct SQL — every read goes through the
 * existing repositories exposed on `Container`.
 */

/** Discriminated-union reason a resolver could not find what was asked for. */
export type NotFoundReason = 'bad_slug' | 'not_found';

export interface ResolveNotFound {
  ok: false;
  reason: NotFoundReason;
}

export type ResolveResult<T> = { ok: true } & T | ResolveNotFound;

export type RepoResolveResult = ResolveResult<{ repo: RepoRow }>;
export type PrResolveResult = ResolveResult<{ pull: PullRow }>;

/** Matches "owner/name" — exactly one `/`, both parts non-empty. */
const REPO_SLUG_RE = /^[^/\s]+\/[^/\s]+$/;

/** Resolve the (single, seeded) workspace id for this local-auth deployment. */
export async function resolveWorkspaceId(container: Container): Promise<string> {
  const workspace = await container.auth.currentWorkspace(undefined);
  return workspace.id;
}

/**
 * Resolve a `"owner/name"` slug to its repo row within a workspace.
 * Returns a typed not-found result (never throws) for a malformed slug or
 * an unimported repo.
 */
export async function resolveRepoBySlug(
  container: Container,
  workspaceId: string,
  slug: string,
): Promise<RepoResolveResult> {
  if (!REPO_SLUG_RE.test(slug)) {
    return { ok: false, reason: 'bad_slug' };
  }

  const repo = await new RepoRepository(container.db).findByFullName(workspaceId, slug);
  if (!repo) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true, repo };
}

/**
 * Resolve a PR by its human-facing GitHub number within a repo.
 * Returns a typed not-found result (never throws) when no such PR exists.
 */
export async function resolvePrId(
  container: Container,
  workspaceId: string,
  repoId: string,
  number: number,
): Promise<PrResolveResult> {
  const pull = await container.reviewRepo.getPullByNumber(workspaceId, repoId, number);
  if (!pull) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true, pull };
}
