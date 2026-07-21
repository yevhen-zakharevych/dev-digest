import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord, ReviewRecord } from "@devdigest/shared";
import runsMessages from "../../../../../../../../messages/en/runs.json";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";

// House style: mock the hooks module the component consumes (client/INSIGHTS.md).
vi.mock("@/lib/hooks/reviews", () => ({
  usePrReviews: vi.fn(),
  useFindingAction: vi.fn(),
}));

import { usePrReviews, useFindingAction } from "@/lib/hooks/reviews";
import { FindingDetailPanel } from "./FindingDetailPanel";

// FindingCard's deep-link effect calls scrollIntoView, which jsdom lacks.
Element.prototype.scrollIntoView = vi.fn();

afterEach(cleanup);

function finding(o: Partial<FindingRecord> & Pick<FindingRecord, "id">): FindingRecord {
  return {
    severity: "CRITICAL",
    category: "security",
    title: `Title ${o.id}`,
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "Because.",
    suggestion: "Do the other thing.",
    confidence: 0.9,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

function review(id: string, findings: FindingRecord[]): ReviewRecord {
  return {
    id,
    run_id: `run-${id}`,
    pr_id: "pr-1",
    agent_id: `agent-${id}`,
    agent_name: `Agent ${id}`,
    verdict: "comment",
    score: 70,
    summary: null,
    ran_at: "2026-07-21T00:00:00.000Z",
    findings,
  } as unknown as ReviewRecord;
}

const mutate = vi.fn();

beforeEach(() => {
  mutate.mockClear();
  vi.mocked(useFindingAction).mockReturnValue({ mutate, isPending: false } as never);
});

function setReviews(data: ReviewRecord[] | undefined, isLoading = false) {
  vi.mocked(usePrReviews).mockReturnValue({ data, isLoading } as never);
}

function renderPanel(findingId = "f1") {
  render(
    <NextIntlClientProvider locale="en" messages={{ runs: runsMessages, prReview: prReviewMessages }}>
      <FindingDetailPanel prId="pr-1" findingId={findingId} onClose={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

describe("FindingDetailPanel — client-side join on finding id (AC-17)", () => {
  it("renders the EXISTING FindingCard for the joined record (confidence + suggestion + actions)", () => {
    setReviews([review("a", [finding({ id: "f1" })])]);
    renderPanel("f1");
    expect(screen.getByText("Title f1")).toBeInTheDocument();
    expect(screen.getByText("Do the other thing.")).toBeInTheDocument();
    // FindingCard's own ConfidenceNum rendering — proves it IS that component,
    // not a clone. `confidence` is one of the fields AgentColumnFinding lacks,
    // so its presence also proves the join against the reviews payload ran.
    expect(screen.getByText(/% conf$/)).toBeInTheDocument();
    expect(screen.getByText("Accept")).toBeInTheDocument();
    expect(screen.getByText("Dismiss")).toBeInTheDocument();
  });

  it("renders a loading state, never a crash, while the reviews payload is in flight", () => {
    setReviews(undefined, true);
    renderPanel("f1");
    expect(screen.getByText(runsMessages.page.finding.loading)).toBeInTheDocument();
  });

  it("renders a fallback, never a crash, when the id is absent from the reviews payload", () => {
    setReviews([review("a", [finding({ id: "other" })])]);
    renderPanel("f1");
    expect(screen.getByText(runsMessages.page.finding.unavailable)).toBeInTheDocument();
  });
});

describe("FindingDetailPanel — actions (AC-18, AC-19)", () => {
  it("persists Accept/Dismiss for exactly that finding id", () => {
    setReviews([review("a", [finding({ id: "f1" })]), review("b", [finding({ id: "f2" })])]);
    renderPanel("f1");

    fireEvent.click(screen.getByText("Accept"));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "accept", prId: "pr-1" });

    fireEvent.click(screen.getByText("Dismiss"));
    expect(mutate).toHaveBeenCalledWith({ findingId: "f1", action: "dismiss", prId: "pr-1" });

    // The co-located finding of another agent is never targeted.
    expect(mutate.mock.calls.every(([arg]) => arg.findingId === "f1")).toBe(true);
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("reflects a persisted verdict from the joined record without a manual refresh", () => {
    setReviews([review("a", [finding({ id: "f1", accepted_at: "2026-07-21T00:00:00.000Z" })])]);
    renderPanel("f1");
    expect(screen.getByText(prReviewMessages.finding.accepted)).toBeInTheDocument();
  });

  it("is INERT for every non accept/dismiss action — no request, no state change (AC-19)", () => {
    setReviews([
      review("a", [finding({ id: "f1", accepted_at: "2026-07-21T00:00:00.000Z" })]),
    ]);
    renderPanel("f1");

    // "Turn into eval case" is enabled only for a decided finding — this one is
    // accepted, so the button is live and still must do nothing here.
    const seed = screen.getByText(prReviewMessages.finding.turnIntoEvalCase);
    fireEvent.click(seed);
    expect(mutate).not.toHaveBeenCalled();
  });
});
