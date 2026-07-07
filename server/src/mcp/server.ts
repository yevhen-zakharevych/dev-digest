import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '../platform/container.js';
import { registerListAgents } from './tools/list-agents.js';
import { registerRunAgentOnPr } from './tools/run-agent-on-pr.js';
import { registerGetFindings } from './tools/get-findings.js';
import { registerGetConventions } from './tools/get-conventions.js';
import { registerGetBlastRadius } from './tools/get-blast-radius.js';

/**
 * Build the DevDigest MCP server and register all 5 tools against it.
 *
 * Transport-agnostic on purpose: the caller (the stdio entrypoint in
 * `mcp.ts`, or a future HTTP transport) decides how to `connect()` this
 * server. Keeping transport wiring out of this file keeps it unit-wireable
 * (construct a `Container` with overrides, call `buildMcpServer`, assert on
 * the registered tools) without ever touching stdio/process streams.
 */
export function buildMcpServer(container: Container): McpServer {
  const server = new McpServer({ name: 'devdigest-mcp', version: '1.0.0' });

  registerListAgents(server, container);
  registerRunAgentOnPr(server, container);
  registerGetFindings(server, container);
  registerGetConventions(server, container);
  registerGetBlastRadius(server, container);

  return server;
}
