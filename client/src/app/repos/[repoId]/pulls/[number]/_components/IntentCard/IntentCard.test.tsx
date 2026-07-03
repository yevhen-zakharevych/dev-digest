import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrIntentRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/brief.json";

// House style for a card whose data comes from `lib/hooks/*` (see
// RunStatus.test.tsx / FindingsPanel.test.tsx / RunReviewDropdown.test.tsx):
// mock the hooks module directly rather than standing up a real QueryClient
// + fetch mock — this repo has no MSW/fetch-mock precedent for component tests.
vi.mock("@/lib/hooks/brief", () => ({
  usePrIntent: vi.fn(),
  useRecomputeIntent: vi.fn(),
}));

import { usePrIntent, useRecomputeIntent } from "@/lib/hooks/brief";
import { IntentCard } from "./IntentCard";

afterEach(cleanup);

// Test factory: EVERY required `PrIntentRecord` field must have a default
// (client/INSIGHTS.md:39-43) — a missing field surfaces as a misleading
// "two different types with this name exist" TS error, never widen the type.
function intentRecord(o: Partial<PrIntentRecord> = {}): PrIntentRecord {
  return {
    pr_id: "pr1",
    intent: "Add pagination controls to the repos list",
    in_scope: ["Add page query param", "Render Prev/Next buttons"],
    out_of_scope: ["Sorting", "Filtering by language"],
    ...o,
  };
}

function wrap(ui: React.ReactElement) {
  return (
    <NextIntlClientProvider locale="en" messages={{ brief: messages }}>
      {ui}
    </NextIntlClientProvider>
  );
}

function renderWithIntl(ui: React.ReactElement) {
  return render(wrap(ui));
}

describe("IntentCard", () => {
  it("shows a loading state with no crash and no recompute action yet", () => {
    vi.mocked(usePrIntent).mockReturnValue({ data: undefined, isLoading: true } as any);
    vi.mocked(useRecomputeIntent).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);

    renderWithIntl(<IntentCard prId="pr1" />);

    expect(screen.getByText("Intent")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("shows the unavailable copy and a working Recompute button when intent has not been computed yet", () => {
    const mutate = vi.fn();
    vi.mocked(usePrIntent).mockReturnValue({ data: null, isLoading: false } as any);
    vi.mocked(useRecomputeIntent).mockReturnValue({ mutate, isPending: false } as any);

    renderWithIntl(<IntentCard prId="pr1" />);

    expect(screen.getByText("Brief not available yet.")).toBeInTheDocument();
    expect(screen.getByText("Run a review or open the PR to compute it.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));
    expect(mutate).toHaveBeenCalledWith({ prId: "pr1" });
  });

  it("renders the summary quote and the IN SCOPE / OUT OF SCOPE lists when intent is populated", () => {
    vi.mocked(usePrIntent).mockReturnValue({ data: intentRecord(), isLoading: false } as any);
    vi.mocked(useRecomputeIntent).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);

    renderWithIntl(<IntentCard prId="pr1" />);

    expect(screen.getByText(/Add pagination controls to the repos list/)).toBeInTheDocument();
    expect(screen.getByText("Add page query param")).toBeInTheDocument();
    expect(screen.getByText("Render Prev/Next buttons")).toBeInTheDocument();
    expect(screen.getByText("Sorting")).toBeInTheDocument();
    expect(screen.getByText("Filtering by language")).toBeInTheDocument();
  });

  it("renders the em-dash placeholder without crashing when in_scope/out_of_scope are empty", () => {
    vi.mocked(usePrIntent).mockReturnValue({
      data: intentRecord({ in_scope: [], out_of_scope: [] }),
      isLoading: false,
    } as any);
    vi.mocked(useRecomputeIntent).mockReturnValue({ mutate: vi.fn(), isPending: false } as any);

    renderWithIntl(<IntentCard prId="pr1" />);

    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("recompute button fires the mutation and shows the recomputing label while pending", () => {
    const mutate = vi.fn();
    vi.mocked(usePrIntent).mockReturnValue({ data: null, isLoading: false } as any);
    vi.mocked(useRecomputeIntent).mockReturnValue({ mutate, isPending: false } as any);

    const { rerender } = renderWithIntl(<IntentCard prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: "Recompute" }));
    expect(mutate).toHaveBeenCalledWith({ prId: "pr1" });

    vi.mocked(useRecomputeIntent).mockReturnValue({ mutate, isPending: true } as any);
    rerender(wrap(<IntentCard prId="pr1" />));

    expect(screen.getByRole("button", { name: "Recomputing…" })).toBeInTheDocument();
  });
});
