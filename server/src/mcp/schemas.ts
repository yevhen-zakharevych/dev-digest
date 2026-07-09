/**
 * MCP tool input schemas + local output envelopes (transport-local — NOT
 * vendored in `@devdigest/shared`; see docs/plans/L04-devdigest-mcp.md §4).
 *
 * Every input schema is FLAT and `.strict()` (reject unknown keys), with
 * `.describe()` on every field — the descriptions below are copied VERBATIM
 * from the plan §5.1 so the LLM-facing tool docs match the design exactly.
 *
 * Output envelopes reuse existing `@devdigest/shared` data contracts
 * (`Agent`, `Verdict`, `ConventionCandidate`, `BlastRadius`, `Finding`) as
 * building blocks — they do not redefine those fields.
 */
import { z } from 'zod';
import { Agent, ConventionCandidate, Finding, Verdict, BlastRadius } from '@devdigest/shared';

// ---------------------------------------------------------------------------
// Input schemas
// ---------------------------------------------------------------------------

/** `list_agents` — no input. */
export const ListAgentsInput = z.object({}).strict();
export type ListAgentsInput = z.infer<typeof ListAgentsInput>;

/** `run_agent_on_pr` — the only mutating tool. */
export const RunAgentOnPrInput = z
  .object({
    repo: z.string().describe('Repository in "owner/name" form, e.g. "acme/web".'),
    pr: z.number().int().describe('Pull request number as shown on GitHub (not an internal id).'),
    agent: z.string().describe('Agent id from list_agents.'),
  })
  .strict();
export type RunAgentOnPrInput = z.infer<typeof RunAgentOnPrInput>;

/**
 * `get_findings` — identify the run by `run_id` OR by `repo`+`pr`, never both,
 * never neither. Enforced below via `.superRefine`.
 *
 * The raw shape is factored out into `GetFindingsInputShape` so
 * `tools/get-findings.ts` can pass a `ZodRawShape` to `registerTool`'s
 * `inputSchema` (the refined `.superRefine` object below is a `ZodEffects`,
 * which has no `.shape`) while both share the exact same field defs — never
 * duplicate the field descriptions, they must stay identical.
 */
export const GetFindingsInputShape = {
  run_id: z
    .string()
    .uuid()
    .optional()
    .describe('Run id from run_agent_on_pr. Provide this OR repo+pr, not both.'),
  repo: z.string().optional().describe('Repository "owner/name". Use with pr instead of run_id.'),
  pr: z.number().int().optional().describe('Pull request number. Use with repo instead of run_id.'),
  format: z
    .enum(['concise', 'detailed'])
    .default('concise')
    .describe(
      '"concise" (default: id, severity, title, file, lines) or "detailed" (adds rationale, suggestion, confidence).',
    ),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Pagination start index; use next_offset from the previous page. Default 0.'),
};

export const GetFindingsInput = z
  .object(GetFindingsInputShape)
  .strict()
  .superRefine((val, ctx) => {
    const hasRunId = val.run_id !== undefined;
    const hasRepoAndPr = val.repo !== undefined && val.pr !== undefined;
    // XOR: exactly one of run_id, or repo+pr together — a lone repo or a lone
    // pr (without its pair) falls through to "neither" and is rejected too.
    if (hasRunId === hasRepoAndPr) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Provide exactly one of run_id, or repo together with pr — not both, and not neither.',
        path: ['run_id'],
      });
    }
  });
export type GetFindingsInput = z.infer<typeof GetFindingsInput>;

/** `get_conventions` — keyed by repo, not PR. */
export const GetConventionsInput = z
  .object({
    repo: z.string().describe('Repository "owner/name".'),
  })
  .strict();
export type GetConventionsInput = z.infer<typeof GetConventionsInput>;

/** `get_blast_radius` — deliberate stub in this lesson (see mappers.ts). */
export const GetBlastRadiusInput = z
  .object({
    repo: z.string().describe('Repository "owner/name".'),
    pr: z.number().int().describe('Pull request number.'),
  })
  .strict();
export type GetBlastRadiusInput = z.infer<typeof GetBlastRadiusInput>;

// ---------------------------------------------------------------------------
// Output envelopes (transport-local; reuse shared data contracts as building
// blocks, never redefine their field names/casing)
// ---------------------------------------------------------------------------

/** Concise finding: only the fields needed to triage without an LLM round-trip. */
export const ConciseFinding = Finding.pick({
  id: true,
  severity: true,
  category: true,
  title: true,
  file: true,
  start_line: true,
  end_line: true,
});
export type ConciseFinding = z.infer<typeof ConciseFinding>;

/** Detailed finding: concise fields + rationale/suggestion/confidence. */
export const DetailedFinding = Finding.pick({
  id: true,
  severity: true,
  category: true,
  title: true,
  file: true,
  start_line: true,
  end_line: true,
  rationale: true,
  suggestion: true,
  confidence: true,
});
export type DetailedFinding = z.infer<typeof DetailedFinding>;

/** `get_findings` response — paginated, char-budgeted (see `paginateFindings`). */
export const FindingsPage = z.object({
  verdict: Verdict.nullable(),
  findings: z.array(z.union([ConciseFinding, DetailedFinding])),
  total: z.number().int(),
  count: z.number().int(),
  offset: z.number().int(),
  has_more: z.boolean(),
  next_offset: z.number().int().nullable(),
});
export type FindingsPage = z.infer<typeof FindingsPage>;

/** `run_agent_on_pr` — result-not-operation: finished review, or a poll handoff. */
export const RunResultDone = z.object({
  run_id: z.string(),
  verdict: Verdict.nullable(),
  findings: z.array(ConciseFinding),
});
export type RunResultDone = z.infer<typeof RunResultDone>;

export const RunResultRunning = z.object({
  run_id: z.string(),
  status: z.literal('running'),
  message: z.string(),
});
export type RunResultRunning = z.infer<typeof RunResultRunning>;

export const RunResult = z.union([RunResultDone, RunResultRunning]);
export type RunResult = z.infer<typeof RunResult>;

// Re-exported building blocks for tool handlers (`list_agents`, `get_conventions`,
// `get_blast_radius`) so callers only need to import from `./schemas.js`.
export { Agent, ConventionCandidate, BlastRadius, Verdict };
