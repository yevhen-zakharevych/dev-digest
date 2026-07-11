import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BriefResponse } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

// House style for a card whose data comes from `lib/hooks/*` (see
// ReviewFocusCard.test.tsx / client/INSIGHTS.md:97): mock the hooks module
// directly rather than standing up a real QueryClient + fetch mock.
vi.mock("@/lib/hooks/brief", () => ({
  usePrBrief: vi.fn(),
}));

import { usePrBrief } from "@/lib/hooks/brief";
import { RiskAreasCard } from "./RiskAreasCard";

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
      what: "Adds rate limiting to public API endpoints.",
      why: "Prevent abuse from unauthenticated clients.",
      risk_level: "medium",
      risks: [
        {
          title: "Auth surface touched",
          explanation: "The new middleware sits in front of every public route.",
          severity: "high",
          references: [{ file: "src/middleware/ratelimit.ts", line: 12 }],
        },
        {
          title: "Adds Redis round-trip per request",
          explanation: "Every request now does a synchronous Redis call.",
          severity: "medium",
          references: [
            { file: "src/middleware/ratelimit.ts", line: 40 },
            { file: "src/middleware/ratelimit.ts", line: 52 },
            "POST /api/public/*",
          ],
        },
      ],
      review_focus: [],
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

describe("RiskAreasCard", () => {
  it("renders the heading, a count badge, and each risk's title", () => {
    mockBrief(briefResponse());
    renderWithIntl(<RiskAreasCard prId="pr1" onOpenFile={vi.fn()} />);

    expect(screen.getByText("Risk areas")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Auth surface touched")).toBeInTheDocument();
    expect(screen.getByText("Adds Redis round-trip per request")).toBeInTheDocument();
  });

  it("shows the file:line reference chip(s) even while the row is collapsed", () => {
    mockBrief(briefResponse());
    renderWithIntl(<RiskAreasCard prId="pr1" onOpenFile={vi.fn()} />);

    const row = screen.getByText("Auth surface touched").closest("details") as HTMLDetailsElement;
    expect(row.open).toBe(false);
    expect(
      within(row).getByRole("button", { name: "src/middleware/ratelimit.ts:12" }),
    ).toBeInTheDocument();
  });

  it("renders one chip per reference, including a bare endpoint string as a static (non-clickable) chip", () => {
    mockBrief(briefResponse());
    renderWithIntl(<RiskAreasCard prId="pr1" onOpenFile={vi.fn()} />);

    const row = screen
      .getByText("Adds Redis round-trip per request")
      .closest("details") as HTMLDetailsElement;
    const scoped = within(row);
    expect(scoped.getByRole("button", { name: "src/middleware/ratelimit.ts:40" })).toBeInTheDocument();
    expect(scoped.getByRole("button", { name: "src/middleware/ratelimit.ts:52" })).toBeInTheDocument();
    expect(scoped.getByText("POST /api/public/*")).toBeInTheDocument();
    expect(scoped.queryByRole("button", { name: "POST /api/public/*" })).not.toBeInTheDocument();
  });

  it("opens the file in-app on chip click, without toggling the row open", () => {
    mockBrief(briefResponse());
    const onOpenFile = vi.fn();
    renderWithIntl(<RiskAreasCard prId="pr1" onOpenFile={onOpenFile} />);

    const row = screen.getByText("Auth surface touched").closest("details") as HTMLDetailsElement;
    fireEvent.click(within(row).getByRole("button", { name: "src/middleware/ratelimit.ts:12" }));

    expect(onOpenFile).toHaveBeenCalledWith("src/middleware/ratelimit.ts");
    expect(row.open).toBe(false);
  });

  it("expands a row's explanation on summary click", () => {
    mockBrief(briefResponse());
    renderWithIntl(<RiskAreasCard prId="pr1" onOpenFile={vi.fn()} />);

    const row = screen.getByText("Auth surface touched").closest("details") as HTMLDetailsElement;
    expect(row.open).toBe(false);

    fireEvent.click(screen.getByText("Auth surface touched"));

    expect(row.open).toBe(true);
    expect(
      screen.getByText("The new middleware sits in front of every public route."),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is no brief yet", () => {
    mockBrief(undefined);
    const { container } = renderWithIntl(<RiskAreasCard prId="pr1" onOpenFile={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the brief has no risks", () => {
    mockBrief(briefResponse({ brief: { ...briefResponse().brief!, risks: [] } }));
    const { container } = renderWithIntl(<RiskAreasCard prId="pr1" onOpenFile={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
  });
});
