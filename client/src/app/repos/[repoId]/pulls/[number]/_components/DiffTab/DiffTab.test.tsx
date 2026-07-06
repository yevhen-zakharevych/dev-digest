import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SmartDiff, PrFile, ReviewRecord } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";

// House style for a component whose data comes from `lib/hooks/*` TanStack
// hooks (client/INSIGHTS.md:85): mock the hooks modules the component
// imports rather than standing up a real QueryClient + fetch mock.
vi.mock("@/lib/hooks/brief", () => ({
  useSmartDiff: vi.fn(),
}));
vi.mock("@/lib/hooks/reviews", () => ({
  usePrComments: vi.fn(),
  useCreatePrComment: vi.fn(),
  usePrReviews: vi.fn(),
}));

import { useSmartDiff } from "@/lib/hooks/brief";
import { usePrComments, useCreatePrComment, usePrReviews } from "@/lib/hooks/reviews";
import { DiffTab } from "./DiffTab";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const PATCH_FOO = `@@ -1,2 +1,3 @@
 line one
+line two added
 line three
`;

const FILES: PrFile[] = [{ path: "src/foo.ts", additions: 1, deletions: 0, patch: PATCH_FOO }];

const SMART_DIFF: SmartDiff = {
  groups: [
    { role: "core", files: [{ path: "src/foo.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] }] },
    { role: "wiring", files: [] },
    { role: "boilerplate", files: [] },
  ],
  split_suggestion: { too_big: false, total_lines: 1, proposed_splits: [] },
};

function review(o: Partial<ReviewRecord> = {}): ReviewRecord {
  return {
    id: "r1",
    pr_id: "pr1",
    agent_id: "a1",
    run_id: "run1",
    agent_name: "Agent",
    kind: "review",
    verdict: null,
    summary: null,
    score: null,
    model: null,
    grounding: null,
    created_at: "2026-07-04T00:00:00Z",
    findings: [],
    ...o,
  };
}

function setup() {
  vi.mocked(useSmartDiff).mockReturnValue({ data: SMART_DIFF, isLoading: false } as any);
  vi.mocked(usePrReviews).mockReturnValue({ data: [review()] } as any);
  vi.mocked(usePrComments).mockReturnValue({ data: [] } as any);
  vi.mocked(useCreatePrComment).mockReturnValue({ isPending: false, mutateAsync: vi.fn() } as any);
}

describe("DiffTab — Smart/Original order toggle", () => {
  it("defaults to Smart order, rendering the SmartDiffViewer's grouped sections", () => {
    setup();
    renderWithIntl(
      <DiffTab prId="pr1" filesCount={1} files={FILES} canComment onOpenFinding={vi.fn()} />,
    );
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("line two added")).toBeInTheDocument();
  });

  it("switches to Original order (plain DiffViewer) when the toggle is clicked, and back", () => {
    setup();
    renderWithIntl(
      <DiffTab prId="pr1" filesCount={1} files={FILES} canComment onOpenFinding={vi.fn()} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Original order" }));
    // Smart Diff's group labels are gone once we're on the Original path.
    expect(screen.queryByText("Core")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Smart order" }));
    expect(screen.getByText("Core")).toBeInTheDocument();
  });
});
