import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Container } from '../../platform/container.js';
import { ReviewService } from '../../modules/reviews/service.js';
import { NotFoundError } from '../../platform/errors.js';
import { resolveWorkspaceId, resolveRepoBySlug, resolvePrId } from '../resolve.js';
import { toConciseFinding } from '../mappers.js';
import { RunAgentOnPrInput, RunResult } from '../schemas.js';

/** Poll interval for the bounded wait below (ms). */
const POLL_INTERVAL_MS = 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * `run_agent_on_pr` — the only mutating tool (§5.1). Result-not-operation:
 * creates the run, bounded-polls it to a terminal status, and returns the
 * verdict + findings — or, if the server timeout elapses first, a
 * `{ run_id, status: 'running' }` handoff pointing at `get_findings`.
 *
 * `outputSchema` is deliberately OMITTED: the result is a union
 * (`RunResultDone | RunResultRunning`, `schemas.ts:152`) and the SDK's
 * `registerTool` `outputSchema` slot only accepts a raw `ZodRawShape`
 * (`server/INSIGHTS.md:36`), which cannot express a union. Instead the
 * handler validates its own `structuredContent` at runtime via
 * `RunResult.parse(...)` before returning, so the shape is still guaranteed
 * even without a declared schema for the SDK to check against.
 *
 * Onion: only `ReviewService` + `container.reviewRepo` + the `resolve.ts`
 * resolvers are touched here — no direct DB/LLM access.
 */
export function registerRunAgentOnPr(server: McpServer, container: Container): void {
  server.registerTool(
    'run_agent_on_pr',
    {
      title: 'Run agent on PR',
      description:
        'Run one review agent on a pull request end-to-end: creates the run, waits for it to finish, and returns the verdict plus findings. This is the only tool that writes. If the review is still running after the server timeout, returns { run_id, status:"running" } — then call get_findings with that run_id. If the agent id is unknown, returns an error telling you to call list_agents.',
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

      const workspaceId = await resolveWorkspaceId(container);

      const repoResult = await resolveRepoBySlug(container, workspaceId, repo);
      if (!repoResult.ok) {
        return repoResult.reason === 'bad_slug'
          ? errorResult(`repo "${repo}" must be in "owner/name" form`)
          : errorResult(`repo "${repo}" not imported — add it in DevDigest first`);
      }

      const prResult = await resolvePrId(container, workspaceId, repoResult.repo.id, pr);
      if (!prResult.ok) {
        return errorResult(`PR #${pr} not found in ${repo}`);
      }

      const reviewService = new ReviewService(container);

      let runId: string;
      try {
        const targets = await reviewService.resolveTargets(workspaceId, { agentId: agent });
        const { runs } = await reviewService.runReview(workspaceId, prResult.pull.id, targets);
        // One agentId ⇒ one target ⇒ one run.
        const run = runs[0];
        if (!run) throw new NotFoundError('Agent not found');
        runId = run.run_id;
      } catch (err) {
        if (err instanceof NotFoundError) {
          return errorResult(`agent "${agent}" not found — call list_agents for valid ids`);
        }
        throw err;
      }

      const deadline = Date.now() + container.config.mcpRunTimeoutMs;
      while (Date.now() < deadline) {
        await delay(POLL_INTERVAL_MS);
        const runs = await container.reviewRepo.listRunsForPull(workspaceId, prResult.pull.id);
        const run = runs.find((r) => r.run_id === runId);
        if (!run || run.status === 'running') continue;

        if (run.status === 'done') {
          const review = await container.reviewRepo.reviewByRunId(workspaceId, runId);
          const findings = (review?.findings ?? []).map(toConciseFinding);
          const structuredContent = RunResult.parse({
            run_id: runId,
            verdict: review?.review.verdict ?? null,
            findings,
          });
          const text = `Verdict: ${review?.review.verdict ?? 'none'} — ${findings.length} finding(s). run_id: ${runId} (use get_findings with it to re-fetch this exact run).`;
          return { content: [{ type: 'text' as const, text }], structuredContent };
        }

        // failed | cancelled
        return errorResult(`review ${run.status}: ${run.error ?? 'unknown error'} — inspect the run in DevDigest`);
      }

      const message = `review still running after ${container.config.mcpRunTimeoutMs}ms — call get_findings with run_id "${runId}"`;
      const structuredContent = RunResult.parse({ run_id: runId, status: 'running' as const, message });
      return {
        content: [{ type: 'text' as const, text: message }],
        structuredContent,
      };
    },
  );
}

/** Local "error leads onward" helper — mirrors `list-agents.ts`'s pattern. */
function errorResult(text: string): { content: [{ type: 'text'; text: string }]; isError: true } {
  return { content: [{ type: 'text', text }], isError: true as const };
}
