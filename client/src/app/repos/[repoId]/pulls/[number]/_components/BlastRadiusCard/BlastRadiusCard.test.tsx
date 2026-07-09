import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { BlastRadius, PrHistoryItem } from "@devdigest/shared";
import blastMessages from "../../../../../../../../messages/en/blast.json";
import { githubBlobUrl, githubPrUrl } from "@/lib/github-urls";

// House style for a component whose data comes from `lib/hooks/*` (see
// client/INSIGHTS.md:97 / IntentCard.test.tsx): mock the hooks modules
// directly rather than standing up a real QueryClient + fetch mock.
vi.mock("@/lib/hooks/brief", () => ({
  useBlastRadius: vi.fn(),
}));
vi.mock("@/lib/hooks/repo-intel", () => ({
  useRepoIntelStatus: vi.fn(),
}));

import { useBlastRadius } from "@/lib/hooks/brief";
import { useRepoIntelStatus } from "@/lib/hooks/repo-intel";
import { BlastRadiusCard } from "./BlastRadiusCard";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ blast: blastMessages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const BLAST: BlastRadius = {
  changed_symbols: [{ name: "reviewPr", file: "src/modules/reviews/service.ts", kind: "function" }],
  downstream: [
    {
      symbol: "reviewPr",
      callers: [{ name: "handleReviewRoute", file: "src/modules/reviews/routes.ts", line: 42 }],
      endpoints_affected: ["POST /pulls/:id/review"],
      crons_affected: [],
    },
  ],
  summary: "1 changed symbol, 1 caller, 1 endpoint affected.",
  prior_prs: [],
};

const PRIOR_PR: PrHistoryItem = {
  pr_number: 482,
  title: "Some earlier PR",
  author: "octocat",
  merged_at: "2026-06-01T00:00:00.000Z",
  files_overlap: ["src/config.ts"],
  notes: "",
};

function mockHooks({
  blast = BLAST,
  isLoading = false,
  intelState,
}: {
  blast?: BlastRadius | undefined;
  isLoading?: boolean;
  intelState?: any;
} = {}) {
  vi.mocked(useBlastRadius).mockReturnValue({ data: blast, isLoading } as any);
  vi.mocked(useRepoIntelStatus).mockReturnValue({ data: intelState, isLoading: false } as any);
}

