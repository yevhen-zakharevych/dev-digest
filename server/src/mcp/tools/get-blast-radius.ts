import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '../../platform/container.js';
import { resolveWorkspaceId, resolveRepoBySlug, resolvePrId } from '../resolve.js';
import { emptyBlastRadius } from '../mappers.js';
import { GetBlastRadiusInput, BlastRadius } from '../schemas.js';

/**
 * `get_blast_radius` — read-only, **deliberate stub** (see
 * docs/plans/L04-devdigest-mcp.md §5 tool #5, §5.1). Resolves its inputs
 * (repo slug → PR) so a bad `repo`/`pr` still "leads onward" to an
 * actionable error, but always returns an EMPTY, contract-valid
 * `BlastRadius` — the real implementation is L04 homework (see the
 * `TODO(L04-homework)` block below).
 *
 * Onion: the executed path only calls `resolveWorkspaceId` /
 * `resolveRepoBySlug` / `resolvePrId` (resolvers) plus the pure
 * `emptyBlastRadius` mapper — no direct DB/LLM access.
 */
export function registerGetBlastRadius(server: McpServer, container: Container): void {
  server.registerTool(
    'get_blast_radius',
    {
      title: 'Get blast radius',
      description:
        "Return the blast radius (impact map) of a pull request: which symbols changed and what downstream code they affect. Read-only. NOTE: this is currently a stub and returns an EMPTY blast radius — the full implementation is L04 homework. Does NOT modify anything.",
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

      // ---------------------------------------------------------------------
      // TODO(L04-homework): swap the stub body above this line for the real
      // implementation — this is a localized, one-block swap:
      //
      //   const changedFiles = (await container.reviewRepo.getPrFiles(prResult.pull.id))
      //     .map((f) => f.path); // adjust field name to the actual PrFile row shape
      //   const result = await container.repoIntel.getBlastRadius(
      //     repoResult.repo.id,
      //     changedFiles,
      //   ); // `repo-intel/service.ts:220`, returns `BlastResult`
      //   const blastRadius = blastResultToContract(result); // `mappers.ts`
      //
      // then return `structuredContent: blastRadius` (plus a text summary)
      // instead of the `emptyBlastRadius(...)` stub below.
      // ---------------------------------------------------------------------

      const blastRadius = emptyBlastRadius('blast radius not yet implemented (L04 homework)');

      return {
        content: [
          {
            type: 'text' as const,
            text: 'get_blast_radius is currently a stub (L04 homework) — returning an empty blast radius. No symbols or downstream impact were analyzed.',
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
