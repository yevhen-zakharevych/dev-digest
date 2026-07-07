import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '../../platform/container.js';
import { AgentsService } from '../../modules/agents/service.js';
import { resolveWorkspaceId } from '../resolve.js';
import { ListAgentsInput, Agent } from '../schemas.js';

/**
 * `list_agents` — the first (canonical) MCP tool. Establishes the
 * `registerTool` pattern the other 4 tools mirror:
 *
 * - `inputSchema`/`outputSchema` are passed as a **ZodRawShape** (a plain
 *   object of Zod schemas), NOT a constructed `ZodObject`. The installed SDK
 *   (`@modelcontextprotocol/sdk@1.29.0`, see
 *   `server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.d.ts`)
 *   types `registerTool`'s `config.inputSchema`/`config.outputSchema` as
 *   `ZodRawShapeCompat = Record<string, AnySchema>` (`zod-compat.d.ts`), and
 *   internally normalizes it back into an object schema
 *   (`objectFromShape`/`normalizeObjectSchema`). So we pass `.shape` off our
 *   `.strict()` object schemas here — for `ListAgentsInput` that's `{}` (an
 *   empty shape, since the tool takes no input).
 * - The handler's success return must match the SDK's `CallToolResult`
 *   shape (`types.d.ts` `CallToolResultSchema`): `content` is an array of
 *   content blocks (we use `{ type: 'text', text }`), and
 *   `structuredContent` is a free-form `Record<string, unknown>` validated
 *   at runtime against `outputSchema`.
 *
 * Onion: the handler only calls `resolveWorkspaceId` + `AgentsService` — no
 * direct DB/LLM access.
 */
export function registerListAgents(server: McpServer, container: Container): void {
  server.registerTool(
    'list_agents',
    {
      title: 'List agents',
      description:
        'List the review agents configured in DevDigest — their id, name and enabled state. Read-only. Call this first to get a valid `agent` id for run_agent_on_pr. Does NOT run a review or change anything.',
      // Empty shape: this tool takes no input.
      inputSchema: ListAgentsInput.shape,
      outputSchema: { agents: z.array(Agent) },
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => {
      const workspaceId = await resolveWorkspaceId(container);
      const agents = await new AgentsService(container).list(workspaceId);

      const text = agents
        .map((a) => `${a.id} — ${a.name} (${a.enabled ? 'enabled' : 'disabled'})`)
        .join('\n');

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent: { agents },
      };
    },
  );
}

/**
 * Local "error leads onward" helper, established here as the pattern the
 * sibling tools (`run_agent_on_pr`, `get_findings`, `get_conventions`,
 * `get_blast_radius`) copy verbatim. `list_agents` itself has no failure
 * branch (it never fails to resolve a workspace in this single-tenant local
 * deployment), so this is unused here but defined to make the shape visible.
 */
function errorResult(text: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text }], isError: true as const };
}
