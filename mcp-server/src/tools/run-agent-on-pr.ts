import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiError, type HttpClient, type ToolDeps } from '../http/client.js';
import { resolveRepoBySlug, resolvePrId } from '../resolve.js';
import { toConciseFinding } from '../mappers.js';
import { RunAgentOnPrInput, RunResult } from '../schemas.js';
import { errorResult, delay } from './util.js';

/** Canonical UUID shape — an `agent` arg matching this is treated as an id. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type AgentIdResult = { ok: true; id: string } | { ok: false; message: string };

/**
 * Resolve the `agent` arg to an id. A UUID is used as-is; anything else is
 * treated as a human name and matched (case-insensitively) against
 * `list_agents`, so callers can pass "Security Reviewer" directly instead of
 * having to look its id up first.
 */
async function resolveAgentId(client: HttpClient, agent: string): Promise<AgentIdResult> {
  if (UUID_RE.test(agent)) return { ok: true, id: agent };

  const agents = await client.listAgents();
  const wanted = agent.trim().toLowerCase();
  const match = agents.find((a) => a.name.toLowerCase() === wanted);
  if (match) return { ok: true, id: match.id };

  const available = agents.map((a) => `"${a.name}"`).join(', ');
  return {
    ok: false,
    message: `agent "${agent}" not found — available agents: ${available || '(none)'}. Pass an exact agent name or an id from list_agents.`,
  };
}

/**
 * `run_agent_on_pr` — the only mutating tool. Result-not-operation: kicks off
 * the run via `POST /pulls/:id/review`, bounded-polls `GET /pulls/:id/runs` to
 * a terminal status, then returns the verdict + findings — or, if `maxWaitMs`
 * elapses first, a `{ run_id, status: 'running' }` handoff pointing at
 * `get_findings`.
 *
 * `outputSchema` is deliberately OMITTED: the result is a union
 * (`RunResultDone | RunResultRunning`) and the SDK's `outputSchema` slot only
 * accepts a raw `ZodRawShape`, which cannot express a union. The handler
 * validates its own `structuredContent` via `RunResult.parse(...)` instead, so
 * the shape is still guaranteed.
 *
 * Reaches the product only through the HTTP `client` — no DB/Container.
 */
export function registerRunAgentOnPr(server: McpServer, { client, config }: ToolDeps): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run agent on PR',
      description:
        'Run one review agent on a pull request end-to-end: creates the run, waits for it to finish, and returns the verdict plus findings. This is the only tool that writes. The `agent` arg accepts an agent id OR an exact agent name (e.g. "Security Reviewer") — you do NOT need to call list_agents first. If the review is still running after the server timeout, returns { run_id, status:"running" } — then call get_findings with that run_id. If the agent name/id is unknown, the error lists the available agents.',
      inputSchema: RunAgentOnPrInput.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async (rawArgs) => {
      const parsed = RunAgentOnPrInput.safeParse(rawArgs);
      if (!parsed.success) {
        return errorResult(`invalid input: ${parsed.error.message}`);
      }
      const { repo, pr, agent } = parsed.data;

      const repoResult = await resolveRepoBySlug(client, repo);
      if (!repoResult.ok) {
        return repoResult.reason === 'bad_slug'
          ? errorResult(`repo "${repo}" must be in "owner/name" form`)
          : errorResult(`repo "${repo}" not imported — add it in DevDigest first`);
      }

      const prResult = await resolvePrId(client, repoResult.repoId, pr);
      if (!prResult.ok) {
        return errorResult(`PR #${pr} not found in ${repo}`);
      }

      // `agent` may be an id OR a human name ("Security Reviewer") — resolve a
      // name to its id via list_agents so callers don't have to look it up first.
      const agentResult = await resolveAgentId(client, agent);
      if (!agentResult.ok) {
        return errorResult(agentResult.message);
      }
      const agentId = agentResult.id;

      let runId: string;
      try {
        const { runs } = await client.runReview(prResult.prId, agentId);
        // One agentId ⇒ one target ⇒ one run.
        const run = runs[0];
        if (!run) {
          return errorResult(`agent "${agent}" not found — call list_agents for valid ids`);
        }
        runId = run.run_id;
      } catch (err) {
        // An unknown agent id makes the server's resolveTargets throw
        // NotFoundError → 404. Anything else is a real failure — let it bubble.
        if (err instanceof ApiError && err.status === 404) {
          return errorResult(`agent "${agent}" not found — call list_agents for valid ids`);
        }
        throw err;
      }

      const deadline = Date.now() + config.maxWaitMs;
      while (Date.now() < deadline) {
        await delay(config.pollIntervalMs);
        const runs = await client.listRuns(prResult.prId);
        const run = runs.find((r) => r.run_id === runId);
        if (!run || run.status === 'running') continue;

        if (run.status === 'done') {
          const review = await client.reviewByRun(runId);
          const findings = review.findings.map(toConciseFinding);
          const structuredContent = RunResult.parse({
            run_id: runId,
            verdict: review.verdict,
            findings,
          });
          const text = `Verdict: ${review.verdict ?? 'none'} — ${findings.length} finding(s). run_id: ${runId} (use get_findings with it to re-fetch this exact run).`;
          return { content: [{ type: 'text' as const, text }], structuredContent };
        }

        // failed | cancelled
        return errorResult(
          `review ${run.status}: ${run.error ?? 'unknown error'} — inspect the run in DevDigest`,
        );
      }

      const message = `review still running after ${config.maxWaitMs}ms — call get_findings with run_id "${runId}"`;
      const structuredContent = RunResult.parse({
        run_id: runId,
        status: 'running' as const,
        message,
      });
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent,
      };
    },
  );
}
