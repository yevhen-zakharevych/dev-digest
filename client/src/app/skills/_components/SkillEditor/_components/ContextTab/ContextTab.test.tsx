import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectContextDocs, Skill } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/skills.json";

// House style: mock the hooks modules the component consumes directly
// (client/INSIGHTS.md "A component whose data comes from a `lib/hooks/<domain>.ts`
// TanStack hook is tested by `vi.mock`-ing the hooks module").
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: vi.fn(),
}));
vi.mock("@/lib/hooks/project-context", () => ({
  useProjectContextDocs: vi.fn(),
  useDocumentContent: vi.fn(),
}));
vi.mock("@/lib/hooks/skills", () => ({
  useSetSkillAttachedDocs: vi.fn(),
}));

import { useActiveRepo } from "@/lib/repo-context";
import { useDocumentContent, useProjectContextDocs } from "@/lib/hooks/project-context";
import { useSetSkillAttachedDocs } from "@/lib/hooks/skills";
import { ContextTab } from "./ContextTab";

afterEach(cleanup);

function skill(o: Partial<Skill> = {}): Skill {
  return {
    id: "sk1",
    name: "PR Quality Rubric",
    description: "Flags unbounded queries inside loops.",
    type: "rubric",
    source: "manual",
    body: "# Rule\nDo the thing.",
    enabled: true,
    version: 1,
    evidence_files: null,
    attached_docs: [],
    agents_count: 0,
    ...o,
  };
}

function docs(o: Partial<ProjectContextDocs> = {}): ProjectContextDocs {
  return {
    clone_available: true,
    documents: [
      { path: "specs/architecture.md", bucket: "specs", estimated_tokens: 120, used_by_agents: 2 },
      { path: "docs/onboarding.md", bucket: "docs", estimated_tokens: 300, used_by_agents: 0 },
      { path: "insights/incident-log.md", bucket: "insights", estimated_tokens: 50, used_by_agents: 1 },
    ],
    summary: { document_count: 3, total_estimated_tokens: 470, refreshed_at: "2026-07-10T00:00:00Z" },
    ...o,
  };
}

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ skills: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function setup(opts: { skill?: Skill; docs?: ProjectContextDocs; mutate?: ReturnType<typeof vi.fn> } = {}) {
  const mutate = opts.mutate ?? vi.fn();
  vi.mocked(useActiveRepo).mockReturnValue({
    repoId: "repo1",
    setRepoId: () => {},
    repos: [{ id: "repo1", name: "acme/widgets" } as any],
    activeRepo: { id: "repo1", name: "acme/widgets" } as any,
    reposLoaded: true,
  });
  vi.mocked(useProjectContextDocs).mockReturnValue({
    data: opts.docs ?? docs(),
    isLoading: false,
  } as any);
  vi.mocked(useDocumentContent).mockReturnValue({ data: null, isLoading: false } as any);
  vi.mocked(useSetSkillAttachedDocs).mockReturnValue({ mutate, isPending: false } as any);
  return {
    mutate,
    ...renderWithIntl(<ContextTab skill={opts.skill ?? skill()} />),
  };
}

