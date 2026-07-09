import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { buildMcpServer } from './server.js';
import { loadConfig } from './config.js';
import { HttpClient } from './http/client.js';
import { log } from './log.js';

/**
 * MCP stdio entrypoint. `pnpm start` runs `tsx src/index.ts`.
 *
 * Requires the DevDigest API to be running (start it with `./scripts/dev.sh`
 * from the repo root) — every tool reaches the product over HTTP.
 *
 * CRITICAL: the stdio transport OWNS stdout — every byte written there must be
 * a JSON-RPC message, or the client-side parser breaks. Nothing in this path
 * writes to stdout; all diagnostics go to stderr via `log` (see `log.ts`).
 * Unlike the old `server/src/mcp.ts`, there is NO db/Container to construct
 * here — just config + the HTTP client.
 */
async function main() {
  const config = loadConfig();
  const client = new HttpClient(config);
  const server = buildMcpServer({ client, config });

  // Graceful shutdown: close the MCP server once, guarded against a double
  // signal during shutdown. No db pool to close in this HTTP-client package.
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      if (closing) return;
      closing = true;
      log.error(`${signal} received — shutting down MCP server`);
      try {
        await server.close();
        process.exit(0);
      } catch (err) {
        log.error('error during MCP server shutdown', err);
        process.exit(1);
      }
    });
  }

  await server.connect(new StdioServerTransport());
  log.info(`DevDigest MCP server started (stdio) → ${config.apiUrl}`);
}

main().catch((err) => {
  log.error('fatal error starting MCP server', err);
  process.exit(1);
});
