import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../http/client.js';
import { resolveRepoBySlug, resolvePrId } from '../resolve.js';
import { GetBlastRadiusInput, BlastRadius } from '../schemas.js';
import { errorResult } from './util.js';

/**
 * `get_blast_radius` — read-only. Resolves its inputs (repo slug → PR) so a bad
 * `repo`/`pr` still "leads onward" to an actionable error, then serves the
 * blast radius (changed symbols → callers → impacted endpoints/crons) from the
 * `GET /pulls/:id/blast` route — which maps it server-side via the shared
 * `blastResultToContract`, so behaviour is identical to the old direct path.
 *
 * Reaches the product only through the HTTP `client` — no DB/Container.
 */
export function registerGetBlastRadius(server: McpServer, { client }: ToolDeps): void {
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

      const repoResult = await resolveRepoBySlug(client, repo);
      if (!repoResult.ok) {
        return repoResult.reason === 'bad_slug'
          ? errorResult(`invalid repo slug '${repo}' — expected "owner/name"`)
          : errorResult(`repo '${repo}' not imported — add it in DevDigest first`);
      }

      const prResult = await resolvePrId(client, repoResult.repoId, pr);
      if (!prResult.ok) {
        return errorResult(`PR #${pr} not found in ${repo}`);
      }

      const blastRadius = await client.blast(prResult.prId);

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
