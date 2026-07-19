import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { ToastProvider } from "@/lib/toast";

// jsdom doesn't implement scrollIntoView (FindingCard's deep-link effect,
// `client/INSIGHTS.md:39`).
Element.prototype.scrollIntoView = vi.fn();

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

// Seeding resolves to a case; the panel then opens the modal (not a page
// navigation) — the modal itself is stubbed so this test stays scoped to the
// panel's own responsibility: turn a seed result into an open modal.
const seedMutate = vi.fn(
  (
    _findingId: string,
    opts?: { onSuccess?: (r: { case: { id: string }; created: boolean }) => void },
  ) => opts?.onSuccess?.({ case: { id: "case-9" }, created: true }),
);
vi.mock("@/lib/hooks/evals", () => ({
  useSeedEvalCaseFromFinding: () => ({ mutate: seedMutate }),
}));

vi.mock("@/features/evals/components/EvalCaseModal", () => ({
  EvalCaseModal: ({ caseId, onClose }: { caseId: string; onClose: () => void }) => (
    <div data-testid="eval-case-modal">
      {caseId}
      <button onClick={onClose}>close-modal</button>
    </div>
  ),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(() => {
  cleanup();
  seedMutate.mockClear();
});

const FINDINGS: FindingRecord[] = [
  {
    id: "f1",
    severity: "CRITICAL",
    category: "security",
    title: "Hardcoded secret",
    file: "src/config.ts",
    start_line: 11,
    end_line: 11,
    rationale: "A secret is committed.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
  },
];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      <ToastProvider>{ui}</ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });

  it("seeds a decided finding and opens the eval-case modal (no page nav)", () => {
    const decided: FindingRecord = { ...FINDINGS[0]!, accepted_at: "2026-07-16T00:00:00Z" };
    renderWithIntl(<FindingsPanel findings={[decided]} prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: /turn into eval case/i }));

    expect(seedMutate).toHaveBeenCalledWith("f1", expect.anything());
    expect(screen.getByTestId("eval-case-modal")).toHaveTextContent("case-9");
  });
});
