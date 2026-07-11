import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

// House style for a card whose data comes from `lib/hooks/*` (IntentCard.test.tsx /
// BlastRadiusCard.test.tsx): mock the hooks module directly rather than standing
// up a real QueryClient + fetch mock.
vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: vi.fn(),
}));

import { usePrBrief } from "@/lib/hooks/brief";
import { ReviewFocusCard } from "./ReviewFocusCard";

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

function mockBrief(data: BriefResponse | undefined) {
  vi.mocked(usePrBrief).mockReturnValue({ data, isLoading: false } as any);
}

describe("ReviewFocusCard", () => {
  it("renders the heading + a count badge, and the file:line list with its reason", () => {
    mockBrief(briefResponse());
    renderWithIntl(<ReviewFocusCard prId="pr1" onOpenFile={vi.fn()} />);

    expect(screen.getByText("Review focus — read these first")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "src/modules/reviews/service.ts:42" }),
    ).toBeInTheDocument();
    // Reason renders inline after the file:line link, em-dash separated.
    expect(screen.getByText(/Core pagination logic\./)).toBeInTheDocument();
  });

  it("opens the file in-app on click", () => {
    mockBrief(briefResponse());
    const onOpenFile = vi.fn();
    renderWithIntl(<ReviewFocusCard prId="pr1" onOpenFile={onOpenFile} />);

    fireEvent.click(screen.getByRole("button", { name: "src/modules/reviews/service.ts:42" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/modules/reviews/service.ts");
  });

  it("renders nothing when there is no brief yet", () => {
    mockBrief(undefined);
    const { container } = renderWithIntl(<ReviewFocusCard prId="pr1" onOpenFile={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the brief has no review_focus items", () => {
    mockBrief(briefResponse({ brief: { ...briefResponse().brief!, review_focus: [] } }));
    const { container } = renderWithIntl(<ReviewFocusCard prId="pr1" onOpenFile={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
