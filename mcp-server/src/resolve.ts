/**
 * MCP input-resolution layer. Turns human-friendly flat tool args
 * ("owner/name" slugs, PR numbers) into internal repo/PR ids via the HTTP
 * resolve endpoints.
 *
 * Per the "error leads onward" tool-design principle: expected not-found cases
 * (bad slug, unknown repo, unknown PR) are returned as typed discriminated
 * unions, NEVER thrown — so tool handlers can branch cleanly and emit
 * `isError:true` with an actionable message. Only truly unexpected failures
 * (API down, 500) propagate as exceptions.
 *
 * `bad_slug` is decided LOCALLY by regex (no round-trip); `not_found` is a 404
 * from the resolve endpoint.
 */
import { ApiError, type HttpClient } from './http/client.js';

/** Discriminated-union reason a resolver could not find what was asked for. */
export type NotFoundReason = 'bad_slug' | 'not_found';

export interface ResolveNotFound {
  ok: false;
  reason: NotFoundReason;
}

export type ResolveResult<T> = ({ ok: true } & T) | ResolveNotFound;

export type RepoResolveResult = ResolveResult<{ repoId: string }>;
export type PrResolveResult = ResolveResult<{ prId: string }>;

/** Matches "owner/name" — exactly one `/`, both parts non-empty. */
const REPO_SLUG_RE = /^[^/\s]+\/[^/\s]+$/;

/**
 * Resolve a `"owner/name"` slug to its internal repo id. Returns a typed
 * not-found result (never throws) for a malformed slug or an unimported repo.
 */
export async function resolveRepoBySlug(
  client: HttpClient,
  slug: string,
): Promise<RepoResolveResult> {
  if (!REPO_SLUG_RE.test(slug)) {
    return { ok: false, reason: 'bad_slug' };
  }
  try {
    const { id } = await client.resolveRepo(slug);
    return { ok: true, repoId: id };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { ok: false, reason: 'not_found' };
    }
    throw err;
  }
}

/**
 * Resolve a PR by its human-facing GitHub number within a repo. Returns a typed
 * not-found result (never throws) when no such PR exists.
 */
export async function resolvePrId(
  client: HttpClient,
  repoId: string,
  number: number,
): Promise<PrResolveResult> {
  try {
    const { id } = await client.resolvePr(repoId, number);
    return { ok: true, prId: id };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) {
      return { ok: false, reason: 'not_found' };
    }
    throw err;
  }
}
