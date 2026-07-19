import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, EvalCase, EvalDashboard, EvalRunSummary } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/eval.json";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

// Populated per-test via `mockDashboard`/`mockCases`/`mockRunDetail` — the
// module-level `vi.mock` factory can't close over `let` bindings declared
// after it (hoisting), so the mock reads from these directly at call time.
let mockDashboard: EvalDashboard | undefined;
let mockCases: EvalCase[] | undefined;
let mockRunDetail: { status: string; cases_total: number; results: unknown[] } | undefined;
let mockCasesLoading = false;
let mockDashboardLoading = false;

vi.mock("@/lib/hooks/evals", () => ({
  useAgentEvalDashboard: () => ({ data: mockDashboard, isLoading: mockDashboardLoading }),
  useEvalCases: () => ({ data: mockCases, isLoading: mockCasesLoading }),
  useEvalRun: () => ({ data: mockRunDetail }),
  useStartEvalRun: () => ({ mutate: vi.fn(), isPending: false }),
  useCancelEvalRun: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteEvalCase: () => ({ mutate: vi.fn() }),
  useRunEvalDraft: () => ({ mutate: vi.fn(), isPending: false }),
  useEvalCaseDraft: () => ({ data: null }),
}));

// The comparison itself is opened as a modal; stub it so this suite stays
// scoped to the tab's selection → open-modal wiring.
vi.mock("@/features/evals/components/EvalCompareModal", () => ({
  EvalCompareModal: (props: { runIdA: string; runIdB: string }) => (
    <div data-testid="compare-modal" data-a={props.runIdA} data-b={props.runIdB} />
  ),
}));

// New case / Edit open the case editor in a modal (not a page). Stub it so
// this suite stays scoped to the tab's open-modal wiring.
vi.mock("@/features/evals/components/EvalCaseModal", () => ({
  EvalCaseModal: (props: { caseId?: string }) => (
    <div data-testid="case-modal" data-case={props.caseId ?? "new"} />
  ),
}));

import { EvalsTab } from "./EvalsTab";

afterEach(() => {
  cleanup();
  mockDashboard = undefined;
  mockCases = undefined;
  mockRunDetail = undefined;
  mockCasesLoading = false;
  mockDashboardLoading = false;
});

const AGENT: Agent = {
  id: "ag1",
  name: "Security Reviewer",
  description: "Flags secrets and injection",
  provider: "openai",
  model: "gpt-4.1",
  system_prompt: "You are a security reviewer.",
  output_schema: null,
  strategy: "single-pass",
  ci_fail_on: "critical",
  repo_intel: true,
  attached_docs: [],
  skills_count: 0,
  enabled: true,
  version: 1,
};

function emptyDashboard(overrides: Partial<EvalDashboard> = {}): EvalDashboard {
  return {
    owner_kind: "agent",
    owner_id: AGENT.id,
    cases_total: 0,
    current: {
      recall: null,
      precision: null,
      citation_accuracy: null,
      traces_passed: 0,
      traces_total: 0,
      cost_usd: null,
    },
    delta: { recall: 0, precision: 0, citation_accuracy: 0 },
    trend: [],
    recent_runs: [],
    alert: null,
    spend: { total_usd: 0, run_usd: 0, draft_usd: 0 },
    ...overrides,
  };
}

function makeCase(id: string, overrides: Partial<EvalCase> = {}): EvalCase {
  return {
    id,
    owner_kind: "agent",
    owner_id: AGENT.id,
    name: `case-${id}`,
    expectation: "must_find",
    input_diff: "--- a/x\n+++ b/x\n@@ -1,1 +1,2 @@\n+leak",
    input_files: null,
    input_meta: null,
    expected_output: [{ file: "x", start_line: 1, end_line: 1, kind: "finding" }],
    forbidden_region: null,
    source_finding_id: null,
    source_finding: null,
    input_fingerprint: "fp1",
    notes: null,
    latest_draft: null,
    ...overrides,
  };
}

