import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '../../platform/container.js';
import { resolveWorkspaceId, resolveRepoBySlug, resolvePrId } from '../resolve.js';
import { blastResultToContract } from '../mappers.js';
import { GetBlastRadiusInput, BlastRadius } from '../schemas.js';

/**
 * `get_blast_radius` — read-only. Resolves its inputs (repo slug → PR) so a
 * bad `repo`/`pr` still "leads onward" to an actionable error, then serves
 * the real blast radius (changed symbols → callers → impacted endpoints/
 * crons) from the repo-intel index via the shared `blastResultToContract`
 * mapper (docs/plans/L04-blast-radius.md D4) — the same path the HTTP
 * `GET /pulls/:id/blast` route uses, so behavior is identical.
 *
 * Onion: the executed path calls `resolveWorkspaceId` / `resolveRepoBySlug` /
 * `resolvePrId` (resolvers), `container.reviewRepo.getPrFiles` +
 * `container.repoIntel.getBlastRadius` (application-layer facades), then the
 * pure `blastResultToContract` mapper — no direct DB/LLM access from this
 * transport file itself.
 */
export function registerGetBlastRadius(server: McpServer, container: Container): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get blast radius',
      description:
        'Return the blast radius (impact map) of a pull request: which symbols changed and what downstream code they affect (callers, ranked, capped 20 per symbol) plus impacted HTTP endpoints/cron jobs. Read-only. Does NOT modify anything.',
      inputSchema: GetBlastRadiusInput.shape,
      outputSchema: BlastRadius.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = GetBlastRadiusInput.safeParse(args);
      if (!parsed.success) {
        return errorResult(`invalid input: ${parsed.error.message}`);
      }
      const { repo, pr } = parsed.data;

      const workspaceId = await resolveWorkspaceId(container);

      const repoResult = await resolveRepoBySlug(container, workspaceId, repo);
      if (!repoResult.ok) {
        return repoResult.reason === 'bad_slug'
          ? errorResult(`invalid repo slug '${repo}' — expected "owner/name"`)
          : errorResult(`repo '${repo}' not imported — add it in DevDigest first`);
      }

      const prResult = await resolvePrId(container, workspaceId, repoResult.repo.id, pr);
      if (!prResult.ok) {
        return errorResult(`PR #${pr} not found in ${repo}`);
      }

      const changedFiles = (await container.reviewRepo.getPrFiles(prResult.pull.id)).map(
        (f) => f.path,
      );
      const result = await container.repoIntel.getBlastRadius(repoResult.repo.id, changedFiles);
      const blastRadius = blastResultToContract(result);

      return {
        content: [
          {
            type: 'text' as const,
            text: blastRadius.summary,
          },
        ],
        structuredContent: blastRadius,
      };
    },
  );
}

/** "Error leads onward" helper — mirrors `list-agents.ts`. */
function errorResult(text: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text }], isError: true as const };
}