describe("Skill Editor — Context tab", () => {
  it("renders one row per discovered document with all controls, and the attached count", () => {
    setup({ skill: skill({ attached_docs: ["specs/architecture.md"] }) });

    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("onboarding.md")).toBeInTheDocument();
    expect(screen.getByText("incident-log.md")).toBeInTheDocument();

    // Each row has a toggle + a Preview affordance.
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Preview" })).toHaveLength(3);

    // Header count reflects the currently-attached skill doc.
    expect(screen.getByText("1 attached")).toBeInTheDocument();
  });

  it("search narrows the list without changing attach state; a toggle set before filtering stays set", () => {
    const mutate = vi.fn();
    setup({ skill: skill({ attached_docs: ["docs/onboarding.md"] }), mutate });

    fireEvent.change(screen.getByPlaceholderText("Search documents by name or path…"), {
      target: { value: "onboarding" },
    });

    expect(screen.queryByText("architecture.md")).not.toBeInTheDocument();
    expect(screen.queryByText("incident-log.md")).not.toBeInTheDocument();
    expect(screen.getByText("onboarding.md")).toBeInTheDocument();

    // The visible row for the already-attached doc still shows as attached.
    const row = screen.getByTestId("context-doc-row-docs/onboarding.md");
    expect(within(row).getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("toggling attach calls the mutation with the expected ordered paths", () => {
    const mutate = vi.fn();
    setup({ skill: skill({ attached_docs: ["specs/architecture.md"] }), mutate });

    const row = screen.getByTestId("context-doc-row-docs/onboarding.md");
    fireEvent.click(within(row).getByRole("switch"));

    expect(mutate).toHaveBeenCalledWith({
      skillId: "sk1",
      paths: ["specs/architecture.md", "docs/onboarding.md"],
    });
  });

  it("toggling detach calls the mutation with the path removed", () => {
    const mutate = vi.fn();
    setup({
      skill: skill({ attached_docs: ["specs/architecture.md", "docs/onboarding.md"] }),
      mutate,
    });

    const row = screen.getByTestId("context-doc-row-specs/architecture.md");
    fireEvent.click(within(row).getByRole("switch"));

    expect(mutate).toHaveBeenCalledWith({
      skillId: "sk1",
      paths: ["docs/onboarding.md"],
    });
  });

  it("renders a move-up/move-down reorder control on attached rows only, disabled at the boundaries", () => {
    setup({
      skill: skill({ attached_docs: ["specs/architecture.md", "docs/onboarding.md"] }),
    });

    const first = screen.getByTestId("context-doc-row-specs/architecture.md");
    const second = screen.getByTestId("context-doc-row-docs/onboarding.md");

    expect(within(first).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(first).getByRole("button", { name: "Move down" })).not.toBeDisabled();
    expect(within(second).getByRole("button", { name: "Move up" })).not.toBeDisabled();
    expect(within(second).getByRole("button", { name: "Move down" })).toBeDisabled();

    // An unattached row's reorder controls are rendered but both disabled
    // (there is no order to move it within).
    const unattached = screen.getByTestId("context-doc-row-insights/incident-log.md");
    expect(within(unattached).getByRole("button", { name: "Move up" })).toBeDisabled();
    expect(within(unattached).getByRole("button", { name: "Move down" })).toBeDisabled();
  });

  it("clicking move-down on an attached row calls the mutation with the reordered paths", () => {
    const mutate = vi.fn();
    setup({
      skill: skill({ attached_docs: ["specs/architecture.md", "docs/onboarding.md"] }),
      mutate,
    });

    const first = screen.getByTestId("context-doc-row-specs/architecture.md");
    fireEvent.click(within(first).getByRole("button", { name: "Move down" }));

    expect(mutate).toHaveBeenCalledWith({
      skillId: "sk1",
      paths: ["docs/onboarding.md", "specs/architecture.md"],
    });
  });

  it("computes the reorder index against the FULL persisted attached list, not the search-filtered view", () => {
    const mutate = vi.fn();
    setup({
      skill: skill({
        attached_docs: ["specs/architecture.md", "docs/onboarding.md", "insights/incident-log.md"],
      }),
      mutate,
    });

    // Filter the visible rows down to just the last attached doc.
    fireEvent.change(screen.getByPlaceholderText("Search documents by name or path…"), {
      target: { value: "incident" },
    });

    const row = screen.getByTestId("context-doc-row-insights/incident-log.md");
    fireEvent.click(within(row).getByRole("button", { name: "Move up" }));

    // Moving the (unfiltered) index 2 -> 1 swaps it with "docs/onboarding.md",
    // NOT with whatever would be "previous" in the filtered (1-row) view.
    expect(mutate).toHaveBeenCalledWith({
      skillId: "sk1",
      paths: ["specs/architecture.md", "insights/incident-log.md", "docs/onboarding.md"],
    });
  });

  it("renders the inheritance note", () => {
    setup();
    expect(
      screen.getByText("Any agent using this skill inherits these documents."),
    ).toBeInTheDocument();
  });

  it("the serializes-as preview lists attached paths under a literal '## Project context' heading", () => {
    setup({
      skill: skill({ attached_docs: ["specs/architecture.md", "docs/onboarding.md"] }),
    });

    const block = screen.getByTestId("skill-context-serializes-as");
    expect(block.textContent).toContain("## Project context");
    expect(block.textContent).toContain("specs/architecture.md");
    expect(block.textContent).toContain("docs/onboarding.md");
  });

  it("shows an empty serializes-as state (no injected block) when nothing is attached", () => {
    setup({ skill: skill({ attached_docs: [] }) });
    const block = screen.getByTestId("skill-context-serializes-as");
    expect(block.querySelector("pre")).not.toBeInTheDocument();
  });
});