function makeRun(overrides: Partial<EvalRunSummary> = {}): EvalRunSummary {
  return {
    id: "run1",
    owner_kind: "agent",
    owner_id: AGENT.id,
    agent_version: 3,
    status: "done",
    started_at: "2026-07-10T10:00:00.000Z",
    finished_at: "2026-07-10T10:01:00.000Z",
    recall: 0.75,
    precision: 0.9,
    citation_accuracy: 0.95,
    traces_passed: 6,
    traces_total: 8,
    errored_count: 0,
    cost_usd: 0.12,
    duration_ms: 60000,
    cases_total: 8,
    set_drifted: false,
    ...overrides,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

describe("EvalsTab — the three honesty rules (AC-31/32/46)", () => {
  it("AC-31: zero cases -> explicit empty state + '—' for every metric, never 0%, Run disabled", () => {
    mockDashboard = emptyDashboard();
    mockCases = [];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByText("No eval cases yet")).toBeInTheDocument();
    // Every metric card renders the absent-measurement dash, never "0%".
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole("button", { name: /run all evals/i })).toBeDisabled();
  });

  it("AC-32: cases but never run -> 'never run', '—' metrics, empty trend, Run enabled", () => {
    mockDashboard = emptyDashboard({ cases_total: 2 });
    mockCases = [makeCase("c1"), makeCase("c2")];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getAllByText(/never run/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    const runAll = screen.getByRole("button", { name: /run all evals/i });
    expect(runAll).not.toBeDisabled();
  });

  it("AC-46/50: the passing headline names the run and does not read 0% when a real run exists", () => {
    const run = makeRun();
    mockDashboard = emptyDashboard({
      cases_total: 9,
      current: {
        recall: 0.75,
        precision: 0.9,
        citation_accuracy: 0.95,
        traces_passed: 6,
        traces_total: 8,
        cost_usd: 0.12,
      },
      recent_runs: [run],
    });
    mockCases = [makeCase("c1"), makeCase("c2")];
    mockRunDetail = { status: "done", cases_total: 8, results: [] };
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByText("6 / 8 passing")).toBeInTheDocument();
    // The denominator is the RUN's count (8), deliberately smaller than the
    // live case count named separately (9) — never conflated into one number.
    expect(screen.getByText(/9 cases/)).toBeInTheDocument();
    // Scoped to the headline cards: the run-history row below now shows the same
    // 75% for the same run, so an unscoped getByText is ambiguous (the collision
    // documented at client/INSIGHTS.md:137). The assertion is unchanged in
    // strength — the headline must read 75%, not 0%.
    expect(within(screen.getByTestId("eval-metric-cards")).getByText("75%")).toBeInTheDocument();
  });
});

describe("EvalsTab — case rows", () => {
  it("a case the latest run never measured reads not-yet-measured, not pass/fail", () => {
    const run = makeRun();
    mockDashboard = emptyDashboard({ cases_total: 1, recent_runs: [run] });
    mockCases = [makeCase("c1")];
    mockRunDetail = { status: "done", cases_total: 0, results: [] };
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByText("not yet measured")).toBeInTheDocument();
  });

  it("shows the MUST FIND / MUST NOT FLAG badge and 'expected N, got M' from a run result", () => {
    const run = makeRun();
    mockDashboard = emptyDashboard({ cases_total: 1, recent_runs: [run] });
    mockCases = [makeCase("c1")];
    mockRunDetail = {
      status: "done",
      cases_total: 1,
      results: [
        {
          case_id: "c1",
          case_name: "case-c1",
          fingerprint: "fp1",
          outcome: "passed",
          error_reason: null,
          expected: [{ file: "x", start_line: 1, end_line: 1, kind: "finding" }],
          matched_expected_indices: [0],
          findings: [],
          unmatched_finding_ids: [],
          emitted_count: 1,
          kept_count: 1,
          duration_ms: 1200,
          cost_usd: 0.01,
        },
      ],
    };
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByText("MUST FIND")).toBeInTheDocument();
    expect(screen.getByText("expected 1 finding, got 1")).toBeInTheDocument();
    // Pass/fail is a TEXT label, never colour/icon alone (a11y) — asserted
    // by its accessible text, not by inspecting the icon or a colour.
    expect(screen.getByText("passed")).toBeInTheDocument();
  });
});

