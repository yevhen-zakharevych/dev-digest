import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, Conflict, ConflictTake } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json";
import { DisagreementBlock } from "./DisagreementBlock";

afterEach(cleanup);

function take(o: Partial<ConflictTake> & Pick<ConflictTake, "agent_id" | "verdict">): ConflictTake {
  return { persona: `Persona ${o.agent_id}`, note: "", ...o };
}

function column(o: Partial<AgentColumn> & Pick<AgentColumn, "agent_id" | "status">): AgentColumn {
  return {
    run_id: `run-${o.agent_id}`,
    agent_name: `Agent ${o.agent_id}`,
    provider: null,
    model: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: [],
    ...o,
  };
}

const CONTESTED: Conflict = {
  file: "src/auth.ts",
  line: 41,
  title: "Missing workspace scope",
  takes: [take({ agent_id: "a", verdict: "CRITICAL" }), take({ agent_id: "b", verdict: "ignored" })],
};
const UNANIMOUS: Conflict = {
  file: "src/db.ts",
  line: 7,
  title: "N+1 query",
  takes: [take({ agent_id: "a", verdict: "WARNING" }), take({ agent_id: "b", verdict: "WARNING" })],
};

function renderBlock(conflicts: Conflict[], columns: AgentColumn[] = []) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <DisagreementBlock conflicts={conflicts} columns={columns} />
    </NextIntlClientProvider>,
  );
}

describe("DisagreementBlock — rendering the server's groups as-is (AC-21)", () => {
  it("renders one group per server conflict, in server order, with no re-bucketing", () => {
    renderBlock([CONTESTED, UNANIMOUS]);
    const groups = screen.getAllByTestId("conflict-group");
    expect(groups).toHaveLength(2);
    expect(within(groups[0]!).getByText("src/auth.ts:41")).toBeInTheDocument();
    expect(within(groups[1]!).getByText("src/db.ts:7")).toBeInTheDocument();
  });

  it("shows a severity for a flagging agent and the 'did not flag' label for an ignored take", () => {
    renderBlock([CONTESTED]);
    const group = screen.getByTestId("conflict-group");
    expect(within(group).getAllByTestId("take-severity")).toHaveLength(1);
    expect(within(group).getByTestId("take-did-not-flag")).toHaveTextContent("did not flag");
  });
});

describe("DisagreementBlock — non-terminal agents (AC-24)", () => {
  it("shows a still-running agent as pending, NEVER as 'did not flag'", () => {
    renderBlock([{ ...CONTESTED, takes: [take({ agent_id: "a", verdict: "CRITICAL" })] }], [
      column({ agent_id: "a", status: "done" }),
      column({ agent_id: "b", status: "running" }),
    ]);
    const group = screen.getByTestId("conflict-group");
    const pending = within(group).getByTestId("conflict-pending");
    expect(pending).toHaveTextContent("Agent b");
    expect(pending).toHaveTextContent("still running");
    expect(within(group).queryByTestId("take-did-not-flag")).not.toBeInTheDocument();
  });

  it("recomputes from the props the poll delivers — the same agent becomes 'did not flag' once done", () => {
    const { rerender } = renderBlock([{ ...CONTESTED, takes: [take({ agent_id: "a", verdict: "CRITICAL" })] }], [
      column({ agent_id: "a", status: "done" }),
      column({ agent_id: "b", status: "running" }),
    ]);
    expect(screen.getByTestId("conflict-pending")).toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
        <DisagreementBlock
          conflicts={[CONTESTED]}
          columns={[column({ agent_id: "a", status: "done" }), column({ agent_id: "b", status: "done" })]}
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByTestId("conflict-pending")).not.toBeInTheDocument();
    expect(screen.getByTestId("take-did-not-flag")).toBeInTheDocument();
  });

  it("never shows a failed or cancelled agent as pending or as 'did not flag'", () => {
    renderBlock([{ ...CONTESTED, takes: [take({ agent_id: "a", verdict: "CRITICAL" })] }], [
      column({ agent_id: "a", status: "done" }),
      column({ agent_id: "b", status: "failed" }),
      column({ agent_id: "c", status: "cancelled" }),
    ]);
    const group = screen.getByTestId("conflict-group");
    expect(within(group).queryByTestId("conflict-pending")).not.toBeInTheDocument();
    expect(within(group).queryByTestId("take-did-not-flag")).not.toBeInTheDocument();
  });
});

describe("DisagreementBlock — 'Show only conflicts' (AC-22, AC-23)", () => {
  it("hides unanimous groups while the toggle is on", () => {
    renderBlock([CONTESTED, UNANIMOUS]);
    expect(screen.getAllByTestId("conflict-group")).toHaveLength(2);

    fireEvent.click(screen.getByRole("switch"));

    const groups = screen.getAllByTestId("conflict-group");
    expect(groups).toHaveLength(1);
    expect(within(groups[0]!).getByText("src/auth.ts:41")).toBeInTheDocument();
  });

  it("is a keyboard-operable, visibly labelled switch", () => {
    renderBlock([CONTESTED]);
    expect(screen.getByText("Show only conflicts")).toBeInTheDocument();
    const toggle = screen.getByRole("switch");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(toggle.tagName).toBe("BUTTON"); // natively focusable + Enter/Space
    fireEvent.click(toggle);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("renders an explicit labelled empty state — never a blank area — when the toggle leaves nothing", () => {
    renderBlock([UNANIMOUS]);
    expect(screen.queryByTestId("conflicts-empty")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("switch"));

    const empty = screen.getByTestId("conflicts-empty");
    expect(within(empty).getByText(messages.conflicts.empty)).toBeInTheDocument();
    expect(screen.queryByTestId("conflict-group")).not.toBeInTheDocument();
  });
});

/* `buildConflicts` emits a group per flagged `(file, line)` — singletons
   included — so zero groups means nothing was flagged, NOT that the agents
   reached consensus. Reporting a failed or empty run as agreement turns a
   non-result into a clean bill of health. */
describe("DisagreementBlock — an empty block states WHY it is empty", () => {
  it("says the agents agree only when groups exist and the toggle hid them", () => {
    renderBlock([UNANIMOUS]);
    fireEvent.click(screen.getByRole("switch"));

    const empty = screen.getByTestId("conflicts-empty");
    expect(within(empty).getByText(messages.conflicts.empty)).toBeInTheDocument();
  });

  it("says nothing was flagged when agents completed but produced no groups", () => {
    renderBlock([], [column({ agent_id: "a", status: "done" })]);

    const empty = screen.getByTestId("conflicts-empty");
    expect(within(empty).getByText(messages.conflicts.emptyNoFindings)).toBeInTheDocument();
    expect(within(empty).queryByText(messages.conflicts.empty)).not.toBeInTheDocument();
  });

  it("never claims agreement when every agent failed", () => {
    renderBlock([], [
      column({ agent_id: "a", status: "failed" }),
      column({ agent_id: "b", status: "failed" }),
    ]);

    const empty = screen.getByTestId("conflicts-empty");
    expect(within(empty).getByText(messages.conflicts.emptyNoCompleted)).toBeInTheDocument();
    expect(within(empty).queryByText(messages.conflicts.empty)).not.toBeInTheDocument();
  });
});
