import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '../../platform/container.js';
import { ConventionsService } from '../../modules/conventions/service.js';
import { resolveWorkspaceId, resolveRepoBySlug } from '../resolve.js';
import { GetConventionsInput, ConventionCandidate } from '../schemas.js';

/**
 * `get_conventions` — read-only, keyed by repository (not by a PR). Mirrors
 * the `registerTool` pattern established in `list-agents.ts`: `.shape` for
 * both `inputSchema`/`outputSchema`, `{ content, structuredContent }` success
 * envelope, `isError:true` (same envelope) for the "error leads onward" path.
 *
 * Onion: the handler only calls `resolveWorkspaceId`/`resolveRepoBySlug` and
 * `ConventionsService` — no direct DB/LLM access.
 */
export function registerGetConventions(server: McpServer, container: Container): void {
  server.registerTool(
    'get_conventions',
    {
      title: 'Get conventions',
      description:
        "Return the repository's accepted house conventions (the repo-conventions extracted in Lesson 2). Read-only, keyed by repository — not by a PR. Does NOT extract or modify conventions. If the repo isn't imported, returns an error telling you to add it in DevDigest.",
      inputSchema: GetConventionsInput.shape,
      outputSchema: { conventions: z.array(ConventionCandidate) },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = GetConventionsInput.safeParse(args);
      if (!parsed.success) {
        return errorResult(parsed.error.message);
      }

      const workspaceId = await resolveWorkspaceId(container);
      const repoResult = await resolveRepoBySlug(container, workspaceId, parsed.data.repo);
      if (!repoResult.ok) {
        if (repoResult.reason === 'bad_slug') {
          return errorResult(`repo "${parsed.data.repo}" must be in "owner/name" form`);
        }
        return errorResult(`repo "${parsed.data.repo}" not imported — add it in DevDigest first`);
      }

      const conventions = await new ConventionsService(container).listForRepo(
        workspaceId,
        repoResult.repo.id,
        ['accepted'],
      );

      const text =
        conventions.length === 0
          ? 'no accepted conventions yet'
          : conventions
              .map((c) => `${c.rule} (confidence ${c.confidence})`)
              .join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { conventions },
      };
    },
  );
}

/** "Error leads onward" helper — same shape as `list-agents.ts`'s `errorResult`. */
function errorResult(text: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text }], isError: true as const };
}