describe("BlastRadiusCard", () => {
  it("renders changed symbols and their callers", () => {
    mockHooks();
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    expect(screen.getByText("reviewPr")).toBeInTheDocument();
    // The caller's own symbol name is kept as the row's `title` tooltip, not
    // rendered as visible text (the design shows only `↳ file:line`).
    expect(screen.getByTitle("handleReviewRoute")).toBeInTheDocument();
    expect(screen.getByText("src/modules/reviews/routes.ts:42")).toBeInTheDocument();
    expect(screen.getByText("POST /pulls/:id/review")).toBeInTheDocument();
  });

  it("renders a caller's click-to-code link with the correct GitHub blob URL", () => {
    mockHooks();
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    const link = screen.getByRole("link", { name: "src/modules/reviews/routes.ts:42" });
    expect(link).toHaveAttribute(
      "href",
      githubBlobUrl("acme/widgets", "deadbeef", "src/modules/reviews/routes.ts", 42, 42),
    );
  });

  it("renders no click-to-code link when repoFullName is not known yet", () => {
    mockHooks();
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="repo1" repoFullName={null} sha="deadbeef" />);

    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("src/modules/reviews/routes.ts:42")).toBeInTheDocument();
  });

  it("shows a warning badge with the reason when the repo-intel index is degraded", () => {
    mockHooks({ intelState: { status: "degraded", degradedReason: "index_failed" } });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    expect(screen.getByText("Degraded index")).toBeInTheDocument();
    expect(screen.getByText("The last indexing attempt failed.")).toBeInTheDocument();
  });

  it("shows an informational badge (not a warning) when the index is only partial", () => {
    mockHooks({ intelState: { status: "partial" } });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    expect(screen.getByText("Partial index")).toBeInTheDocument();
  });

  it("shows no badge when the repo-intel index is full", () => {
    mockHooks({ intelState: { status: "full" } });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    expect(screen.queryByText("Degraded index")).not.toBeInTheDocument();
    expect(screen.queryByText("Partial index")).not.toBeInTheDocument();
  });

  it("shows the top-20 caption when a symbol has exactly 20 callers", () => {
    const cappedBlast: BlastRadius = {
      changed_symbols: [{ name: "big", file: "src/big.ts", kind: "function" }],
      downstream: [
        {
          symbol: "big",
          callers: Array.from({ length: 20 }, (_, i) => ({
            name: `caller${i}`,
            file: `src/caller${i}.ts`,
            line: i + 1,
          })),
          endpoints_affected: [],
          crons_affected: [],
        },
      ],
      summary: "1 changed symbol, 20 callers.",
      prior_prs: [],
    };
    mockHooks({ blast: cappedBlast });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    expect(screen.getByText("Showing top 20 callers")).toBeInTheDocument();
  });

  it("shows a loading skeleton and no crash while the blast radius is still loading", () => {
    mockHooks({ isLoading: true, blast: undefined });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    expect(screen.getByText("Blast radius")).toBeInTheDocument();
    expect(screen.queryByText("reviewPr")).not.toBeInTheDocument();
  });

  it("renders the standing disclaimers about missing dynamic edges and the 1-hop endpoint bound", () => {
    mockHooks();
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    expect(
      screen.getByText(/Dynamically-dispatched, DI-wired, or reflection-based callers may be missing/),
    ).toBeInTheDocument();
    expect(screen.getByText(/Only endpoints reachable within one call hop/)).toBeInTheDocument();
  });

  it("renders the compact stats row with symbol/caller/endpoint/cron counts", () => {
    mockHooks();
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    // Scoped to the stats row: a symbol group's own "1 callers" caption
    // (SymbolRow's `callerCount` text) can render the identical string, so
    // an unscoped `screen.getByText` would be ambiguous.
    const statsRow = within(screen.getByTestId("blast-stats-row"));
    expect(statsRow.getByText("1 symbols")).toBeInTheDocument();
    expect(statsRow.getByText("1 callers")).toBeInTheDocument();
    expect(statsRow.getByText("1 endpoints")).toBeInTheDocument();
    expect(statsRow.getByText("0 cron/jobs")).toBeInTheDocument();
  });

  it("de-duplicates endpoint/cron counts shared across multiple downstream groups", () => {
    const sharedBlast: BlastRadius = {
      changed_symbols: [
        { name: "a", file: "src/a.ts", kind: "function" },
        { name: "b", file: "src/b.ts", kind: "function" },
      ],
      downstream: [
        {
          symbol: "a",
          callers: [{ name: "callerA", file: "src/callerA.ts", line: 1 }],
          endpoints_affected: ["GET /shared"],
          crons_affected: ["nightly-sync"],
        },
        {
          symbol: "b",
          callers: [{ name: "callerB", file: "src/callerB.ts", line: 2 }],
          endpoints_affected: ["GET /shared"],
          crons_affected: ["nightly-sync"],
        },
      ],
      summary: "2 changed symbols.",
      prior_prs: [],
    };
    mockHooks({ blast: sharedBlast });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    const statsRow = within(screen.getByTestId("blast-stats-row"));
    expect(statsRow.getByText("2 symbols")).toBeInTheDocument();
    expect(statsRow.getByText("2 callers")).toBeInTheDocument();
    expect(statsRow.getByText("1 endpoints")).toBeInTheDocument();
    expect(statsRow.getByText("1 cron/jobs")).toBeInTheDocument();
  });

  it("switches to the Graph placeholder empty-state when the Graph toggle is clicked, and back to Tree", () => {
    mockHooks();
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    // Tree is the default view.
    expect(screen.getByText("reviewPr")).toBeInTheDocument();
    expect(screen.queryByText("No downstream callers to graph.")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("graph"));

    expect(screen.getByText("No downstream callers to graph.")).toBeInTheDocument();
    expect(screen.queryByText("reviewPr")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("tree"));

    expect(screen.getByText("reviewPr")).toBeInTheDocument();
    expect(screen.queryByText("No downstream callers to graph.")).not.toBeInTheDocument();
  });

  it("renders a collapsed prior-PRs section with a count badge, then expands on click", () => {
    mockHooks({ blast: { ...BLAST, prior_prs: [PRIOR_PR] } });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    // Scoped via data-testid (client/INSIGHTS.md 2026-07-07): text inside
    // this section can collide with other text elsewhere on the card once
    // both are on screen.
    const section = screen.getByTestId("blast-prior-prs") as HTMLDetailsElement;
    const priorPrs = within(section);
    expect(priorPrs.getByText("Prior PRs touching these files")).toBeInTheDocument();
    expect(priorPrs.getByText("1")).toBeInTheDocument();

    // Collapsed by default — jsdom doesn't apply the UA stylesheet that
    // hides <details> children when closed (so RTL queries still find them),
    // so assert the real signal instead: the `open` property/attribute.
    expect(section.open).toBe(false);

    fireEvent.click(priorPrs.getByText("Prior PRs touching these files"));

    expect(section.open).toBe(true);
    const link = priorPrs.getByRole("link", { name: "#482" });
    expect(link).toHaveAttribute("href", githubPrUrl("acme/widgets", 482));
    expect(priorPrs.getByText("Some earlier PR")).toBeInTheDocument();
    expect(priorPrs.getByText("octocat · 2026-06-01")).toBeInTheDocument();
  });

  it("renders no prior-PRs section when there are none", () => {
    mockHooks({ blast: { ...BLAST, prior_prs: [] } });
    renderWithIntl(
      <BlastRadiusCard prId="pr1" repoId="repo1" repoFullName="acme/widgets" sha="deadbeef" />,
    );

    expect(screen.queryByTestId("blast-prior-prs")).not.toBeInTheDocument();
  });

  it("renders an inert prior-PR entry (no link) when repoFullName is not known yet", () => {
    mockHooks({ blast: { ...BLAST, prior_prs: [PRIOR_PR] } });
    renderWithIntl(<BlastRadiusCard prId="pr1" repoId="repo1" repoFullName={null} sha="deadbeef" />);

    const priorPrs = within(screen.getByTestId("blast-prior-prs"));
    fireEvent.click(priorPrs.getByText("Prior PRs touching these files"));

    expect(priorPrs.queryByRole("link")).not.toBeInTheDocument();
    expect(priorPrs.getByText("#482")).toBeInTheDocument();
    expect(priorPrs.getByText("Some earlier PR")).toBeInTheDocument();
  });
});
