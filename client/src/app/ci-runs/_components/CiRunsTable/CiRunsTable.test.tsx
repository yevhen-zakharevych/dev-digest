import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CiRunRow } from "@/lib/hooks/ci-runs";
import messages from "../../../../../messages/en/ci.json";

// The mock factory can't close over `let` bindings declared after it (hoisting),
// so the mock reads these module-level vars at call time — same pattern as
// `EvalsTab.test.tsx`.
let mockRuns: CiRunRow[] | undefined;
let mockIsLoading = false;
let mockIsError = false;
let mockRefetch = vi.fn();
let mockRefreshMutate = vi.fn();
let mockRefreshPending = false;
let mockRefreshData: { runs: CiRunRow[]; failed: Array<{ repo: string; message: string }> } | undefined;

vi.mock("@/lib/hooks/ci-runs", () => ({
  useCiRuns: () => ({
    data: mockRuns,
    isLoading: mockIsLoading,
    isError: mockIsError,
    error: null,
    refetch: mockRefetch,
  }),
  useRefreshCiRuns: () => ({
    mutate: mockRefreshMutate,
    isPending: mockRefreshPending,
    data: mockRefreshData,
  }),
}));

import { CiRunsTable } from "./CiRunsTable";

afterEach(() => {
  cleanup();
  mockRuns = undefined;
  mockIsLoading = false;
  mockIsError = false;
  mockRefetch = vi.fn();
  mockRefreshMutate = vi.fn();
  mockRefreshPending = false;
  mockRefreshData = undefined;
});

function renderWithIntl() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
        <CiRunsTable />
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function makeRun(overrides: Partial<CiRunRow> = {}): CiRunRow {
  return {
    id: "run1",
    ci_installation_id: "inst1",
    pr_number: 42,
    ran_at: "2026-07-20T10:00:00.000Z",
    status: "succeeded",
    findings_count: 3,
    cost_usd: 0.12,
    repo: "acme/payments-api",
    github_url: "https://github.com/acme/payments-api/actions/runs/123",
    source: "github_actions",
    agent: "Security Reviewer",
    duration_s: 45.2,
    ...overrides,
  };
}

describe("CiRunsTable", () => {
  it("AC-39: no ingested runs renders the empty state, not a blank table or a spinner", () => {
    mockRuns = [];
    renderWithIntl();

    expect(screen.getByText("No CI runs yet")).toBeInTheDocument();
    expect(screen.getByText(/Once you export an agent to CI/)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("AC-40: a fully-populated row shows all eight values", () => {
    mockRuns = [makeRun()];
    renderWithIntl();

    const row = screen.getByTestId("ci-run-run1");
    const scoped = within(row);

    expect(scoped.getByText("#42")).toBeInTheDocument();
    expect(scoped.getByText("acme/payments-api")).toBeInTheDocument();
    // AC-35 render half: the agent string is rendered as plain text, not markup.
    expect(scoped.getByText("Security Reviewer")).toBeInTheDocument();
    expect(scoped.getByText("Succeeded")).toBeInTheDocument();
    expect(scoped.getByText("3")).toBeInTheDocument();
    expect(scoped.getByText("$0.12")).toBeInTheDocument();
    expect(scoped.getByText("45.2s")).toBeInTheDocument();
    const link = scoped.getByRole("link", { name: "View" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/payments-api/actions/runs/123");
  });

  it("AC-40/AC-35: a `failed` row with null metrics renders empty cells, never NaN/null/undefined", () => {
    mockRuns = [
      makeRun({
        id: "run2",
        status: "failed",
        findings_count: null,
        cost_usd: null,
        duration_s: null,
        agent: null,
        github_url: "https://github.com/acme/payments-api/actions/runs/999",
      }),
    ];
    renderWithIntl();

    const row = screen.getByTestId("ci-run-run2");
    const scoped = within(row);

    expect(scoped.getByText("Failed")).toBeInTheDocument();
    expect(scoped.queryByText("NaN")).not.toBeInTheDocument();
    expect(scoped.queryByText("null")).not.toBeInTheDocument();
    expect(scoped.queryByText("undefined")).not.toBeInTheDocument();
    // Every absent metric renders the same explicit dash.
    expect(scoped.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("AC-37: a partial refresh failure names the repo and does not blank the table", () => {
    mockRuns = [makeRun()];
    mockRefreshData = { runs: [], failed: [{ repo: "acme/other-repo", message: "access revoked" }] };
    renderWithIntl();

    expect(screen.getByText(/Could not refresh: acme\/other-repo/)).toBeInTheDocument();
    // The existing row is still there — a partial failure never blanks the table.
    expect(screen.getByTestId("ci-run-run1")).toBeInTheDocument();
  });

  it("Refresh only fires on an explicit press (AC-32 client half)", () => {
    mockRuns = [makeRun()];
    renderWithIntl();

    expect(mockRefreshMutate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mockRefreshMutate).toHaveBeenCalledTimes(1);
  });
});
