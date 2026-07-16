import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { EvalCase } from "@devdigest/shared";
import messages from "../../../../../../messages/en/eval.json";

// House style: mock the hooks module the component consumes directly
// (client/INSIGHTS.md — no MSW precedent in this repo; fireEvent, not
// userEvent, since @testing-library/user-event is not installed here).
vi.mock("@/lib/hooks/evals", () => ({
  useCreateEvalCase: vi.fn(),
  useUpdateEvalCase: vi.fn(),
  useRunEvalDraft: vi.fn(),
  useEvalCaseDraft: vi.fn(),
}));

import {
  useCreateEvalCase,
  useEvalCaseDraft,
  useRunEvalDraft,
  useUpdateEvalCase,
} from "@/lib/hooks/evals";
import { ApiError } from "@/lib/api";
import { EvalCaseEditor } from "./EvalCaseEditor";

afterEach(cleanup);

function baseCase(o: Partial<EvalCase> = {}): EvalCase {
  return {
    id: "case1",
    owner_kind: "agent",
    owner_id: "ag1",
    name: "stripe-key-leak",
    expectation: "must_find",
    input_diff: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,1 +1,2 @@\n+stripeKey",
    input_files: null,
    input_meta: { title: "Add Stripe", body: "Wire up payments" },
    expected_output: [{ file: "src/config.ts", start_line: 1, end_line: 2, kind: "finding" }],
    forbidden_region: null,
    source_finding_id: null,
    source_finding: null,
    input_fingerprint: "fp1",
    notes: null,
    latest_draft: null,
    ...o,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ eval: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function setup(opts: {
  createMutateAsync?: ReturnType<typeof vi.fn>;
  updateMutateAsync?: ReturnType<typeof vi.fn>;
  runDraftMutate?: ReturnType<typeof vi.fn>;
  runDraftError?: unknown;
  draftData?: unknown;
} = {}) {
  vi.mocked(useCreateEvalCase).mockReturnValue({
    mutateAsync: opts.createMutateAsync ?? vi.fn(),
    isPending: false,
  } as any);
  vi.mocked(useUpdateEvalCase).mockReturnValue({
    mutateAsync: opts.updateMutateAsync ?? vi.fn(),
    isPending: false,
  } as any);
  vi.mocked(useRunEvalDraft).mockReturnValue({
    mutate: opts.runDraftMutate ?? vi.fn(),
    isPending: false,
    error: opts.runDraftError ?? null,
  } as any);
  vi.mocked(useEvalCaseDraft).mockReturnValue({ data: opts.draftData ?? null } as any);
}

describe("EvalCaseEditor — new must_find case", () => {
  it("blocks save on a missing expected-item file, naming the field, then saves once filled", async () => {
    const onSaved = vi.fn();
    const createMutateAsync = vi.fn().mockResolvedValue(baseCase({ id: "new-case" }));
    setup({ createMutateAsync });

    renderWithIntl(<EvalCaseEditor agentId="ag1" existingCase={null} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("This expected finding needs a file.")).toBeInTheDocument();
    expect(createMutateAsync).not.toHaveBeenCalled();

    fireEvent.change(screen.getByRole("textbox", { name: "File 1" }), {
      target: { value: "src/config.ts" },
    });
    fireEvent.change(screen.getByPlaceholderText(/stripeKey/), {
      target: { value: "--- a/src/config.ts\n+++ b/src/config.ts\n@@ -1,1 +1,2 @@\n+stripeKey" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(createMutateAsync).toHaveBeenCalledTimes(1);
    const call = createMutateAsync.mock.calls[0]![0];
    expect(call.agentId).toBe("ag1");
    expect(call.input.expectation).toBe("must_find");
    expect(call.input.expected_output[0].file).toBe("src/config.ts");
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: "new-case" })));
  });
});

describe("EvalCaseEditor — must_not_flag case (AC-4: two distinct texts)", () => {
  it("shows the source's ORIGINAL rationale read-only, and requires the user's own RECORDED reason before saving", async () => {
    const updateMutateAsync = vi.fn().mockResolvedValue(baseCase({ expectation: "must_not_flag" }));
    setup({ updateMutateAsync });

    const negCase = baseCase({
      expectation: "must_not_flag",
      expected_output: [],
      forbidden_region: { file: "src/api/webhook.ts", start_line: 61, end_line: 74, kind: "lethal_trifecta" },
      source_finding: {
        finding_id: "f1",
        title: "Lethal trifecta",
        rationale: "This is the agent's original explanation for raising it.",
        severity: "CRITICAL",
        category: "security",
        kind: "lethal_trifecta",
        file: "src/api/webhook.ts",
        start_line: 61,
        end_line: 74,
      },
      notes: null,
    });

    renderWithIntl(<EvalCaseEditor agentId="ag1" existingCase={negCase} onSaved={vi.fn()} />);

    // The original rationale is rendered read-only...
    expect(screen.getByTestId("source-rationale")).toHaveTextContent(
      "This is the agent's original explanation for raising it.",
    );
    // ...and it is NOT the same text as the (empty) recorded-reason field.
    const reasonBox = screen.getByPlaceholderText(/This is intentional/);
    expect(reasonBox).toHaveValue("");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("A reason is required before a must-not-flag case can be saved.")).toBeInTheDocument();
    expect(updateMutateAsync).not.toHaveBeenCalled();

    fireEvent.change(reasonBox, { target: { value: "This is a known false positive in test fixtures." } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(updateMutateAsync).toHaveBeenCalledTimes(1);
    const patch = updateMutateAsync.mock.calls[0]![0].patch;
    expect(patch.notes).toBe("This is a known false positive in test fixtures.");
    expect(patch.expected_output).toEqual([]); // untouched — a negative case's expectation is never edited here
  });
});

describe("EvalCaseEditor — diff-freeze rejection (AC-7: never persisted)", () => {
  it("shows the server's file+lines message and does not call onSaved", async () => {
    const onSaved = vi.fn();
    const rejection = new ApiError(
      "The frozen diff contains no hunk for src/config.ts, so the agent could never cite it.",
      422,
    );
    const updateMutateAsync = vi.fn().mockRejectedValue(rejection);
    setup({ updateMutateAsync });

    renderWithIntl(<EvalCaseEditor agentId="ag1" existingCase={baseCase()} onSaved={onSaved} />);

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const errorBox = await screen.findByTestId("save-error");
    expect(within(errorBox).getByText(/contains no hunk for src\/config\.ts/)).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });
});

describe("EvalCaseEditor — draft footer (AC-47/48)", () => {
  it("shows the latest draft's outcome and cost, marks it stale, and fires a new draft on Run case", () => {
    const runDraftMutate = vi.fn();
    setup({
      runDraftMutate,
      draftData: {
        case_id: "case1",
        ran_at: "2026-07-10T00:00:00Z",
        status: "done",
        effective_config: {},
        fingerprint: "fp1",
        outcome: "passed",
        expected_count: 1,
        actual_count: 1,
        findings: [],
        duration_ms: 1800,
        cost_usd: 0.02,
        stale: true,
      },
    });

    renderWithIntl(<EvalCaseEditor agentId="ag1" existingCase={baseCase()} onSaved={vi.fn()} />);

    const summary = screen.getByTestId("draft-summary");
    expect(within(summary).getByText("Last run passed")).toBeInTheDocument();
    expect(within(summary).getByText("stale")).toBeInTheDocument();
    expect(within(summary).getByText(/\$0\.02/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run case" }));
    expect(runDraftMutate).toHaveBeenCalledWith("case1");
  });
});
