import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Finding } from '@devdigest/shared';
import { ApiError, type ToolDeps } from '../http/client.js';
import { resolveRepoBySlug, resolvePrId } from '../resolve.js';
import { GetFindingsInput, GetFindingsInputShape, FindingsPage } from '../schemas.js';
import { toFinding, paginateFindings } from '../mappers.js';
import { errorResult } from './util.js';

/**
 * `get_findings` — read-only. Identify the completed run by `run_id` OR by
 * `repo`+`pr` (never both, enforced by `GetFindingsInput`'s `.superRefine`),
 * then return its verdict + a paginated, char-budgeted findings page.
 *
 * `inputSchema` needs a raw `ZodRawShape`, but `GetFindingsInput` is a
 * `ZodEffects` (from `.superRefine`) with no `.shape` — so we pass the
 * factored-out `GetFindingsInputShape`, while still `.safeParse`-ing against
 * the full refined `GetFindingsInput` inside the handler (enforces the XOR +
 * `.strict()`).
 *
 * Reaches the product only through the HTTP `client` — no DB/Container.
 */
export function registerGetFindings(server: McpServer, { client }: ToolDeps): void {
  server.registerTool(
    'get_findings',
    {
      title: 'Get findings',
      description:
        'Fetch the findings of an already-completed review run as a concise verdict + list. Read-only. Identify the run by `run_id` (from run_agent_on_pr) OR by `repo`+`pr`. Returns only key fields by default; pass format="detailed" for rationale/suggestion. Large results are paginated — pass `offset` from the returned next_offset. Does NOT start a review; if none exists, returns an error telling you to call run_agent_on_pr.',
      inputSchema: GetFindingsInputShape,
      outputSchema: FindingsPage.shape,
      annotations: {
        readOnlyHint: true,
        idempotentHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      const parsed = GetFindingsInput.safeParse(args);
      if (!parsed.success) {
        const message = parsed.error.issues.map((issue) => issue.message).join('; ');
        return errorResult(message || 'Invalid input for get_findings.');
      }
      const { run_id, repo, pr, format, offset } = parsed.data;

      let verdict: string | null;
      let rows: Finding[];

      if (run_id !== undefined) {
        try {
          const found = await client.reviewByRun(run_id);
          verdict = found.verdict;
          rows = found.findings;
        } catch (err) {
          if (err instanceof ApiError && err.status === 404) {
            return errorResult(`no review found for run_id "${run_id}" — run run_agent_on_pr first`);
          }
          throw err;
        }
      } else {
        // repo + pr branch (guaranteed present by GetFindingsInput's XOR refine).
        const slug = repo!;
        const repoResult = await resolveRepoBySlug(client, slug);
        if (!repoResult.ok) {
          return errorResult(
            repoResult.reason === 'bad_slug'
              ? `repo "${slug}" is not a valid "owner/name" slug`
              : `repo "${slug}" not imported — add it in DevDigest first`,
          );
        }

        const prResult = await resolvePrId(client, repoResult.repoId, pr!);
        if (!prResult.ok) {
          return errorResult(`PR #${pr} not found in ${slug}`);
        }

        const reviews = await client.reviewsForPull(prResult.prId);
        if (reviews.length === 0) {
          return errorResult(`no review yet for PR #${pr} in ${slug} — run run_agent_on_pr first`);
        }

        // `reviewsForPull` returns newest-first; use the latest review's verdict.
        const [latest] = reviews;
        verdict = latest ? latest.verdict : null;
        rows = reviews.flatMap((r) => r.findings);
      }

      const mapped = rows.map((row) => toFinding(row, format));
      const page = paginateFindings(mapped, offset, { maxChars: 25000 });

      const structuredContent = FindingsPage.parse({
        verdict,
        findings: page.items,
        total: page.total,
        count: page.count,
        offset: page.offset,
        has_more: page.has_more,
        next_offset: page.next_offset,
      });

      const text = `verdict: ${verdict ?? 'none'} — ${page.count} of ${page.total} findings, has_more=${page.has_more}`;

      return {
        content: [{ type: 'text' as const, text }],
        structuredContent,
      };
    },
  );
}
