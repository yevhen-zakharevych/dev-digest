import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../messages/en/multiAgent.json";

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security Reviewer", description: "Flags secrets and injection" },
      { id: "a2", name: "Perf Reviewer", description: "Flags perf regressions" },
    ],
  }),
}));

const mutateAsync = vi.fn().mockResolvedValue({ multi_run_id: "m1", pr_id: "pr1", runs: [] });
let estimatesData: unknown = [
  { agent_id: "a1", avg_duration_ms: 8200, avg_cost_usd: 0.06, sample_size: 4 },
];
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({ data: estimatesData }),
  useCreateMultiRun: () => ({ mutateAsync, isPending: false }),
}));

import { AgentSelection } from "./AgentSelection";

afterEach(() => {
  cleanup();
  mutateAsync.mockClear();
  estimatesData = [{ agent_id: "a1", avg_duration_ms: 8200, avg_cost_usd: 0.06, sample_size: 4 }];
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("AgentSelection (AC-5, AC-6, AC-8, AC-9, AC-10)", () => {
  it("shows a description + hint per agent and a Select-all control", () => {
    renderWithIntl(<AgentSelection repoId="repo1" prId="pr1" prNumber={12} onRan={() => {}} />);
    expect(screen.getByText("Flags secrets and injection")).toBeInTheDocument();
    expect(screen.getByText("8.2s · $0.060")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select all" })).toBeInTheDocument();
  });

  it("Select-all checks every agent and updates the run button count", () => {
    renderWithIntl(<AgentSelection repoId="repo1" prId="pr1" prNumber={12} onRan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeInTheDocument();
  });

  it("summary is MAX time / SUM cost and marks approximate when one selected agent lacks history", () => {
    renderWithIntl(<AgentSelection repoId="repo1" prId="pr1" prNumber={12} onRan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    const summary = screen.getByTestId("estimate-summary");
    expect(summary.textContent).toContain("8.2s");
    expect(summary.textContent).toContain("approximate");
  });

  it("renders no numeric estimate when every selected agent lacks history (AC-9)", () => {
    estimatesData = [];
    renderWithIntl(<AgentSelection repoId="repo1" prId="pr1" prNumber={12} onRan={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Select all" }));
    const summary = screen.getByTestId("estimate-summary");
    expect(summary.textContent).not.toMatch(/\d/);
  });

  it("still allows selecting and running when the estimates query fails (AC-10)", () => {
    estimatesData = undefined;
    renderWithIntl(<AgentSelection repoId="repo1" prId="pr1" prNumber={12} onRan={() => {}} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    const runButton = screen.getByRole("button", { name: "Run multi-agent review (1)" });
    expect(runButton).not.toBeDisabled();
  });

  it("running issues one create request and calls onRan with the PR number", async () => {
    const onRan = vi.fn();
    renderWithIntl(<AgentSelection repoId="repo1" prId="pr1" prNumber={12} onRan={onRan} />);
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Run multi-agent review (1)" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1"] });
    await waitFor(() => expect(onRan).toHaveBeenCalledWith(12));
  });
});
