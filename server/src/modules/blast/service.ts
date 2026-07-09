import type { BlastRadius } from '@devdigest/shared';
import { NotFoundError } from '../../platform/errors.js';
import type { Container } from '../../platform/container.js';
import { blastResultToContract } from './contract.js';

/**
 * Blast Radius (L04) — application service.
 *
 * Thin: the facade (`container.repoIntel.getBlastRadius`, `repo-intel/service.ts:220`)
 * already owns all DB access for the actual blast computation; this service
 * only resolves the PR → its repo + changed files (workspace-scoped, mirrors
 * `SmartDiffService.getSmartDiff`) via `container.reviewRepo` and maps the
 * result via the shared `blastResultToContract` (also used by the MCP
 * `get_blast_radius` tool, so HTTP and MCP behavior stay identical —
 * docs/plans/L04-blast-radius.md D4).
 */
export class BlastService {
  constructor(private container: Container) {}

  /**
   * Compose a PR's Blast Radius. Workspace-scoped (404 when the PR isn't in
   * `workspaceId` — this also gives cross-workspace 404 for free, per
   * `server/INSIGHTS.md:52`).
   */
  async getBlastRadius(workspaceId: string, prId: string): Promise<BlastRadius> {
    const { reviewRepo, repoIntel } = this.container;
    const pull = await reviewRepo.getPull(workspaceId, prId);
    if (!pull) throw new NotFoundError('Pull request not found');

    const files = await reviewRepo.getPrFiles(prId);
    const changedFiles = files.map((f) => f.path);

    const [result, prior_prs] = await Promise.all([
      repoIntel.getBlastRadius(pull.repoId, changedFiles),
      reviewRepo.priorPrsTouchingFiles(workspaceId, pull.repoId, prId, changedFiles),
    ]);
    return { ...blastResultToContract(result), prior_prs };
  }
}
