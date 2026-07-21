import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../../../../../messages/en/multiAgent.json";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({
    data: [
      { id: "a1", name: "Security Reviewer" },
      { id: "a2", name: "Perf Reviewer" },
    ],
  }),
}));

const mutateAsync = vi.fn().mockResolvedValue({ multi_run_id: "m1", pr_id: "pr1", runs: [] });
vi.mock("@/lib/hooks/multi-agent", () => ({
  useAgentEstimates: () => ({ data: undefined }),
  useCreateMultiRun: () => ({ mutateAsync, isPending: false }),
}));

// The picker reads "does this PR already have a multi-run?" to decide whether to
// offer a link back to the results. Default: it does not.
// NB: declare the real param shape even though the body ignores it — a zero-arg
// arrow locks the mock's inferred TS signature to zero params and a later
// `useLatestMultiRun(prId)` becomes a type error (client/INSIGHTS.md:175).
const useLatestMultiRun = vi.fn((_prId: string | null | undefined) => ({ data: null }) as { data: unknown });
vi.mock("@/lib/hooks/multi-agent-runs", () => ({
  useLatestMultiRun: (prId: string | null | undefined) => useLatestMultiRun(prId),
}));

import { MultiAgentPicker } from "./MultiAgentPicker";

afterEach(() => {
  cleanup();
  push.mockClear();
  mutateAsync.mockClear();
  useLatestMultiRun.mockReturnValue({ data: null });
});

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

/** Open the picker panel and return it. The agent list lives behind a trigger
 *  so the PR header stays compact — nothing inside is queryable until it opens. */
function openPanel() {
  fireEvent.click(screen.getByRole("button", { name: /Run agents/ }));
  return screen.getByRole("dialog", { name: "Pick agents to run" });
}

describe("MultiAgentPicker (AC-1, AC-2, AC-3)", () => {
  it("keeps the agent list collapsed behind a trigger until it is opened", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: /Run agents/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("renders one checkbox per agent, a Configure-agents link, and a run button disabled at 0", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    const runButton = screen.getByRole("button", { name: "Run multi-agent review (0)" });
    expect(runButton).toBeDisabled();
    expect(runButton).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: /Configure agents/ })).toBeInTheDocument();
  });

  it("enables the run button and bumps its count once an agent is checked", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    const runButton = screen.getByRole("button", { name: "Run multi-agent review (1)" });
    expect(runButton).not.toBeDisabled();
    expect(runButton).toHaveAttribute("aria-disabled", "false");
  });

  it("ticking a checkbox does NOT close the panel (why this is not the shared Dropdown)", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run multi-agent review (2)" })).toBeInTheDocument();
  });

  it("closes on Escape and on an outside click, keeping the selection", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    openPanel();
    expect(screen.getByRole("button", { name: "Run multi-agent review (1)" })).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking Run with N>=1 issues exactly one create request and navigates to the results route", async () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Run multi-agent review (1)" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentIds: ["a1"] });
    await waitFor(() => expect(push).toHaveBeenCalledWith("/repos/repo1/multi-agent/42"));
  });

  it("labels an agent with no run history rather than fabricating a 0s hint (AC-7)", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    expect(screen.getAllByText("no history")).toHaveLength(2);
  });

  it("shows the summary only once something is selected, with no numbers when nothing has history (AC-9)", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    expect(screen.queryByTestId("picker-estimate-summary")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    const summary = screen.getByTestId("picker-estimate-summary");
    expect(summary).toHaveTextContent("no time/cost history yet");
    expect(summary.textContent).not.toMatch(/\d/);
  });

  it("surfaces the merged-PR warning inside the panel only when the PR is merged", () => {
    const { rerender } = renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    expect(screen.queryByText(/Already merged/)).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
        <MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} warnMerged />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(/Already merged/)).toBeInTheDocument();
  });

  /* Without this the results route is a dead end: nothing else in the app links
     to `/repos/:repoId/multi-agent/:number`, so navigating away from a run
     strands it. */
  it("offers a link back to the results only when the PR already has a multi-run", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    expect(screen.queryByRole("button", { name: /Multi-agent results/ })).not.toBeInTheDocument();
    cleanup();

    useLatestMultiRun.mockReturnValue({ data: { id: "m1", agent_count: 2 } });
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    fireEvent.click(screen.getByRole("button", { name: /Multi-agent results/ }));
    expect(push).toHaveBeenCalledWith("/repos/repo1/multi-agent/42");
  });

  it("Clear resets the selection back to 0", () => {
    renderWithIntl(<MultiAgentPicker prId="pr1" repoId="repo1" prNumber={42} />);
    openPanel();
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByRole("button", { name: "Run multi-agent review (0)" })).toBeInTheDocument();
  });
});
