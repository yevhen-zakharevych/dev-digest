/* hooks/evals.ts — React Query hooks for the L06 Eval Pipeline.
   Single data-access surface for eval cases, runs, drafts, compare, promote
   and the dashboards — see docs/plans/L06-eval-pipeline.md §7.6 for the
   pinned REST surface this file builds against. No UI task may call `api`
   directly for eval data; every read/write goes through a hook here. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  EvalCase,
  EvalCaseInput,
  EvalComparison,
  EvalDashboard,
  EvalDraftResult,
  EvalPromoteResult,
  EvalRunAllPreview,
  EvalRunDetail,
  EvalRunSummary,
  EvalWorkspaceDashboard,
} from "@devdigest/shared";

// ============================================================================
// Cases — GET/POST /agents/:agentId/eval/cases, GET/PUT/DELETE /eval/cases/:id
// ============================================================================

/** An agent's eval case set (AC-30). */
export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-cases", agentId],
    queryFn: () => api.get<EvalCase[]>(`/agents/${agentId}/eval/cases`),
    enabled: !!agentId,
  });
}

/** Create payload for a case scoped under an agent — owner is the URL segment,
 *  so `owner_kind`/`owner_id` are dropped from the body (T17 derives them). */
export type CreateEvalCaseInput = Omit<EvalCaseInput, "owner_kind" | "owner_id">;

export function useCreateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, input }: { agentId: string; input: CreateEvalCaseInput }) =>
      api.post<EvalCase>(`/agents/${agentId}/eval/cases`, input),
    onSuccess: (_d, { agentId }) => {
      qc.invalidateQueries({ queryKey: ["eval-cases", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", agentId] });
    },
  });
}

/** One case (case editor read, AC-4/AC-5/AC-6). */
export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-case", caseId],
    queryFn: () => api.get<EvalCase>(`/eval/cases/${caseId}`),
    enabled: !!caseId,
  });
}

export type UpdateEvalCaseInput = Partial<
  Pick<
    EvalCaseInput,
    "name" | "input_diff" | "input_files" | "input_meta" | "expected_output" | "forbidden_region" | "notes"
  >
>;

/** Edit a case's diff/expected output/notes; re-validated server-side on every
 *  diff edit (AC-7) and re-fingerprinted on every write (AC-14). */
export function useUpdateEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ caseId, patch }: { caseId: string; patch: UpdateEvalCaseInput }) =>
      api.put<EvalCase>(`/eval/cases/${caseId}`, patch),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.setQueryData(["eval-case", data.id], data);
    },
  });
}

export function useDeleteEvalCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.del<{ ok: boolean }>(`/eval/cases/${caseId}`),
    onSuccess: (_d, caseId) => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      qc.removeQueries({ queryKey: ["eval-case", caseId] });
    },
  });
}

// ============================================================================
// Seed from a decided finding — POST /eval/cases/from-finding (AC-1/2/3/7/8)
// ============================================================================

/** No shared wrapper type exists for this compound response (only `EvalCase`
 *  itself is vendored) — a thin local wrapper around the shared `EvalCase`
 *  type, same pattern as `ActiveRun`/`CreateCommentInput` in `reviews.ts`. */
export interface SeedEvalCaseResult {
  case: EvalCase;
  created: boolean;
}

/** Turn an accepted/dismissed finding into an eval case, or surface the
 *  existing one (AC-8) — invoked from the FindingCard's third action. */
export function useSeedEvalCaseFromFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (findingId: string) =>
      api.post<SeedEvalCaseResult>("/eval/cases/from-finding", { finding_id: findingId }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-cases"] });
      // Seeding a case changes `cases_total` — the number the Evals tab uses to
      // decide between "no cases yet" and a real case list (AC-31).
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] });
    },
  });
}

// ============================================================================
// Drafts — POST /eval/cases/:caseId/draft, GET /eval/cases/:caseId/draft
// ============================================================================

/** Fire a single-case draft (AC-47) — asynchronous like a run (Assumption
 *  A-1): the server enqueues it and this resolves with an ack, not the
 *  result. Poll `useEvalCaseDraft` to observe it landing. */