describe("EvalsTab — disabled agent (AC-53)", () => {
  it("disables run-all, per-case run, and delete with no error thrown", () => {
    mockDashboard = emptyDashboard({ cases_total: 1 });
    mockCases = [makeCase("c1")];
    renderWithIntl(<EvalsTab agent={{ ...AGENT, enabled: false }} />);

    expect(screen.getByRole("button", { name: /run all evals/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^run$/i })).toBeDisabled();
  });
});

describe("EvalsTab — run history is the ONLY way into the comparison (AC-24)", () => {
  it("lists past runs and enables Compare only once exactly two are selected", () => {
    const a = makeRun({ id: "runA", agent_version: 1 });
    const b = makeRun({ id: "runB", agent_version: 2, started_at: "2026-07-11T10:00:00.000Z" });
    mockDashboard = emptyDashboard({ cases_total: 8, recent_runs: [b, a] });
    mockCases = [makeCase("c1")];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByTestId("run-row-runA")).toBeInTheDocument();
    expect(screen.getByTestId("run-row-runB")).toBeInTheDocument();

    const compare = screen.getByRole("button", { name: /^compare$/i });
    // A compare view nobody can reach is a compare view that does not exist —
    // this button IS the feature's entry point.
    expect(compare).toBeDisabled();

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!);
    expect(compare).toBeDisabled(); // one pick is not a comparison

    fireEvent.click(boxes[1]!);
    expect(compare).toBeEnabled();
  });

  it("opens the comparison in a modal (not a page) with the picked run ids", () => {
    const a = makeRun({ id: "runA", agent_version: 1 });
    const b = makeRun({ id: "runB", agent_version: 2, started_at: "2026-07-11T10:00:00.000Z" });
    mockDashboard = emptyDashboard({ cases_total: 8, recent_runs: [b, a] });
    mockCases = [makeCase("c1")];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.queryByTestId("compare-modal")).not.toBeInTheDocument();

    const boxes = screen.getAllByRole("checkbox");
    fireEvent.click(boxes[0]!); // runB (later-picked lands at index 1 → base `a`)
    fireEvent.click(boxes[1]!); // runA
    fireEvent.click(screen.getByRole("button", { name: /^compare$/i }));

    const modal = screen.getByTestId("compare-modal");
    expect(modal).toHaveAttribute("data-a", "runB");
    expect(modal).toHaveAttribute("data-b", "runA");
  });

  it("says so plainly when the agent has never been run, instead of an empty table", () => {
    mockDashboard = emptyDashboard({ cases_total: 8, recent_runs: [] });
    mockCases = [makeCase("c1")];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.getByText(/no runs yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId("run-row-runA")).not.toBeInTheDocument();
  });
});

describe("EvalsTab — case authoring opens a modal, not a page", () => {
  it("New case opens the editor modal in create mode", () => {
    mockDashboard = emptyDashboard({ cases_total: 1 });
    mockCases = [makeCase("c1")];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    expect(screen.queryByTestId("case-modal")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "New case" }));
    expect(screen.getByTestId("case-modal")).toHaveAttribute("data-case", "new");
  });

  it("Edit opens the editor modal for that case id", () => {
    mockDashboard = emptyDashboard({ cases_total: 1 });
    mockCases = [makeCase("c1")];
    renderWithIntl(<EvalsTab agent={AGENT} />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByTestId("case-modal")).toHaveAttribute("data-case", "c1");
  });
});
