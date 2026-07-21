import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json";
import { AgentColumns } from "./AgentColumns";

afterEach(cleanup);

function column(o: Partial<AgentColumn> & Pick<AgentColumn, "agent_id">): AgentColumn {
  return {
    run_id: `run-${o.agent_id}`,
    agent_name: `Agent ${o.agent_id}`,
    provider: null,
    model: null,
    status: "done",
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: [],
    ...o,
  };
}

function renderColumns(columns: AgentColumn[]) {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <AgentColumns
        columns={columns}
        repoId="repo-1"
        prNumber="42"
        selectedFindingId={null}
        onSelectFinding={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("AgentColumns (AC-15)", () => {
  it("renders exactly one column per agent, in server order", () => {
    renderColumns([column({ agent_id: "a" }), column({ agent_id: "b" }), column({ agent_id: "c" })]);
    const cols = screen.getAllByTestId("agent-column");
    expect(cols).toHaveLength(3);
    expect(cols.map((c) => c.getAttribute("data-agent-id"))).toEqual(["a", "b", "c"]);
  });

  it("points each View-trace link at the PR page's existing ?trace= drawer", () => {
    renderColumns([column({ agent_id: "a", run_id: "run-xyz" })]);
    expect(within(screen.getByTestId("agent-column")).getByTestId("agent-trace-link")).toHaveAttribute(
      "href",
      "/repos/repo-1/pulls/42?trace=run-xyz",
    );
  });

  it("has no display-mode toggle — Columns is the only v1 mode", () => {
    renderColumns([column({ agent_id: "a" })]);
    expect(screen.queryByText(messages.page.view.columns)).not.toBeInTheDocument();
    expect(screen.queryByText(messages.page.view.tabs)).not.toBeInTheDocument();
  });
});
