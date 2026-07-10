import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefResponse, FindingRecord, ReviewRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

// House style for a card whose data comes from `lib/hooks/*` (IntentCard.test.tsx /
// BlastRadiusCard.test.tsx): mock the hooks modules directly rather than standing
// up a real QueryClient + fetch mock.
vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: vi.fn(),
  useGenerateBrief: vi.fn(),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(),
}));

import { usePrBrief, useGenerateBrief } from "@/lib/hooks/brief";
import { usePrReviews } from "@/lib/hooks/reviews";
import { PrBriefCard } from "./PrBriefCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function briefResponse(o: Partial<BriefResponse> = {}): BriefResponse {
  return {
    status: "fresh",
    brief: {
      what: "Adds pagination controls to the repos list.",
      why: "Reviewers asked for it in the linked issue.",
      risk_level: "medium",
      risks: [],
      review_focus: [
        { file: "src/modules/reviews/service.ts", line: 42, reason: "Core pagination logic." },
      ],
    },
    head_sha: "deadbeef",
    generated_at: "2026-07-10T00:00:00.000Z",
    cost: { usd: 0.0123, tokens_in: 8200, tokens_out: 1300, model: "openai/gpt-4.1" },
    ...o,
  };
}

function findingRecord(o: Partial<FindingRecord> = {}): FindingRecord {
  return {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A live key is committed in source.",
    suggestion: null,
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "review1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function reviewRecord(o: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "review1",
    pr_id: "pr1",
    agent_id: "agent1",
    run_id: "run1",
    agent_name: "Security Reviewer",
    kind: "review",
    verdict: "comment",
    summary: "Looks fine.",
    score: 82,
    model: "openai/gpt-4.1",
    created_at: "2026-07-10T00:00:00.000Z",
    findings: [],
    ...o,
  };
}

function mockHooks({
  data,
  isLoading = false,
  reviews = [],
  mutate = vi.fn(),
  isPending = false,
}: {
  data?: BriefResponse;
  isLoading?: boolean;
  reviews?: ReviewRecord[];
  mutate?: ReturnType<typeof vi.fn>;
  isPending?: boolean;
} = {}) {
  vi.mocked(usePrBrief).mockReturnValue({ data, isLoading } as any);
  vi.mocked(useGenerateBrief).mockReturnValue({ mutate, isPending } as any);
  vi.mocked(usePrReviews).mockReturnValue({ data: reviews, isLoading: false } as any);
  return { mutate };
}

