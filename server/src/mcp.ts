import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './mcp/server.js';
import { loadConfig } from './platform/config.js';
import { createDb } from './db/client.js';
import { Container } from './platform/container.js';

/**
 * MCP stdio entrypoint. `pnpm mcp` runs `tsx src/mcp.ts`.
 *
 * CRITICAL: the stdio transport OWNS stdout — every byte written there must
 * be a JSON-RPC message, or the client-side parser breaks. Never
 * `console.log` (or otherwise write to stdout) anywhere in this path;
 * startup diagnostics go to stderr via `console.error` instead. Pino
 * (used elsewhere in this codebase, e.g. Fastify's `app.log`) defaults to
 * stdout — we deliberately don't construct a Fastify app or its logger
 * here, so nothing in this path emits pino to stdout. If a future change
 * pulls in a service that logs via pino, route it to stderr explicitly.
 */
async function main() {
  const config = loadConfig();
  const { db, close: closeDb } = createDb(config.databaseUrl);
  const container = new Container(config, db);
  const server = buildMcpServer(container);

  // Graceful shutdown: mirrors `server.ts`'s SIGTERM/SIGINT handling — close
  // the MCP server (and the db pool) once, guarded against a double signal
  // during shutdown.
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      if (closing) return;
      closing = true;
      console.error(`${signal} received — shutting down MCP server`);
      try {
        await server.close();
        await closeDb();
        process.exit(0);
      } catch (err) {
        console.error('error during MCP server shutdown', err);
        process.exit(1);
      }
    });
  }

  await server.connect(new StdioServerTransport());
  console.error('DevDigest MCP server started (stdio)');
}

main().catch((err) => {
  console.error('fatal error starting MCP server', err);
  process.exit(1);
});