export function useRunEvalDraft() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.post<{ ok: boolean }>(`/eval/cases/${caseId}/draft`),
    onSuccess: (_d, caseId) => {
      qc.invalidateQueries({ queryKey: ["eval-case-draft", caseId] });
      qc.invalidateQueries({ queryKey: ["eval-case", caseId] });
      // A draft moves NO metric and enters NO run history (AC-47) — but it DOES
      // cost real money, and the dashboard reports draft spend as its own
      // component (AC-49). Without this the spend line sits stale and the
      // feature looks like it is quietly not charging for drafts.
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
    },
  });
}

/**
 * A case's latest scratch result (AC-48) — `null` before the case has ever
 * been drafted, so this is typed `EvalDraftResult | null`, not the bare
 * contract type (`client/INSIGHTS.md:21`'s "may not exist yet" rule).
 *
 * The vendored `EvalDraftResult` carries no in-flight/`running` variant of
 * `outcome` (it is always `passed|failed|errored`, populated once the draft
 * completes) — unlike `EvalRunSummary.status`, there is no field here to
 * drive a self-clearing `refetchInterval` purely from the fetched data. The
 * caller (the case editor, a later wave) is expected to flip
 * `pollWhileRunning` for the few seconds between firing `useRunEvalDraft`
 * and the new draft landing, then stop. See this file's task report for the
 * §7.6 gap this works around.
 */
export function useEvalCaseDraft(
  caseId: string | null | undefined,
  opts?: { pollWhileRunning?: boolean },
) {
  return useQuery({
    queryKey: ["eval-case-draft", caseId],
    queryFn: () => api.get<EvalDraftResult | null>(`/eval/cases/${caseId}/draft`),
    enabled: !!caseId,
    refetchInterval: opts?.pollWhileRunning ? 4000 : false,
  });
}

// ============================================================================
// Runs (the batch) — POST/GET /agents/:agentId/eval/runs, GET/cancel a run
// ============================================================================

/** Start a run over an agent's whole case set (AC-9/11/34); resolves
 *  immediately with the run in a non-terminal (`running`) status. */
export function useStartEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (agentId: string) => api.post<EvalRunSummary>(`/agents/${agentId}/eval/runs`),
    onSuccess: (_d, agentId) => {
      qc.invalidateQueries({ queryKey: ["eval-run-history", agentId] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", agentId] });
    },
  });
}

/** An agent's run history — every run, each flagged `set_drifted` (AC-44/45). */
export function useEvalRunHistory(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-run-history", agentId],
    queryFn: () => api.get<EvalRunSummary[]>(`/agents/${agentId}/eval/runs`),
    enabled: !!agentId,
  });
}

/** One run's detail, polled while in flight for "k of N" progress (AC-12).
 *  Self-clearing: the run's own persisted `status` field decides whether to
 *  keep polling, mirroring `usePrRuns` (`client/src/lib/hooks/reviews.ts:40-48`). */
