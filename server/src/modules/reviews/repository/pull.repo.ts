import { and, eq, inArray, ne } from 'drizzle-orm';
import type { Db } from '../../../db/client.js';
import * as t from '../../../db/schema.js';
import type { Intent, PrHistoryItem } from '@devdigest/shared';
import type { PullRow } from '../../../db/rows.js';

// ---- PR lookup (workspace-scoped) -----------------------------------------

export async function getPull(
  db: Db,
  workspaceId: string,
  prId: string,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(and(eq(t.pullRequests.workspaceId, workspaceId), eq(t.pullRequests.id, prId)));
  return row;
}

/** PR lookup by (repo, number) — backed by unique index `pr_repo_number_uq`. */
export async function getPullByNumber(
  db: Db,
  workspaceId: string,
  repoId: string,
  number: number,
): Promise<PullRow | undefined> {
  const [row] = await db
    .select()
    .from(t.pullRequests)
    .where(
      and(
        eq(t.pullRequests.workspaceId, workspaceId),
        eq(t.pullRequests.repoId, repoId),
        eq(t.pullRequests.number, number),
      ),
    )
    .limit(1);
  return row;
}

export async function getRepo(
  db: Db,
  repoId: string,
): Promise<typeof t.repos.$inferSelect | undefined> {
  const [row] = await db.select().from(t.repos).where(eq(t.repos.id, repoId));
  return row;
}

export async function getPrFiles(
  db: Db,
  prId: string,
): Promise<(typeof t.prFiles.$inferSelect)[]> {
  return db.select().from(t.prFiles).where(eq(t.prFiles.prId, prId));
}

/**
 * [L04] Cap on prior-PR history rows returned per `priorPrsTouchingFiles`
 * query — mirrors the house fan-out-capping pattern already used for blast
 * callers (`MAX_CALLERS_PER_SYMBOL` / `MAX_CALLERS_TOTAL`,
 * `repo-intel/constants.ts:37,47`): bound a potentially large result (many
 * prior PRs touching the same file) with a generous, UX-sized ceiling rather
 * than returning everything.
 */
const MAX_PRIOR_PRS = 10;

/**
 * Other PRs (same workspace+repo) that previously touched at least one of
 * `changedFiles`, excluding `currentPrId` (self). Ordered by recency
 * (most-recently-active first, PR number as tiebreak), capped at
 * `MAX_PRIOR_PRS`.
 *
 * `merged_at` note: the DB stores no real merge timestamp — GitHub's
 * `pr.merged_at` is consumed only to derive a boolean status and then
 * discarded (see `adapters/github/octokit.ts`), and the seed writes
 * `status: 'needs_review'` directly rather than a reliable merged flag. So
 * `merged_at` below is a **"last activity" proxy** (`updatedAt ?? openedAt`),
 * NOT a real merge time — and for the same reason this function deliberately
 * does NOT filter by `status === 'merged'` (that would return nothing on
 * real/seed data). Every non-self PR with ≥1 overlapping file counts as
 * "prior". `notes` is reserved for future enrichment (not computed today).
 */
export async function priorPrsTouchingFiles(
  db: Db,
  workspaceId: string,
  repoId: string,
  currentPrId: string,
  changedFiles: string[],
): Promise<PrHistoryItem[]> {
  if (changedFiles.length === 0) return [];

  const rows = await db
    .select({
      id: t.pullRequests.id,
      number: t.pullRequests.number,
      title: t.pullRequests.title,
      author: t.pullRequests.author,
      updatedAt: t.pullRequests.updatedAt,
      openedAt: t.pullRequests.openedAt,
      path: t.prFiles.path,
    })
    .from(t.pullRequests)
    .innerJoin(t.prFiles, eq(t.prFiles.prId, t.pullRequests.id))
    .where(
      and(
        eq(t.pullRequests.workspaceId, workspaceId),
        eq(t.pullRequests.repoId, repoId),
        ne(t.pullRequests.id, currentPrId),
        inArray(t.prFiles.path, changedFiles),
      ),
    );

  // A PR can match multiple files — group in JS by PR id (mirrors the
  // `inArray` + `Map` aggregation idiom used for the pulls-list per-PR
  // aggregates, `server/INSIGHTS.md:22`), collecting a distinct set of
  // overlapping file paths per PR.
  type GroupedPr = {
    number: number;
    title: string;
    author: string;
    updatedAt: Date | null;
    openedAt: Date | null;
    files: Set<string>;
  };
  const byPrId = new Map<string, GroupedPr>();
  for (const row of rows) {
    let group = byPrId.get(row.id);
    if (!group) {
      group = {
        number: row.number,
        title: row.title,
        author: row.author,
        updatedAt: row.updatedAt,
        openedAt: row.openedAt,
        files: new Set(),
      };
      byPrId.set(row.id, group);
    }
    group.files.add(row.path);
  }

  return [...byPrId.values()]
    .sort((a, b) => {
      const aTime = (a.updatedAt ?? a.openedAt)?.getTime() ?? 0;
      const bTime = (b.updatedAt ?? b.openedAt)?.getTime() ?? 0;
      if (bTime !== aTime) return bTime - aTime;
      return b.number - a.number;
    })
    .slice(0, MAX_PRIOR_PRS)
    .map(
      (group): PrHistoryItem => ({
        pr_number: group.number,
        title: group.title,
        // Last-activity proxy, not a real merge timestamp — see the doc
        // comment on this function.
        merged_at: (group.updatedAt ?? group.openedAt)?.toISOString() ?? '',
        author: group.author,
        files_overlap: [...group.files].sort(),
        // Reserved for future enrichment (e.g. an LLM-derived relevance note).
        notes: '',
      }),
    );
}

/**
 * Record the commit a review just ran against, so the PR list can derive
 * `reviewed` vs `needs_review` (head moved since the last review) vs `stale`.
 */
export async function markReviewed(db: Db, prId: string, sha: string): Promise<void> {
  await db
    .update(t.pullRequests)
    .set({ lastReviewedSha: sha })
    .where(eq(t.pullRequests.id, prId));
}

// ---- intent ---------------------------------------------------------------

export async function upsertIntent(db: Db, prId: string, intent: Intent): Promise<void> {
  await db
    .insert(t.prIntent)
    .values({
      prId,
      intent: intent.intent,
      inScope: intent.in_scope,
      outOfScope: intent.out_of_scope,
    })
    .onConflictDoUpdate({
      target: t.prIntent.prId,
      set: { intent: intent.intent, inScope: intent.in_scope, outOfScope: intent.out_of_scope },
    });
}

export async function getIntent(db: Db, prId: string): Promise<Intent | undefined> {
  const [row] = await db.select().from(t.prIntent).where(eq(t.prIntent.prId, prId));
  if (!row) return undefined;
  return { intent: row.intent, in_scope: row.inScope, out_of_scope: row.outOfScope };
}
