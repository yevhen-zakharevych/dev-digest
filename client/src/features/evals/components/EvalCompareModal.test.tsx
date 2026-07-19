import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/eval.json";

// The modal reads the (deduped) comparison to title its header; EvalCompare
// itself is exercised by its own test, so stub it and mock the hook.
vi.mock("@/lib/hooks/evals", () => ({ useEvalComparison: vi.fn() }));
vi.mock("./EvalCompare/EvalCompare", () => ({
  EvalCompare: (props: { runIdA: string | null; runIdB: string | null; chrome?: boolean }) => (
    <div data-testid="compare" data-a={props.runIdA} data-b={props.runIdB} data-chrome={String(props.chrome)} />
  ),
}));

import { useEvalComparison } from "@/lib/hooks/evals";
import { EvalCompareModal } from "./EvalCompareModal";

afterEach(cleanup);

function renderModal(onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCompareModal runIdA="run-old" runIdB="run-new" agentId="agent-1" onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("EvalCompareModal", () => {
  it("titles the header from the run labels and passes both ids through (chrome off)", () => {
    vi.mocked(useEvalComparison).mockReturnValue({
      data: { base: { agent_version: 5 }, candidate: { agent_version: 3 } },
    } as any);
    renderModal();

    expect(screen.getByText("Compare runs · v5 → v3")).toBeInTheDocument();
    const compare = screen.getByTestId("compare");
    expect(compare).toHaveAttribute("data-a", "run-old");
    expect(compare).toHaveAttribute("data-b", "run-new");
    expect(compare).toHaveAttribute("data-chrome", "false");
  });

  it("falls back to a static title before the comparison loads", () => {
    vi.mocked(useEvalComparison).mockReturnValue({ data: undefined } as any);
    renderModal();
    expect(screen.getByText("Compare runs")).toBeInTheDocument();
  });

  it("closes via the footer Close button and the header X", () => {
    vi.mocked(useEvalComparison).mockReturnValue({ data: undefined } as any);
    const onClose = renderModal();
    // Two "Close" affordances share the accessible name: the header X
    // (aria-label) and the footer button (text).
    const closers = screen.getAllByRole("button", { name: "Close" });
    expect(closers).toHaveLength(2);
    closers.forEach((b) => fireEvent.click(b));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
