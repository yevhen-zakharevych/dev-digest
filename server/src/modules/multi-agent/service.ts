import type { Container } from '../../platform/container.js';
import type { AgentColumn, CreateMultiRunResponse, MultiAgentRun } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import { ReviewService } from '../reviews/service.js';
// The logger shape comes from the PLATFORM, not from another module's executor:
// `platform/run-logger.ts` already exports `PinoLike`, which is byte-identical to
// `reviews/run-executor.ts`'s own `Logger`. Importing the latter would be this
// server's only cross-module reach into a reviews internal (`modules/eval`
// declares its own instead of reaching), and would make a refactor of that
// executor break an unrelated module's typecheck.
import type { PinoLike } from '../../platform/run-logger.js';
import { MultiAgentRepository } from './repository.js';
import { buildConflicts } from './grouping.js';

/**
 * Multi-Agent Review service.
 *
 * Creating a multi-run persists the `multi_agent_runs` grouping row and then
 * launches the chosen agents through the **unchanged** review fan-out — the
 * per-agent isolation, SSE, trace and cost accounting are inherited, not
 * re-implemented (spec Assumptions). Reading composes persisted rows plus the
 * deterministic grouping; it issues **zero** model calls.
 *
 * `container.reviewService` deliberately does not exist: this module constructs
 * `new ReviewService(container)` exactly as `modules/reviews/routes.ts` does,
 * rather than widening the composition root for one consumer.
 */
export class MultiAgentService {
  private repo: MultiAgentRepository;
  private reviews: ReviewService;

  constructor(private container: Container) {
    this.repo = new MultiAgentRepository(container.db);
    this.reviews = new ReviewService(container);
  }

  /**
   * Create a multi-run for `prId` with exactly `agentIds`, and launch them.
   *
   * Order is load-bearing: the PR and every agent id are resolved (both
   * workspace-scoped, both 404 on a miss) **before** the grouping row is
   * inserted, so a rejected request never leaves an empty multi-run behind that
   * the results page would then render as a zero-column run.
   */
  async createMultiRun(
    workspaceId: string,
    prId: string,
    agentIds: string[],
    logger?: PinoLike,
  ): Promise<CreateMultiRunResponse> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const targets = await this.reviews.resolveTargets(workspaceId, { agentIds });
    const multiRun = await this.repo.createMultiRun(workspaceId, prId);
    const { runs } = await this.reviews.runReview(workspaceId, prId, targets, {
      ...(logger ? { logger } : {}),
      multiAgentRunId: multiRun.id,
    });

    return { multi_run_id: multiRun.id, pr_id: prId, runs };
  }

  /**
   * The latest multi-run for a PR as the results read model, or `null` when the
   * PR has never had one (AC-14's null case — a 200, not a 404; a 404 here is
   * reserved for a PR outside the caller's workspace).
   */
  async latestForPr(workspaceId: string, prId: string): Promise<MultiAgentRun | null> {
    const pull = await this.container.reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const row = await this.repo.latestMultiRun(workspaceId, prId);
    if (!row) return null;

    const columns = await this.repo.columnsForMultiRun(workspaceId, row.id);
    return {
      id: row.id,
      pr_id: row.prId,
      pr_number: pull.number,
      ran_at: row.ranAt.toISOString(),
      agent_count: columns.length,
      total_duration_ms: totalDurationMs(columns),
      total_cost_usd: totalCostUsd(columns),
      columns,
      conflicts: buildConflicts(columns),
    };
  }
}

/**
 * SUM of the columns' durations, because the fan-out is SEQUENTIAL:
 * `modules/reviews/run-executor.ts:129` is a plain `for (…) await runOneAgent(…)`,
 * so agent N+1 does not start until agent N finishes and elapsed time really is
 * the sum. (`p-queue` is a dependency of this repo but is wired only into
 * `platform/jobs.ts` and `repo-intel/pipeline/full.ts` — never into the review
 * fan-out.) Take the MAX here only once that loop runs jobs concurrently.
 * The contract types this as a non-nullable int, so a fresh multi-run with no
 * finished column reports `0` rather than null.
 */
function totalDurationMs(columns: AgentColumn[]): number {
  let sum = 0;
  for (const c of columns) if (c.duration_ms !== null) sum += c.duration_ms;
  return sum;
}

/**
 * SUM across columns — every agent's spend is real money, so cost adds up even
 * though time does not. `null` (never `0`) when no column captured a cost, so the
 * UI can distinguish "free" from "not measured".
 */
function totalCostUsd(columns: AgentColumn[]): number | null {
  let sum: number | null = null;
  for (const c of columns) if (c.cost_usd !== null) sum = (sum ?? 0) + c.cost_usd;
  return sum;
}
