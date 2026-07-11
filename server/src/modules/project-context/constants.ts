import type { DocumentBucket } from '@devdigest/shared';

/**
 * Root folder names discovery treats as a "project context" bucket, matched
 * at ANY depth in a `.md` file's path (AC-1). Kept here — and passed into
 * `ContextService` via constructor injection rather than hard-coded inline at
 * the call site — so a test can override the set and observe discovery
 * change (AC-3).
 */
export const DEFAULT_BUCKET_DIRS: readonly DocumentBucket[] = ['specs', 'docs', 'insights'];

/**
 * Per-route rate limit for the two filesystem-touching routes (discovery walk
 * + document save) — at least as tight as the 120/min global default.
 * Mirrors the existing `POST /pulls/:id/review` precedent
 * (`modules/reviews/routes.ts:33`).
 */
export const CONTEXT_ROUTE_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;
