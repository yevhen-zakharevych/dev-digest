import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { RunTrace } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/runs.json"; // apps/web/messages/en/runs.json

// Mock the trace hooks so the drawer renders without a query client / SSE.
const BASE_TRACE: RunTrace = {
  config: { agent: "Security", version: "1", provider: "openai", model: "gpt-4.1", pr: 482, source: "local" },
  stats: { duration_ms: 8200, tokens_in: 12000, tokens_out: 1500, findings: 2, grounding: "2/2 passed" },
  prompt_assembly: {
    system: "You are a reviewer.",
    skills: "### skill",
    memory: null,
    specs: "### project context excerpt",
    user: "Review PR #482",
  },
  tool_calls: [{ tool: "review_file", args: "src/config.ts", meta: "single-pass", ms: 1200 }],
  raw_output: '{"verdict":"request_changes"}',
  memory_pulled: [{ pr: 471, text: "rate-limit public endpoints" }],
  specs_read: ["specs/a.md"],
  specs_missing: [],
  log: [
    { t: "00.10", kind: "info", msg: "Starting review with agent Security" },
    { t: "00.90", kind: "result", msg: "Citation grounding: 2/2 passed" },
  ],
};

vi.mock("../../../../../../../lib/hooks/trace", () => ({
  useRunTrace: vi.fn(),
}));
vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useRunEvents: () => ({ events: [], running: false }),
}));

import { useRunTrace } from "../../../../../../../lib/hooks/trace";
import { RunTraceDrawer } from "./RunTraceDrawer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: messages }}>
      <div data-theme="dark">{ui}</div>
    </NextIntlClientProvider>,
  );
}

/** Point the mocked `useRunTrace` at BASE_TRACE with the given overrides applied. */
function mockTrace(overrides: Partial<RunTrace> = {}) {
  vi.mocked(useRunTrace).mockReturnValue({ data: { ...BASE_TRACE, ...overrides }, isLoading: false } as any);
}

beforeEach(() => {
  mockTrace();
});

describe("A5 Run Trace drawer (smoke)", () => {
  it("renders the trace tabs and stats", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.getByText("Configuration")).toBeInTheDocument();
    expect(screen.getByText("Stats")).toBeInTheDocument();
    expect(screen.getByText("2/2 passed")).toBeInTheDocument();
    expect(screen.getByText("Tool calls")).toBeInTheDocument();
  });

  it("switches to the live log tab", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("log"));
    // LiveLogStream renders its filter input
    expect(screen.getByPlaceholderText("Filter log…")).toBeInTheDocument();
  });
});

describe("Configuration section — specs_read / specs_missing / prompt_assembly.specs", () => {
  it("renders each specs_read path in the Specs read row (AC-25)", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    const readRow = screen.getByTestId("specs-read-row");
    expect(within(readRow).getByText("specs/a.md")).toBeInTheDocument();
  });

  it("renders specs_missing as a row distinct from Specs read (AC-26)", () => {
    mockTrace({ specs_missing: ["specs/gone.md"] });
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);

    const missingRow = screen.getByTestId("specs-missing-row");
    expect(within(missingRow).getByText("specs/gone.md")).toBeInTheDocument();

    // Structurally distinct: a separate row element from "Specs read", and the
    // missing path does not also leak into the read row.
    const readRow = screen.getByTestId("specs-read-row");
    expect(missingRow).not.toBe(readRow);
    expect(within(readRow).queryByText("specs/gone.md")).not.toBeInTheDocument();
  });

  it("renders no specs_missing row when the array is empty", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    expect(screen.queryByTestId("specs-missing-row")).not.toBeInTheDocument();
  });

  it("renders the expandable Project context prompt-assembly block when prompt_assembly.specs is set (AC-27)", () => {
    renderWithIntl(<RunTraceDrawer runId="r1" agentName="Security" prNumber={482} onClose={() => {}} />);
    fireEvent.click(screen.getByText("Prompt assembly"));
    expect(screen.getByText("Project context (dynamic)")).toBeInTheDocument();
  });
});
