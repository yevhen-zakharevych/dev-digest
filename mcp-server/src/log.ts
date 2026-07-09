/**
 * stderr-only logger.
 *
 * CRITICAL: the stdio transport OWNS stdout — every byte written there must be
 * a JSON-RPC message, or the client-side parser breaks. So diagnostics NEVER
 * use `console.log` (stdout); they go to stderr via `console.error`. This is
 * the same invariant the old `server/src/mcp.ts` entrypoint kept; centralising
 * it here makes "no stdout writes anywhere in this package" a single rule.
 */
export const log = {
  info(message: string): void {
    console.error(message);
  },
  error(message: string, ...rest: unknown[]): void {
    console.error(message, ...rest);
  },
};
