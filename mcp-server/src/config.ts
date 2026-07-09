/**
 * MCP-server config. Unlike the old in-`server/` entrypoint, this package has
 * NO database/secrets config — it only needs to know where the DevDigest HTTP
 * API lives and how long the one blocking tool (`run_agent_on_pr`) may wait.
 */
export interface McpConfig {
  /** Base URL of the running DevDigest Fastify API. No trailing slash. */
  apiUrl: string;
  /** Max ms `run_agent_on_pr` blocks before handing back a `running` result. */
  maxWaitMs: number;
  /** Interval between run-status polls (ms). */
  pollIntervalMs: number;
}

const DEFAULT_API_URL = 'http://localhost:3001';

/**
 * `run_agent_on_pr` blocks server-side up to `maxWaitMs`, but the MCP *client*
 * (Claude Code and the SDK) enforces its own per-request timeout — 60_000 ms by
 * default (`DEFAULT_REQUEST_TIMEOUT_MSEC`). If we wait ≥60 s the client aborts
 * the whole call with `-32001 Request timed out` even though the review is
 * still progressing — exactly the "MCP works badly" failure. So the default
 * MUST stay comfortably under 60 s (leaving margin for the two resolve calls +
 * the POST that precede the poll loop); a slower review then returns the
 * `{ run_id, status: 'running' }` handoff and the caller finishes with
 * `get_findings`. Overriding MAX_WAIT_MS to ≥55_000 re-introduces the race.
 */
const DEFAULT_MAX_WAIT_MS = 45000;
const CLIENT_TIMEOUT_CEILING_MS = 55000;
const POLL_INTERVAL_MS = 1000;

export function loadConfig(): McpConfig {
  const rawUrl = process.env.DEVDIGEST_API_URL ?? DEFAULT_API_URL;
  const rawWait = Number(process.env.MAX_WAIT_MS ?? DEFAULT_MAX_WAIT_MS);
  const wait = Number.isFinite(rawWait) && rawWait > 0 ? rawWait : DEFAULT_MAX_WAIT_MS;

  return {
    apiUrl: rawUrl.replace(/\/+$/, ''),
    // Clamp under the MCP client's 60 s request timeout so a long review returns
    // a `running` handoff instead of the client aborting with -32001.
    maxWaitMs: Math.min(wait, CLIENT_TIMEOUT_CEILING_MS),
    pollIntervalMs: POLL_INTERVAL_MS,
  };
}
