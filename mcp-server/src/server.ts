import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolDeps } from './http/client.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';

/**
 * Build the DevDigest MCP server and register all 5 tools against it.
 *
 * Transport-agnostic on purpose: the caller (`index.ts`, or a test) decides how
 * to `connect()` this server. Keeping transport wiring out of this file keeps
 * it unit-wireable — construct `ToolDeps` with a mock `HttpClient`, call
 * `buildMcpServer`, assert on the registered tools — without touching stdio.
 */
export function buildMcpServer(deps: ToolDeps): McpServer {
  const server = new McpServer({ name: 'devdigest-mcp', version: '1.0.0' });

  registerListAgents(server, deps);
  registerRunAgentOnPr(server, deps);
  registerGetFindings(server, deps);
  registerGetConventions(server, deps);
  registerGetBlastRadius(server, deps);

  return server;
}
