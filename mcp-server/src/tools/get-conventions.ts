import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../http/client.js';
import { resolveRepoBySlug } from '../resolve.js';
import { GetConventionsInput, ConventionCandidate } from '../schemas.js';
import { errorResult } from './util.js';

/**
 * `get_conventions` — read-only, keyed by repository (not by a PR). Mirrors the
 * `registerTool` pattern from `list-agents.ts`: `.shape` for input/output, the
 * `{ content, structuredContent }` success envelope, `isError:true` for the
 * "error leads onward" path.
 *
 * Reaches the product only through the HTTP `client` — no DB/Container.
 */
export function registerGetConventions(server: McpServer, { client }: ToolDeps): void {
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

      const repoResult = await resolveRepoBySlug(client, parsed.data.repo);
      if (!repoResult.ok) {
        if (repoResult.reason === 'bad_slug') {
          return errorResult(`repo "${parsed.data.repo}" must be in "owner/name" form`);
        }
        return errorResult(`repo "${parsed.data.repo}" not imported — add it in DevDigest first`);
      }

      const conventions = await client.conventions(repoResult.repoId);

      const text =
        conventions.length === 0
          ? 'no accepted conventions yet'
          : conventions.map((c) => `${c.rule} (confidence ${c.confidence})`).join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { conventions },
      };
    },
  );
}
