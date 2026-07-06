import type { SmartDiff } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { ReviewRepository } from './repository.js';
import { buildFindingsByFile, buildSmartDiff } from './smart-diff.classify.js';

/**
 * Smart Diff (L03) — application service.
 *
 * Compute-on-read composition over already-persisted `pr_files` + the latest
 * review's `findings`: NO LLM call, NO DB write, NO new repo method. Mirrors
 * `IntentService.getIntent` (workspace-scoped 404 via `repo.getPull`). All
 * classification/grouping/split logic lives in the pure `smart-diff.classify`
 * helpers (S1) — this service only adapts Drizzle rows into their inputs.
 * See `docs/plans/smart-diff.md` §5 "Server" + §6 "Runtime flow".
 */
export class SmartDiffService {
  constructor(private repo: ReviewRepository) {}

  /**
   * Compose a PR's Smart Diff. Workspace-scoped (404 when the PR isn't in
   * `workspaceId`). "Latest review" = the newest `reviewsForPull` row with
   * `kind === 'review'`; a PR with zero such rows still returns a valid
   * `SmartDiff` with every `finding_lines` empty.
   */
  async getSmartDiff(workspaceId: string, prId: string): Promise<SmartDiff> {
    const pull = await this.repo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await this.repo.getPrFiles(prId);
    const rows = await this.repo.reviewsForPull(prId);
    const latestReview = rows.find(({ review }) => review.kind === 'review');
    const findings = (latestReview?.findings ?? []).map((finding) => ({
      file: finding.file,
      start_line: finding.startLine,
      end_line: finding.endLine,
    }));

    const findingsByFile = buildFindingsByFile(findings);
    return buildSmartDiff(
      files.map((file) => ({ path: file.path, additions: file.additions, deletions: file.deletions })),
      findingsByFile,
    );
  }
}
