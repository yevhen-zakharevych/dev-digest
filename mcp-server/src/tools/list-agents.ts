import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from '../http/client.js';
import { ListAgentsInput, Agent } from '../schemas.js';

/**
 * `list_agents` — the canonical MCP tool. Establishes the `registerTool`
 * pattern the other 4 tools mirror:
 *
 * - `inputSchema`/`outputSchema` are passed as a **ZodRawShape** (a plain
 *   object of Zod schemas), NOT a constructed `ZodObject`. The SDK
 *   (`@modelcontextprotocol/sdk@1.29.0`) internally normalizes the shape into
 *   an object schema. So we pass `.shape` off our `.strict()` object schemas —
 *   for `ListAgentsInput` that's `{}` (empty shape, no input).
 * - The handler's success return matches the SDK's `CallToolResult`: `content`
 *   is an array of content blocks (`{ type:'text', text }`), and
 *   `structuredContent` is validated at runtime against `outputSchema`.
 *
 * Reaches the product only through the HTTP `client` — no DB/Container.
 */
export function registerListAgents(server: McpServer, { client }: ToolDeps): void {
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
      const agents = await client.listAgents();

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
