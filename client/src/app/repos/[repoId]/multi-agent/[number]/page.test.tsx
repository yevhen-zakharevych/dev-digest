import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { AgentColumn, MultiAgentRun, PrMeta } from "@devdigest/shared";
import runsMessages from "../../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../../messages/en/prReview.json";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "repo-1", number: "42" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
// The app chrome is irrelevant to these assertions and drags in the command
// palette + global shortcuts — stub it to a passthrough.
vi.mock("@/components/app-shell/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/lib/hooks/core", () => ({ usePulls: vi.fn() }));
vi.mock("@/lib/hooks/multi-agent-runs", () => ({ useLatestMultiRun: vi.fn() }));
vi.mock("@/lib/hooks/reviews", () => ({ usePrReviews: vi.fn(), useFindingAction: vi.fn() }));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: { full_name: "acme/app" } }),
  useRepoNotFound: () => false,
}));

import { usePulls } from "@/lib/hooks/core";
import { useLatestMultiRun } from "@/lib/hooks/multi-agent-runs";
import { usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import MultiAgentResultsPage from "./page";

// FindingCard's deep-link effect calls scrollIntoView, which jsdom lacks.
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

const PR = { id: "pr-1", number: 42, title: "Harden the auth boundary", head_sha: "abc123" } as PrMeta;

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
    duration_ms: 8200,
    cost_usd: 0.01,
    findings: [],
    ...o,
  };
}

function multiRun(o: Partial<MultiAgentRun> = {}): MultiAgentRun {
  const columns = o.columns ?? [column({ agent_id: "a" }), column({ agent_id: "b" })];
  return {
    id: "mr-1",
    pr_id: "pr-1",
    ran_at: "2026-07-21T00:00:00.000Z",
    agent_count: columns.length,
    total_duration_ms: 12000,
    total_cost_usd: 0.042,
    conflicts: [],
    ...o,
    columns,
  };
}

beforeEach(() => {
  vi.mocked(usePulls).mockReturnValue({ data: [PR], isLoading: false } as never);
  vi.mocked(usePrReviews).mockReturnValue({ data: [], isLoading: false } as never);
  vi.mocked(useFindingAction).mockReturnValue({ mutate: vi.fn(), isPending: false } as never);
});

function setRun(run: MultiAgentRun | null, extra: Record<string, unknown> = {}) {
  vi.mocked(useLatestMultiRun).mockReturnValue({
    data: run,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    ...extra,
  } as never);
}

function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
      <MultiAgentResultsPage />
    </NextIntlClientProvider>,
  );
}

describe("Multi-Agent results header (AC-14)", () => {
  it("renders the PR title, the N-selected-agents line and the totals summary", () => {
    setRun(multiRun());
    renderPage();
    expect(screen.getByText("Harden the auth boundary")).toBeInTheDocument();
    expect(screen.getByTestId("selected-agents")).toHaveTextContent("2 selected agents");
    expect(screen.getByTestId("selected-agents")).toHaveTextContent("sequential");
    expect(screen.getByTestId("run-meta")).toHaveTextContent("2 agents");
  });

  /* The copy must describe how `modules/reviews/run-executor.ts:129` actually
     behaves — a sequential `for … await`. It advertised neither worktrees (never
     implemented) nor p-queue (a real dependency, but wired only into
     `platform/jobs.ts` and `repo-intel`, never into the review fan-out). */
  it("describes the run as sequential and advertises neither worktrees nor p-queue", () => {
    setRun(multiRun());
    const { container } = renderPage();
    expect(screen.getByTestId("run-meta")).toHaveTextContent("one at a time");
    expect(container.textContent).not.toMatch(/worktree/i);
    expect(container.textContent).not.toMatch(/p-queue/i);
    expect(container.textContent).not.toMatch(/parallel/i);
  });

  it("offers a Configure-run control pointing at the configure page", () => {
    setRun(multiRun());
    renderPage();
    const link = screen.getByRole("link", { name: /configure run/i });
    expect(link).toHaveAttribute("href", "/repos/repo-1/multi-agent");
  });

  it("has no display-mode toggle — Columns is the only v1 mode", () => {
    setRun(multiRun());
    renderPage();
    expect(screen.queryByText(runsMessages.page.view.columns)).not.toBeInTheDocument();
    expect(screen.queryByText(runsMessages.page.view.tabs)).not.toBeInTheDocument();
  });

  it("renders the first-run empty state (not a 404, not a blank area) when the PR has no multi-run", () => {
    setRun(null);
    renderPage();
    const empty = screen.getByTestId("no-run-empty");
    expect(within(empty).getByText(runsMessages.page.noRun.title)).toBeInTheDocument();
    expect(screen.queryByTestId("agent-columns")).not.toBeInTheDocument();
  });
});

describe("Multi-Agent results — live status (AC-16, asserting the transition, not the transport)", () => {
  it("moves a running column to its terminal status with no user action, from the poll's next payload", () => {
    setRun(multiRun({ columns: [column({ agent_id: "a", status: "running", score: null })] }));
    const { rerender } = renderPage();
    expect(screen.getByTestId("agent-status")).toHaveTextContent("running");
    // A null score on a non-terminal run renders blank, never 0 (AC-15).
    expect(screen.queryByTestId("agent-score")).not.toBeInTheDocument();

    // Next poll tick: the same component tree, new data, no interaction.
    setRun(multiRun({ columns: [column({ agent_id: "a", status: "done", score: 81 })] }));
    rerender(
      <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
        <MultiAgentResultsPage />
      </NextIntlClientProvider>,
    );

    expect(screen.getByTestId("agent-status")).toHaveTextContent("done");
    expect(screen.getByTestId("agent-score")).toBeInTheDocument();
  });
});

describe("Multi-Agent results — opening a finding (AC-17)", () => {
  it("shows the shared FindingCard detail only once a column finding is opened", () => {
    setRun(
      multiRun({
        columns: [
          column({
            agent_id: "a",
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
          }),
        ],
      }),
    );
    renderPage();
    expect(screen.queryByTestId("finding-detail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("column-finding"));

    // Reviews payload is empty here, so the panel renders its fallback rather
    // than crashing — the AC-17 "id absent / not loaded" branch.
    const panel = screen.getByTestId("finding-detail");
    expect(within(panel).getByText(runsMessages.page.finding.unavailable)).toBeInTheDocument();
  });
});
