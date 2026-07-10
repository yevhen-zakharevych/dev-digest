import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { Agent, AgentSkillLink, ProjectContextDocs, Skill } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/agents.json";

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
  useAgentSkills: vi.fn(),
  useSkills: vi.fn(),
}));
vi.mock("@/lib/hooks/agents", () => ({
  useSetAgentAttachedDocs: vi.fn(),
}));

import { useActiveRepo } from "@/lib/repo-context";
import { useDocumentContent, useProjectContextDocs } from "@/lib/hooks/project-context";
import { useAgentSkills, useSkills } from "@/lib/hooks/skills";
import { useSetAgentAttachedDocs } from "@/lib/hooks/agents";
import { ContextTab } from "./ContextTab";

afterEach(cleanup);

function agent(o: Partial<Agent> = {}): Agent {
  return {
    id: "ag1",
    name: "Security Reviewer",
    description: "Flags secrets and injection",
    provider: "openai",
    model: "gpt-4.1",
    system_prompt: "You are a security reviewer.",
    output_schema: null,
    strategy: "single-pass",
    ci_fail_on: "critical",
    repo_intel: true,
    attached_docs: [],
    skills_count: 0,
    enabled: true,
    version: 1,
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
    <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function setup(opts: {
  agent?: Agent;
  docs?: ProjectContextDocs;
  links?: AgentSkillLink[];
  skills?: Skill[];
  mutate?: ReturnType<typeof vi.fn>;
} = {}) {
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
  vi.mocked(useAgentSkills).mockReturnValue({ data: opts.links ?? [], isLoading: false } as any);
  vi.mocked(useSkills).mockReturnValue({ data: opts.skills ?? [], isLoading: false } as any);
  vi.mocked(useSetAgentAttachedDocs).mockReturnValue({ mutate, isPending: false } as any);
  return {
    mutate,
    ...renderWithIntl(<ContextTab agent={opts.agent ?? agent()} />),
  };
}

describe("Agent Editor — Context tab", () => {
  it("renders one row per discovered document with all controls, and the 'N of M attached' count", () => {
    setup({ agent: agent({ attached_docs: ["specs/architecture.md"] }) });

    expect(screen.getByText("architecture.md")).toBeInTheDocument();
    expect(screen.getByText("onboarding.md")).toBeInTheDocument();
    expect(screen.getByText("incident-log.md")).toBeInTheDocument();
    // Folder path is shown alongside the filename (scoped by testid — the
    // bucket badge for a top-level doc renders the SAME text as its folder,
    // e.g. "specs/architecture.md"'s folder AND bucket both read "specs").
    const architectureRow = screen.getByTestId("context-doc-row-specs/architecture.md");
    expect(within(architectureRow).getByTestId("context-doc-folder")).toHaveTextContent("specs");
    const onboardingRow = screen.getByTestId("context-doc-row-docs/onboarding.md");
    expect(within(onboardingRow).getByTestId("context-doc-folder")).toHaveTextContent("docs");

    // Each row has an attach/detach toggle, a Preview affordance, and the
    // keyboard move alternative to the drag handle.
    expect(screen.getAllByRole("switch")).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Preview" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Move up" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Move down" })).toHaveLength(3);

    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();
  });

  it("search narrows the list without changing attach state; a toggle set before filtering stays set", () => {
    setup({ agent: agent({ attached_docs: ["docs/onboarding.md"] }) });

    fireEvent.change(screen.getByPlaceholderText("Search documents by name or path…"), {
      target: { value: "onboarding" },
    });

    expect(screen.queryByText("architecture.md")).not.toBeInTheDocument();
    expect(screen.queryByText("incident-log.md")).not.toBeInTheDocument();
    expect(screen.getByText("onboarding.md")).toBeInTheDocument();

    const row = screen.getByTestId("context-doc-row-docs/onboarding.md");
    expect(within(row).getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("toggling attach/detach calls the mutation with the expected ordered paths", () => {
    const mutate = vi.fn();
    setup({ agent: agent({ attached_docs: ["specs/architecture.md"] }), mutate });

    // Attach a second, currently-unattached doc — appended to the end.
    const unattachedRow = screen.getByTestId("context-doc-row-docs/onboarding.md");
    fireEvent.click(within(unattachedRow).getByRole("switch"));
    expect(mutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: ["specs/architecture.md", "docs/onboarding.md"],
    });

    // Detach the already-attached doc — removed from the list.
    const attachedRow = screen.getByTestId("context-doc-row-specs/architecture.md");
    fireEvent.click(within(attachedRow).getByRole("switch"));
    expect(mutate).toHaveBeenCalledWith({
      agentId: "ag1",
      paths: [],
    });
  });

  it("reordering attached documents (drag AND the keyboard move alternative) persists the new order", () => {
    const mutate = vi.fn();
    setup({
      agent: agent({ attached_docs: ["specs/architecture.md", "docs/onboarding.md"] }),
      mutate,
    });

    // Keyboard alternative: move the first attached row down one slot.
    const firstRow = screen.getByTestId("context-doc-row-specs/architecture.md");
    fireEvent.click(within(firstRow).getByRole("button", { name: "Move down" }));
    expect(mutate).toHaveBeenLastCalledWith({
      agentId: "ag1",
      paths: ["docs/onboarding.md", "specs/architecture.md"],
    });

    // Drag-and-drop: dragging row 0 onto row 1 swaps their order (jsdom has
    // no native DataTransfer, so a minimal stand-in is supplied).
    const store = new Map<string, string>();
    const dataTransfer = {
      setData: (k: string, v: string) => store.set(k, v),
      getData: (k: string) => store.get(k) ?? "",
      effectAllowed: "",
    };
    const rowA = screen.getByTestId("context-doc-row-specs/architecture.md");
    const rowB = screen.getByTestId("context-doc-row-docs/onboarding.md");
    fireEvent.dragStart(rowA, { dataTransfer });
    fireEvent.drop(rowB, { dataTransfer });
    expect(mutate).toHaveBeenLastCalledWith({
      agentId: "ag1",
      paths: ["docs/onboarding.md", "specs/architecture.md"],
    });
  });

  it("shows a running token estimate over the de-duplicated effective set (agent docs + enabled skills) and the untrusted note", () => {
    const links: AgentSkillLink[] = [{ agent_id: "ag1", skill_id: "sk1", order: 0, enabled: true }];
    const skills: Skill[] = [
      {
        id: "sk1",
        name: "Security rubric",
        description: "",
        type: "security",
        source: "manual",
        body: "",
        enabled: true,
        version: 1,
        evidence_files: null,
        attached_docs: ["insights/incident-log.md"],
        agents_count: 1,
      },
    ];

    const { rerender } = setup({
      agent: agent({ attached_docs: ["specs/architecture.md"] }),
      links,
      skills,
    });

    // Effective set = architecture.md (120) + the enabled skill's
    // incident-log.md (50) = 170, even though the agent itself never
    // attached incident-log.md directly.
    expect(
      screen.getByText("≈ 170 tokens in the attached set (includes enabled skills)"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Injected as an untrusted block (## Project context) into every run."),
    ).toBeInTheDocument();

    // Toggling (here simulated as the parent re-rendering with the newly
    // persisted attach list, mirroring the real mutate -> invalidate ->
    // refetch flow) updates the estimate.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <ContextTab agent={agent({ attached_docs: ["specs/architecture.md", "docs/onboarding.md"] })} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.getByText("≈ 470 tokens in the attached set (includes enabled skills)"),
    ).toBeInTheDocument();
  });

  it("Preview drawer renders the document's markdown and all four metadata items; toggling there updates the header count", () => {
    const mutate = vi.fn();
    const { rerender } = setup({ agent: agent({ attached_docs: [] }), mutate });

    // Set AFTER `setup()` — `setup()` itself defaults `useDocumentContent` to
    // an empty/null result, which would otherwise clobber this override.
    vi.mocked(useDocumentContent).mockReturnValue({
      data: { path: "docs/onboarding.md", text: "Onboarding body text." },
      isLoading: false,
    } as any);

    const row = screen.getByTestId("context-doc-row-docs/onboarding.md");
    fireEvent.click(within(row).getByRole("button", { name: "Preview" }));

    const drawer = screen.getByRole("dialog");
    expect(within(drawer).getByText("Onboarding body text.")).toBeInTheDocument();
    expect(within(drawer).getByText("docs")).toBeInTheDocument();
    expect(within(drawer).getByText("300 tokens")).toBeInTheDocument();
    expect(within(drawer).getByText("Used by 0 agents")).toBeInTheDocument();
    expect(within(drawer).getByRole("switch")).toHaveAttribute("aria-checked", "false");

    fireEvent.click(within(drawer).getByRole("switch"));
    expect(mutate).toHaveBeenCalledWith({ agentId: "ag1", paths: ["docs/onboarding.md"] });

    // Simulate the persisted attach flowing back through the agent prop —
    // the header count reflects it.
    rerender(
      <NextIntlClientProvider locale="en" messages={{ agents: messages }}>
        <ContextTab agent={agent({ attached_docs: ["docs/onboarding.md"] })} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("1 of 3 attached")).toBeInTheDocument();
  });
});
