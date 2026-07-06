import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, within, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { SmartDiff, PrFile, FindingRecord } from "@devdigest/shared";
import prReviewMessages from "../../../../../../../../messages/en/prReview.json";
import shellMessages from "../../../../../../../../messages/en/shell.json";
import { SmartDiffViewer } from "./SmartDiffViewer";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview: prReviewMessages, shell: shellMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

// `src/foo.ts` new-side lines: 1 = "line one", 2 = "line two added", 3 = "line three".
const PATCH_FOO = `@@ -1,2 +1,3 @@
 line one
+line two added
 line three
`;

const PATCH_INDEX = `@@ -1,1 +1,2 @@
 export * from "./foo";
+export * from "./bar";
`;

const FILES: PrFile[] = [
  { path: "src/foo.ts", additions: 1, deletions: 0, patch: PATCH_FOO },
  { path: "src/index.ts", additions: 1, deletions: 0, patch: PATCH_INDEX },
  { path: "pnpm-lock.yaml", additions: 500, deletions: 0, patch: null },
];

const SMART_DIFF: SmartDiff = {
  groups: [
    {
      role: "core",
      files: [
        { path: "src/foo.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [2] },
      ],
    },
    {
      role: "wiring",
      files: [
        { path: "src/index.ts", pseudocode_summary: null, additions: 1, deletions: 0, finding_lines: [] },
      ],
    },
    {
      role: "boilerplate",
      files: [
        { path: "pnpm-lock.yaml", pseudocode_summary: null, additions: 500, deletions: 0, finding_lines: [] },
      ],
    },
  ],
  split_suggestion: { too_big: false, total_lines: 2, proposed_splits: [] },
};

const MATCHING_FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "bug",
  title: "Off-by-one in loop bound",
  file: "src/foo.ts",
  start_line: 2,
  end_line: 2,
  rationale: "The added line introduces an off-by-one.",
  suggestion: null,
  confidence: 0.9,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

// Anchored to `src/index.ts` but at a line that isn't rendered in PATCH_INDEX
// (new-side only has lines 1 and 2) — used to prove non-matching lines get no badge.
const NON_MATCHING_FINDING: FindingRecord = {
  ...MATCHING_FINDING,
  id: "f2",
  title: "Not anchored to a rendered line",
  file: "src/index.ts",
  start_line: 99,
  end_line: 99,
};

const FINDINGS = [MATCHING_FINDING, NON_MATCHING_FINDING];

describe("SmartDiffViewer", () => {
  it("renders the three group labels", () => {
    renderWithIntl(
      <SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} findings={FINDINGS} onOpenFinding={vi.fn()} />,
    );
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("Wiring")).toBeInTheDocument();
    expect(screen.getByText("Boilerplate")).toBeInTheDocument();
  });

  it("starts with the boilerplate group collapsed and core/wiring expanded", () => {
    renderWithIntl(
      <SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} findings={FINDINGS} onOpenFinding={vi.fn()} />,
    );
    const boilerplateDetails = screen.getByText("Boilerplate").closest("details") as HTMLDetailsElement;
    expect(boilerplateDetails.open).toBe(false);

    const coreDetails = screen.getByText("Core").closest("details") as HTMLDetailsElement;
    const wiringDetails = screen.getByText("Wiring").closest("details") as HTMLDetailsElement;
    expect(coreDetails.open).toBe(true);
    expect(wiringDetails.open).toBe(true);
  });

  it("renders a clickable severity badge only on the diff line with a matching finding", () => {
    renderWithIntl(
      <SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} findings={FINDINGS} onOpenFinding={vi.fn()} />,
    );
    // Exactly one badge renders (for MATCHING_FINDING); NON_MATCHING_FINDING's
    // line (99) is out of range for the rendered patch, so it gets none.
    const badgeButtons = screen.getAllByRole("button", { name: /Off-by-one|Not anchored/ });
    expect(badgeButtons).toHaveLength(1);
    expect(badgeButtons[0]).toHaveAccessibleName(MATCHING_FINDING.title);

    // The badge sits on the row rendering the matched line, "line two added".
    const row = badgeButtons[0]!.closest("div")!.parentElement!;
    expect(within(row).getByText("line two added")).toBeInTheDocument();
  });

  it("calls onOpenFinding with the matched finding's id when its badge is clicked", () => {
    const onOpenFinding = vi.fn();
    renderWithIntl(
      <SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} findings={FINDINGS} onOpenFinding={onOpenFinding} />,
    );
    const badgeButton = screen.getByRole("button", { name: MATCHING_FINDING.title });
    fireEvent.click(badgeButton);
    expect(onOpenFinding).toHaveBeenCalledTimes(1);
    expect(onOpenFinding).toHaveBeenCalledWith("f1");
  });

  it("renders the large-PR split banner when split_suggestion.too_big is true", () => {
    const bigSmartDiff: SmartDiff = {
      ...SMART_DIFF,
      split_suggestion: {
        too_big: true,
        total_lines: 900,
        proposed_splits: [{ name: "src", files: ["src/foo.ts", "src/index.ts"] }],
      },
    };
    renderWithIntl(
      <SmartDiffViewer smartDiff={bigSmartDiff} files={FILES} findings={FINDINGS} onOpenFinding={vi.fn()} />,
    );
    expect(screen.getByText("This PR is large (900 changed lines)")).toBeInTheDocument();
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent("src");
    expect(items[0]).toHaveTextContent("2 files");
  });

  it("shows a clickable 'N findings' header badge on each file that has findings", () => {
    renderWithIntl(
      <SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} findings={FINDINGS} onOpenFinding={vi.fn()} />,
    );
    // src/foo.ts (core) and src/index.ts (wiring) each carry one finding.
    const jumpBadges = screen.getAllByRole("button", { name: "Jump to findings in the diff" });
    expect(jumpBadges).toHaveLength(2);
    expect(jumpBadges[0]).toHaveTextContent("1 finding");
  });

  it("clicking the header 'N findings' badge scrolls in-diff and does NOT open the Findings tab", () => {
    const scrollSpy = vi.fn();
    // jsdom doesn't implement scrollIntoView — stub it so the jump effect runs.
    Element.prototype.scrollIntoView = scrollSpy;
    const onOpenFinding = vi.fn();
    renderWithIntl(
      <SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} findings={FINDINGS} onOpenFinding={onOpenFinding} />,
    );
    // [0] = src/foo.ts, whose finding sits on a rendered diff line (new-side 2).
    const jumpBadge = screen.getAllByRole("button", { name: "Jump to findings in the diff" })[0]!;
    fireEvent.click(jumpBadge);
    expect(onOpenFinding).not.toHaveBeenCalled();
    expect(scrollSpy).toHaveBeenCalled();
  });

  it("renders exactly ONE severity badge for a multi-line finding (on its first covered line)", () => {
    const multiLine: FindingRecord = {
      ...MATCHING_FINDING,
      id: "fm",
      title: "Spans several lines",
      start_line: 1,
      end_line: 3,
    };
    renderWithIntl(
      <SmartDiffViewer smartDiff={SMART_DIFF} files={FILES} findings={[multiLine]} onOpenFinding={vi.fn()} />,
    );
    // Covers new-side lines 1–3 of src/foo.ts, but must yield a single badge.
    const badges = screen.getAllByRole("button", { name: "Spans several lines" });
    expect(badges).toHaveLength(1);
  });
});
