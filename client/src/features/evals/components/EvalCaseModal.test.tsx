import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase } from "@devdigest/shared";
import messages from "../../../../messages/en/eval.json";

vi.mock("@/lib/hooks/evals", () => ({ useEvalCase: vi.fn() }));

// The editor is exercised by its own test; here we only assert the modal
// wires it up — so stub it and read back the props it received.
vi.mock("./EvalCaseEditor/EvalCaseEditor", () => ({
  EvalCaseEditor: (props: { existingCase?: { id: string } | null; chrome?: boolean; onCancel?: () => void }) => (
    <div data-testid="editor" data-case={props.existingCase?.id ?? ""} data-chrome={String(props.chrome)}>
      <button onClick={props.onCancel}>editor-cancel</button>
    </div>
  ),
}));

import { useEvalCase } from "@/lib/hooks/evals";
import { EvalCaseModal } from "./EvalCaseModal";

afterEach(cleanup);

const CASE = { id: "c1", name: "stripe-key-leak", owner_id: "agent-1", expectation: "must_find" } as unknown as EvalCase;

function renderModal(props: { caseId?: string; agentId?: string; agentName?: string }, onClose = vi.fn()) {
  render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      <EvalCaseModal {...props} onClose={onClose} />
    </NextIntlClientProvider>,
  );
  return onClose;
}

describe("EvalCaseModal", () => {
  it("shows a skeleton (no editor) while an existing case loads", () => {
    vi.mocked(useEvalCase).mockReturnValue({ data: undefined, isLoading: true } as any);
    renderModal({ caseId: "c1" });
    expect(screen.queryByTestId("editor")).toBeNull();
  });

  it("renders the editor for a loaded case with its own chrome hidden", () => {
    vi.mocked(useEvalCase).mockReturnValue({ data: CASE, isLoading: false } as any);
    renderModal({ caseId: "c1" });
    const editor = screen.getByTestId("editor");
    expect(editor).toHaveAttribute("data-case", "c1");
    expect(editor).toHaveAttribute("data-chrome", "false");
    expect(screen.getByText("Eval case · stripe-key-leak")).toBeInTheDocument();
    // must_find + no agent name → the generic positive subtitle.
    expect(screen.getByText("Simulate a PR and assert the expected output")).toBeInTheDocument();
  });

  it("renders a blank editor titled 'New eval case' when there is no caseId", () => {
    // No caseId → useEvalCase is disabled and returns nothing.
    vi.mocked(useEvalCase).mockReturnValue({ data: undefined, isLoading: false } as any);
    renderModal({ agentId: "agent-1", agentName: "Security Reviewer" });
    const editor = screen.getByTestId("editor");
    expect(editor).toHaveAttribute("data-case", ""); // existingCase = null
    expect(screen.getByText("New eval case")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer · simulate a PR and assert the expected output")).toBeInTheDocument();
  });

  it("closes via the editor Cancel and via the header X", () => {
    vi.mocked(useEvalCase).mockReturnValue({ data: CASE, isLoading: false } as any);
    const onClose = renderModal({ caseId: "c1" });
    fireEvent.click(screen.getByText("editor-cancel"));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