describe("PrBriefCard", () => {
  it("shows a loading skeleton and no crash while the brief is still loading", () => {
    mockHooks({ isLoading: true, data: undefined });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("PR Brief")).toBeInTheDocument();
    expect(screen.queryByText("Adds pagination controls to the repos list.")).not.toBeInTheDocument();
  });

  it("renders a Generate prompt for a never-generated PR (AC-17)", () => {
    const { mutate } = mockHooks({ data: { status: "not_generated" } });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("No brief yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Generate brief" }));
    expect(mutate).toHaveBeenCalledWith({ prId: "pr1", force: false });
  });

  it("renders the risk banner with a color AND a text label, and the what/why summary (AC-10/AC-12)", () => {
    mockHooks({ data: briefResponse() });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    const banner = screen.getByTestId("pr-brief-risk-banner");
    expect(banner).toHaveTextContent("Medium risk");
    expect(banner.style.color).toBe("var(--warn)");
    expect(screen.getByText("Adds pagination controls to the repos list.")).toBeInTheDocument();
    expect(screen.getByText("Reviewers asked for it in the linked issue.")).toBeInTheDocument();
  });

  it("renders the brief call's own cost/token readout via RunCostBadge (AC-10)", () => {
    mockHooks({ data: briefResponse() });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("$0.012 · 8.2K→1.3K")).toBeInTheDocument();
  });

  it("renders risk_level independently, with NO score ring, when no completed review exists (AC-11)", () => {
    mockHooks({ data: briefResponse(), reviews: [] });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("Medium risk")).toBeInTheDocument();
    expect(screen.queryByText("Review score")).not.toBeInTheDocument();
  });

  it("renders the score ring alongside the independent risk_level only when a completed review has a score (AC-11)", () => {
    mockHooks({ data: briefResponse(), reviews: [reviewRecord({ score: 82 })] });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("Medium risk")).toBeInTheDocument();
    expect(screen.getByText("82")).toBeInTheDocument();
    expect(screen.getByText("Review score")).toBeInTheDocument();
  });

  it("renders no score ring when the latest review run has a null score (mirrors VerdictBanner's score != null guard, AC-11)", () => {
    mockHooks({ data: briefResponse(), reviews: [reviewRecord({ score: null })] });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.queryByText("Review score")).not.toBeInTheDocument();
  });

  it("renders a findings/blockers meta line derived from the latest run (mirrors ReviewRunAccordion's blocking-severity derivation)", () => {
    mockHooks({
      data: briefResponse(),
      reviews: [
        reviewRecord({
          score: 82,
          findings: [
            findingRecord({ id: "f1", severity: "CRITICAL" }),
            findingRecord({ id: "f2", severity: "WARNING" }),
          ],
        }),
      ],
    });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("2 findings · 1 blocker")).toBeInTheDocument();
  });

  it("renders a stale marker and still shows the stored brief when the PR head has advanced (AC-14)", () => {
    mockHooks({ data: briefResponse({ status: "stale" }) });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("Stale — PR has new commits")).toBeInTheDocument();
    expect(screen.getByText("Adds pagination controls to the repos list.")).toBeInTheDocument();
  });

  it("maps a known degraded_reason to its i18n message and preserves the prior brief (AC-16)", () => {
    mockHooks({
      data: briefResponse({ status: "degraded", degraded_reason: "model_failed" }),
    });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("Degraded", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("The model call failed. Try regenerating.", { exact: false })).toBeInTheDocument();
    // Prior brief content is still rendered, not replaced by an error screen.
    expect(screen.getByText("Adds pagination controls to the repos list.")).toBeInTheDocument();
  });

  it("falls back to the raw reason code for an unmapped degraded_reason, never MISSING_MESSAGE", () => {
    mockHooks({
      data: briefResponse({ status: "degraded", degraded_reason: "some_future_reason" as any }),
    });
    expect(() =>
      renderWithIntl(<PrBriefCard prId="pr1" />),
    ).not.toThrow();

    expect(screen.getByText("some_future_reason", { exact: false })).toBeInTheDocument();
  });

  it("shows a degraded empty-state (no crash) when the model call failed and no prior brief ever existed", () => {
    mockHooks({
      data: { status: "degraded", degraded_reason: "no_inputs" },
    });
    renderWithIntl(<PrBriefCard prId="pr1" />);

    expect(screen.getByText("Couldn't generate the brief")).toBeInTheDocument();
    expect(screen.getByText("Not enough information was available to generate a brief.")).toBeInTheDocument();
  });

  it("Regenerate posts {force:true} and disables the control while pending (AC-15)", () => {
    const { mutate } = mockHooks({ data: briefResponse() });
    const { rerender } = renderWithIntl(
      <PrBriefCard prId="pr1" />,
    );

    const button = screen.getByRole("button", { name: "Regenerate" });
    fireEvent.click(button);
    expect(mutate).toHaveBeenCalledWith({ prId: "pr1", force: true });

    vi.mocked(useGenerateBrief).mockReturnValue({ mutate, isPending: true } as any);
    rerender(
      <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
        <PrBriefCard prId="pr1" />
      </NextIntlClientProvider>,
    );

    const pendingButton = screen.getByRole("button", { name: "Regenerating…" });
    expect(pendingButton).toBeDisabled();
  });
});
