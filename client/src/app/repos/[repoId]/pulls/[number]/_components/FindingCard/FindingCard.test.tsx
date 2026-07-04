import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { FindingRecord } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/prReview.json";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

// jsdom doesn't implement scrollIntoView (used by the deep-link effect below,
// mirroring ReviewRunAccordion.tsx:54) — stub it so the effect doesn't throw.
Element.prototype.scrollIntoView = vi.fn();

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderWithIntl(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderWithIntl(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByText("Accept"));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByText("Dismiss"));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard — Smart-Diff deep-link (targetFindingId/targetNonce)", () => {
  it("force-expands and highlights when targetFindingId matches f.id, even without defaultExpanded", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} targetFindingId="f1" targetNonce={1} />);
    // Expanded: the rationale (only rendered when expanded) is now visible.
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();
    // Highlighted: same visual treatment `focused` uses (boxShadow via sevColor).
    const card = screen.getByText("Hardcoded Stripe secret key").closest("[data-finding-id]") as HTMLElement;
    expect(card.style.boxShadow).not.toBe("none");
  });

  it("does NOT force-expand when targetFindingId does not match f.id", () => {
    renderWithIntl(<FindingCard f={FINDING} onAction={() => {}} targetFindingId="other-id" targetNonce={1} />);
    expect(screen.queryByText("Move the key to an environment variable.")).not.toBeInTheDocument();
    const card = screen.getByText("Hardcoded Stripe secret key").closest("[data-finding-id]") as HTMLElement;
    expect(card.style.boxShadow).toBe("none");
  });

  it("re-triggers the expand on a bumped targetNonce for the same id (re-click)", () => {
    const { rerender } = renderWithIntl(
      <FindingCard f={FINDING} onAction={() => {}} targetFindingId={null} targetNonce={0} />,
    );
    expect(screen.queryByText("Move the key to an environment variable.")).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview: messages }}>
        <FindingCard f={FINDING} onAction={() => {}} targetFindingId="f1" targetNonce={1} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("Move the key to an environment variable.")).toBeInTheDocument();
  });
});
