import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json";
import { AgentColumnCard } from "./AgentColumnCard";

afterEach(cleanup);

function column(o: Partial<AgentColumn> = {}): AgentColumn {
  return {
    run_id: "run-1",
    agent_id: "agent-1",
    agent_name: "Security Reviewer",
    provider: "anthropic",
    model: "claude",
    status: "done",
    verdict: "request_changes",
    score: 72,
    summary: null,
    duration_ms: 8200,
    cost_usd: 0.0134,
    findings: [
      {
        id: "f1",
        severity: "CRITICAL",
        category: "security",
        title: "Hardcoded secret",
        file: "src/config.ts",
        start_line: 11,
        kind: "finding",
      },
    ],
    ...o,
  };
}

function renderCard(col: AgentColumn, onSelectFinding = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <AgentColumnCard
        column={col}
        traceHref={`/repos/r1/pulls/42?trace=${col.run_id}`}
        selectedFindingId={null}
        onSelectFinding={onSelectFinding}
      />
    </NextIntlClientProvider>,
  );
  return onSelectFinding;
}

describe("AgentColumnCard header (AC-15)", () => {
  it("shows status, score, duration, cost, findings count and a View-trace link", () => {
    renderCard(column());
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByTestId("agent-status")).toHaveTextContent("done");
    expect(screen.getByTestId("agent-score")).toBeInTheDocument();
    expect(screen.getByTestId("agent-duration")).toBeInTheDocument();
    expect(screen.getByTestId("agent-cost")).toBeInTheDocument();
    expect(screen.getByTestId("agent-findings-count")).toHaveTextContent("1 finding");
    expect(screen.getByTestId("agent-trace-link")).toHaveAttribute(
      "href",
      "/repos/r1/pulls/42?trace=run-1",
    );
  });

  it("renders a null score BLANK — never as 0 (AC-15)", () => {
    renderCard(column({ status: "running", score: null }));
    expect(screen.queryByTestId("agent-score")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-status")).toHaveTextContent("running");
  });

  it("still renders a real zero score (0 is a value, null is not)", () => {
    renderCard(column({ score: 0 }));
    expect(screen.getByTestId("agent-score")).toHaveTextContent("0");
  });

  it("renders a null duration/cost as an em-dash, not as 0s / $0", () => {
    renderCard(column({ duration_ms: null, cost_usd: null }));
    expect(screen.getByTestId("agent-duration")).toHaveTextContent("—");
    expect(screen.getByTestId("agent-cost")).toHaveTextContent("—");
  });

  it("labels each terminal status, including cancelled", () => {
    renderCard(column({ status: "cancelled" }));
    expect(screen.getByTestId("agent-status")).toHaveTextContent("cancelled");
  });
});

describe("AgentColumnCard findings list (AC-17 entry point)", () => {
  it("reports the selected finding id to the parent when a row is clicked", () => {
    const onSelect = renderCard(column());
    fireEvent.click(screen.getByTestId("column-finding"));
    expect(onSelect).toHaveBeenCalledWith("f1");
  });

  it("renders the scaffolded empty state for an agent that flagged nothing", () => {
    renderCard(column({ findings: [] }));
    expect(screen.getByText(messages.column.noFindings)).toBeInTheDocument();
    expect(screen.queryByTestId("column-finding")).not.toBeInTheDocument();
  });

  it("renders the file:line as escaped text, not as a link", () => {
    renderCard(column());
    const row = screen.getByTestId("column-finding");
    expect(within(row).getByText("src/config.ts:11")).toBeInTheDocument();
    expect(within(row).queryByRole("link")).not.toBeInTheDocument();
  });

  /* Regression: the title and the location used to be flex SIBLINGS of the row
     button. `findingLoc` sets `white-space: nowrap`, so its min-content width is
     the entire ~60-char repo path and it refuses to shrink — the title absorbed
     the whole deficit and collapsed to a single letter on real data. jsdom does
     no layout, so the assertable invariant is the structure: they stack inside
     their own container, and each truncates on its own. */
  it("stacks the title and the location so neither can starve the other", () => {
    renderCard(column());
    const row = screen.getByTestId("column-finding");
    const title = within(row).getByText("Hardcoded secret");
    const loc = within(row).getByText("src/config.ts:11");

    expect(title.parentElement).toBe(loc.parentElement);
    expect(title.parentElement).not.toBe(row);
    for (const el of [title, loc]) {
      expect(el.style.overflow).toBe("hidden");
      expect(el.style.textOverflow).toBe("ellipsis");
    }
  });
});