export function useEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-run", runId],
    queryFn: () => api.get<EvalRunDetail>(`/eval/runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data?.status === "running" ? 4000 : false),
  });
}

/** Cancel an in-flight run (AC-12); the polled `useEvalRun` picks up the
 *  resulting `cancelled` status on its next tick — mirrors the deliberate
 *  minimalism of `useCancelRun` (`client/src/lib/hooks/reviews.ts:74-78`). */
export function useCancelEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (runId: string) => api.post<{ ok: boolean }>(`/eval/runs/${runId}/cancel`),
    onSuccess: () => {
      // A cancelled run is a terminal row in the history (with whatever it had
      // measured and cost before the stop) — refresh the surfaces that show it,
      // or the run appears stuck "running" until a reload.
      qc.invalidateQueries({ queryKey: ["eval-run-history"] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] });
    },
  });
}

// ============================================================================
// Compare + promote — GET /eval/compare, POST /eval/runs/:runId/promote
// ============================================================================

/** Compare exactly two runs of the same agent (AC-24..26, AC-51, AC-52). */
export function useEvalComparison(runIdA: string | null | undefined, runIdB: string | null | undefined) {
  return useQuery({
    queryKey: ["eval-compare", runIdA, runIdB],
    queryFn: () =>
      api.get<EvalComparison>(`/eval/compare?a=${encodeURIComponent(runIdA!)}&b=${encodeURIComponent(runIdB!)}`),
    enabled: !!runIdA && !!runIdB,
  });
}

/** Promote a run's effective config to be the agent's live config (AC-27);
 *  `acknowledge_regression` confirms a promote that regresses a metric (AC-28). */
export function usePromoteEvalRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ runId, acknowledgeRegression }: { runId: string; acknowledgeRegression?: boolean }) =>
      api.post<EvalPromoteResult>(`/eval/runs/${runId}/promote`, {
        ...(acknowledgeRegression ? { acknowledge_regression: acknowledgeRegression } : {}),
      }),
    onSuccess: (data) => {
      // Promote bumps the agent's live config + version — refresh agent
      // reads (owned by `hooks/agents.ts`, same QueryClient) as well as the
      // eval surfaces that show the agent's version chip.
      qc.invalidateQueries({ queryKey: ["agents"] });
      qc.invalidateQueries({ queryKey: ["agent", data.agent_id] });
      // Promote re-links the SKILLS too, not just the prompt/model — and the
      // Skills tab reads a separate key (`useAgentSkills`, hooks/skills.ts:152).
      // Without this the tab shows the pre-promote links until a hard reload,
      // which reads as "promote failed to restore the skills" — i.e. a stale
      // cache impersonating the exact bug AC-27 exists to prevent.
      qc.invalidateQueries({ queryKey: ["agent-skills", data.agent_id] });
      qc.invalidateQueries({ queryKey: ["eval-run-history", data.agent_id] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard", data.agent_id] });
    },
  });
}

// ============================================================================
// Dashboards — GET /agents/:agentId/eval/dashboard, GET /eval/dashboard
// ============================================================================

/** Per-agent dashboard: metric cards, headline pass count, alert, spend
 *  (AC-30..33, AC-46, AC-49, AC-50). Metrics inside `current` are nullable
 *  by contract (not the whole object) — a zero-case or never-run agent still
 *  returns this shape so AC-31/AC-32's empty states render from real data. */
export function useAgentEvalDashboard(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ["agent-eval-dashboard", agentId],
    queryFn: () => api.get<EvalDashboard>(`/agents/${agentId}/eval/dashboard`),
    enabled: !!agentId,
  });
}

/** Workspace-wide Eval Dashboard: every agent + a cross-agent recent-runs
 *  table (AC-29, AC-33). */
export function useEvalWorkspaceDashboard() {
  return useQuery({
    queryKey: ["eval-workspace-dashboard"],
    queryFn: () => api.get<EvalWorkspaceDashboard>("/eval/dashboard"),
  });
}

// ============================================================================
// Run all agents — GET /eval/run-all/preview, POST /eval/run-all (AC-35)
// ============================================================================

/** Named totals (agents + cases) for the "Run all agents" confirmation,
 *  before a single model call is issued (AC-35). Zero-case agents are
 *  already excluded by the server. */
export function useEvalRunAllPreview() {
  return useQuery({
    queryKey: ["eval-run-all-preview"],
    queryFn: () => api.get<EvalRunAllPreview>("/eval/run-all/preview"),
  });
}

/** Kick off a run for every agent with a non-empty case set. §7.6 pins no
 *  response shape for this route; typed as an ack (mirrors `useCancelRun`)
 *  since each started run is independently observable via
 *  `useEvalRunHistory`/`useEvalRun` per agent. */
export function useRunAllEvals() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ ok: boolean }>("/eval/run-all"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["eval-workspace-dashboard"] });
      qc.invalidateQueries({ queryKey: ["agent-eval-dashboard"] });
      qc.invalidateQueries({ queryKey: ["eval-run-history"] });
    },
  });
}
