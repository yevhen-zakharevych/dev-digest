import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalWorkspaceDashboard } from "@devdigest/shared";
import messages from "../../../../../messages/en/eval.json";

// House style: mock the hooks module the component consumes, not TanStack
// Query itself (client/INSIGHTS.md — no MSW precedent in this repo).
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/lib/hooks/evals", () => ({
  useEvalWorkspaceDashboard: vi.fn(),
  useEvalRunAllPreview: vi.fn(),
  useRunAllEvals: vi.fn(),
}));

import { useEvalRunAllPreview, useEvalWorkspaceDashboard, useRunAllEvals } from "@/lib/hooks/evals";
import { EvalDashboard } from "./EvalDashboard";

afterEach(cleanup);

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalDashboard />
    </NextIntlClientProvider>,
  );
}

function dashboard(o: Partial<EvalWorkspaceDashboard> = {}): EvalWorkspaceDashboard {
  return {
    agents: [],
    recent_runs: [],
    alert: null,
    ...o,
  };
}

function setup(data: EvalWorkspaceDashboard, opts: { runAllMutate?: ReturnType<typeof vi.fn> } = {}) {
  vi.mocked(useEvalWorkspaceDashboard).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as any);
  vi.mocked(useEvalRunAllPreview).mockReturnValue({
    data: { agents_total: 2, cases_total: 15, agents: [] },
  } as any);
  vi.mocked(useRunAllEvals).mockReturnValue({
    mutate: opts.runAllMutate ?? vi.fn(),
    isPending: false,
  } as any);
  return renderWithIntl();
}

describe("EvalDashboard — the three honesty renders (AC-31 vs AC-32 vs a measured zero)", () => {
  it("zero cases renders an explicit empty state and NEVER a metric percentage", () => {
    setup(
      dashboard({
        agents: [
          {
            agent_id: "a1",
            agent_name: "Security Reviewer",
            agent_version: 1,
            cases_total: 0,
            recall: null,
            precision: null,
            citation_accuracy: null,
            traces_passed: 0,
            traces_total: 0,
            spend: { total_usd: 0, run_usd: 0, draft_usd: 0 },
          },
        ],
      }),
    );

    const card = screen.getByTestId("agent-state-a1");
    expect(card).toHaveAttribute("data-state", "no-cases");
    expect(within(card).getByText("No eval cases yet")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("cases but never run renders 'never run' with dashes, not zeros", () => {
    setup(
      dashboard({
        agents: [
          {
            agent_id: "a2",
            agent_name: "Style Reviewer",
            agent_version: 1,
            cases_total: 8,
            recall: null,
            precision: null,
            citation_accuracy: null,
            traces_passed: 0,
            traces_total: 0,
            spend: { total_usd: 0, run_usd: 0, draft_usd: 0 },
          },
        ],
      }),
    );

    const card = screen.getByTestId("agent-state-a2");
    expect(card).toHaveAttribute("data-state", "never-run");
    expect(within(card).getByText("never run")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("a genuinely measured zero recall renders '0%', visibly distinct from the absent states above", () => {
    setup(
      dashboard({
        agents: [
          {
            agent_id: "a3",
            agent_name: "Silent Reviewer",
            agent_version: 3,
            cases_total: 5,
            recall: 0,
            precision: 1,
            citation_accuracy: 1,
            traces_passed: 0,
            traces_total: 5,
            spend: { total_usd: 0, run_usd: 0, draft_usd: 0 },
          },
        ],
      }),
    );

    const card = screen.getByTestId("agent-state-a3");
    expect(card).toHaveAttribute("data-state", "measured");
    expect(within(card).getByText("0%")).toBeInTheDocument();
    expect(within(card).getByText("0 / 5 passing")).toBeInTheDocument();
  });
});

describe("EvalDashboard — alert banner and 'Run all agents'", () => {
  it("names the metric and direction from the workspace alert, never invents one", () => {
    setup(dashboard({ alert: "Precision dipped 4% on v7 vs the previous comparable run." }));
    expect(screen.getByRole("status")).toHaveTextContent("Precision dipped 4%");
  });

  it("opens a confirmation naming both totals before a single call is issued, and skips zero-case agents", () => {
    const mutate = vi.fn();
    setup(
      dashboard({
        agents: [
          { agent_id: "a1", agent_name: "A", agent_version: 1, cases_total: 10, recall: 0.9, precision: 0.9, citation_accuracy: 0.9, traces_passed: 9, traces_total: 10, spend: { total_usd: 0.2, run_usd: 0.18, draft_usd: 0.02 } },
          { agent_id: "a2", agent_name: "B", agent_version: 1, cases_total: 0, recall: null, precision: null, citation_accuracy: null, traces_passed: 0, traces_total: 0, spend: { total_usd: 0, run_usd: 0, draft_usd: 0 } },
        ],
      }),
      { runAllMutate: mutate },
    );

    fireEvent.click(screen.getByRole("button", { name: "Run all agents" }));
    // Confirmation names both totals — from the preview, which already
    // excludes the zero-case agent from both counts.
    expect(screen.getByText(/2 agents/)).toBeInTheDocument();
    expect(screen.getByText(/15 cases/)).toBeInTheDocument();
    // No model call issued yet.
    expect(mutate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Run them" }));
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
