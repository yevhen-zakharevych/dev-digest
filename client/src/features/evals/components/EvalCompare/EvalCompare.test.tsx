import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalComparison, EvalRunSummary } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

vi.mock("@/lib/hooks/evals", () => ({
  useEvalComparison: vi.fn(),
  useEvalRunHistory: vi.fn(),
  usePromoteEvalRun: vi.fn(),
}));

import { useEvalComparison, useEvalRunHistory, usePromoteEvalRun } from "@/lib/hooks/evals";
import { EvalCompare } from "./EvalCompare";

afterEach(cleanup);

function run(o: Partial<EvalRunSummary> = {}): EvalRunSummary {
  return {
    id: "run-a",
    owner_kind: "agent",
    owner_id: "ag1",
    agent_version: 6,
    status: "done",
    started_at: "2026-07-01T00:00:00Z",
    finished_at: "2026-07-01T00:05:00Z",
    recall: 0.9,
    precision: 0.93,
    citation_accuracy: 0.95,
    traces_passed: 18,
    traces_total: 20,
    errored_count: 0,
    cost_usd: 0.4,
    duration_ms: 120000,
    cases_total: 20,
    set_drifted: false,
    ...o,
  };
}

function comparison(o: Partial<EvalComparison> = {}): EvalComparison {
  const base = run({ id: "run-a", agent_version: 6 });
  const candidate = run({ id: "run-b", agent_version: 7, precision: 0.91, recall: 0.94 });
  return {
    comparable: true,
    reason: null,
    base,
    candidate,
    base_config: {
      system_prompt: "You are a reviewer.\nBe concise.",
      provider: "openai",
      model: "gpt-4.1",
      strategy: "single-pass",
      repo_intel: true,
      skills: [],
    },
    candidate_config: {
      system_prompt: "You are a reviewer.\nBe thorough.",
      provider: "openai",
      model: "gpt-4.1",
      strategy: "single-pass",
      repo_intel: true,
      skills: [],
    },
    config_unavailable: false,
    shared_case_count: 19,
    delta: { recall: 0.04, precision: -0.02, citation_accuracy: 0.01 },
    excluded_cases: [{ case_id: "c1", case_name: "edge-case", reason: "changed" }],
    flipped_cases: [{ case_id: "c2", case_name: "stripe-leak", direction: "now_passing" }],
    skill_delta: [],
    effective_config_divergence: false,
    ...o,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function setup(data: EvalComparison, opts: { promoteMutate?: ReturnType<typeof vi.fn> } = {}) {
  vi.mocked(useEvalComparison).mockReturnValue({ data, isLoading: false, isError: false, error: null, refetch: vi.fn() } as any);
  vi.mocked(useEvalRunHistory).mockReturnValue({ data: [] } as any);
  vi.mocked(usePromoteEvalRun).mockReturnValue({ mutate: opts.promoteMutate ?? vi.fn(), isPending: false } as any);
  return renderWithIntl(<EvalCompare runIdA="run-a" runIdB="run-b" agentId="ag1" onPick={vi.fn()} />);
}

describe("EvalCompare — comparability and the never-alone delta (AC-26, AC-38)", () => {
  it("no shared case renders 'not comparable', never a delta or zeros", () => {
    setup(comparison({ comparable: false, reason: "no shared case", shared_case_count: 0 }));
    expect(screen.getByText("Not comparable — these two runs share no case with identical inputs.")).toBeInTheDocument();
    expect(screen.queryByTestId("delta-recall")).not.toBeInTheDocument();
  });

  it("every delta ships with the shared-case count and the named excluded/flipped cases", () => {
    setup(comparison());

    expect(screen.getByText("19 of 20 cases comparable")).toBeInTheDocument();

    const recallRow = screen.getByTestId("delta-recall");
    expect(within(recallRow).getByText("+4%")).toBeInTheDocument();

    const excluded = screen.getByTestId("excluded-cases");
    expect(within(excluded).getByText(/edge-case/)).toBeInTheDocument();
    expect(within(excluded).getByText(/inputs changed since the earlier run/)).toBeInTheDocument();

    const flipped = screen.getByTestId("flipped-cases");
    expect(within(flipped).getByText(/stripe-leak/)).toBeInTheDocument();
    expect(within(flipped).getByText(/now passes/)).toBeInTheDocument();
  });
});

describe("EvalCompare — effective-config divergence and degraded snapshots (AC-51, AC-52)", () => {
  it("same version tag, different config names the skill delta beside the prompt diff", () => {
    setup(
      comparison({
        effective_config_divergence: true,
        candidate: run({ id: "run-b", agent_version: 6, precision: 0.9 }), // SAME version tag as base
        skill_delta: [{ skill_id: "sk1", name: "Security rubric", change: "added", from_version: null, to_version: null }],
      }),
    );
    expect(
      screen.getByText(/Same version tag, different effective config/),
    ).toBeInTheDocument();
    expect(screen.getByText("Security rubric")).toBeInTheDocument();
    expect(screen.getByText("added")).toBeInTheDocument();
  });

  it("a run with no snapshot still renders deltas, with the prompt/skill diff marked unavailable, never an error", () => {
    setup(comparison({ config_unavailable: true, base_config: null, candidate_config: null }));
    expect(screen.getByTestId("delta-recall")).toBeInTheDocument(); // deltas still render
    expect(screen.getByText("Prompt diff unavailable — this run stored no config snapshot.")).toBeInTheDocument();
    expect(screen.getByText("Skill diff unavailable — this run stored no config snapshot.")).toBeInTheDocument();
  });
});

describe("EvalCompare — promote (AC-28)", () => {
  it("promoting the side that regresses on a metric names it and requires explicit confirm; cancelling promotes nothing", () => {
    const promoteMutate = vi.fn();
    // candidate (run-b, v7) is WORSE than base (run-a, v6) on precision: 0.91 < 0.93
    setup(comparison(), { promoteMutate });

    fireEvent.click(screen.getByRole("button", { name: "Promote v7" }));

    expect(screen.getByText(/Precision 93% → 91%/)).toBeInTheDocument();
    expect(promoteMutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(promoteMutate).not.toHaveBeenCalled();
    expect(screen.queryByText(/Precision 93% → 91%/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Promote v7" }));
    fireEvent.click(screen.getByRole("button", { name: "Promote anyway" }));
    expect(promoteMutate).toHaveBeenCalledWith(
      { runId: "run-b", acknowledgeRegression: true },
      expect.anything(),
    );
  });

  it("promoting the side that is NOT worse on anything promotes immediately, no confirmation needed", () => {
    const promoteMutate = vi.fn();
    // candidate (v7) strictly dominates base (v6) on every metric — no regression either way for it.
    setup(
      comparison({
        candidate: run({ id: "run-b", agent_version: 7, recall: 0.95, precision: 0.96, citation_accuracy: 0.97 }),
      }),
      { promoteMutate },
    );

    fireEvent.click(screen.getByRole("button", { name: "Promote v7" }));
    expect(promoteMutate).toHaveBeenCalledWith({ runId: "run-b" }, expect.anything());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); // no confirmation modal opened
  });
});
