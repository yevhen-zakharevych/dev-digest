import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ProjectContextDocs } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/projectContext.json";
import { ProjectContextBody } from "./ProjectContextBody";

// House style: mock the hooks module rather than standing up a real
// QueryClient (client/INSIGHTS.md).
vi.mock("@/lib/hooks/project-context", () => ({
  useProjectContextDocs: vi.fn(),
  useDocumentContent: vi.fn(() => ({ data: null, isLoading: false })),
  useSaveDocument: vi.fn(() => ({ mutate: vi.fn(), isPending: false, isError: false, error: null })),
}));

import { useProjectContextDocs, useDocumentContent, useSaveDocument } from "@/lib/hooks/project-context";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const DOCS: ProjectContextDocs = {
  clone_available: true,
  documents: [
    { path: "specs/plan.md", bucket: "specs", estimated_tokens: 2100, used_by_agents: 1 },
    { path: "docs/architecture.md", bucket: "docs", estimated_tokens: 2000, used_by_agents: 0 },
  ],
  summary: {
    document_count: 2,
    total_estimated_tokens: 4100,
    refreshed_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
};

function mockDocs(data: ProjectContextDocs | undefined, extra: Record<string, unknown> = {}) {
  vi.mocked(useProjectContextDocs).mockReturnValue({
    data,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...extra,
  } as any);
}

function mockContent(text: string | null) {
  vi.mocked(useDocumentContent).mockReturnValue({
    data: text == null ? null : { path: "x", text },
    isLoading: false,
  } as any);
}

describe("ProjectContextBody", () => {
  it("renders one row per discovered document in the left pane", () => {
    mockDocs(DOCS);
    renderWithIntl(<ProjectContextBody repoId="repo1" />);

    expect(screen.getByTestId("doc-row-specs/plan.md")).toBeInTheDocument();
    expect(screen.getByTestId("doc-row-docs/architecture.md")).toBeInTheDocument();
  });

  it("auto-selects the first document so the right pane isn't empty on initial load", () => {
    mockDocs(DOCS);
    mockContent("# Plan\n\nBody.");
    renderWithIntl(<ProjectContextBody repoId="repo1" />);

    expect(screen.getByRole("heading", { name: "Plan" })).toBeInTheDocument();
  });

  it("selecting a row shows its content in the right pane", () => {
    mockDocs(DOCS);
    mockContent("# Architecture\n\nBody.");
    renderWithIntl(<ProjectContextBody repoId="repo1" />);

    fireEvent.click(screen.getByTestId("doc-row-docs/architecture.md"));

    expect(screen.getByRole("heading", { name: "Architecture" })).toBeInTheDocument();
    expect(screen.getByText("Used by 0 agents")).toBeInTheDocument();
  });

  it("renders the AC-7 footer with file count, summed tokens, and a refresh time — no chunk/index wording", () => {
    mockDocs(DOCS);
    renderWithIntl(<ProjectContextBody repoId="repo1" />);

    const footer = screen.getByTestId("project-context-footer");
    expect(footer).toHaveTextContent("2 documents");
    expect(footer).toHaveTextContent("≈ 4.1k tokens total");
    expect(footer).toHaveTextContent("refreshed 5m ago");
    expect(footer.textContent).not.toMatch(/chunk/i);
    expect(footer.textContent).not.toMatch(/indexed?/i);
    expect(footer.textContent).not.toMatch(/vector/i);
  });

  it("shows an explicit clone-not-available empty state, not an error, when clone_available is false", () => {
    mockDocs({
      clone_available: false,
      documents: [],
      summary: { document_count: 0, total_estimated_tokens: 0, refreshed_at: new Date().toISOString() },
    });
    renderWithIntl(<ProjectContextBody repoId="repo1" />);

    expect(screen.getByText("Clone not available")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("project-context-footer")).not.toBeInTheDocument();
  });

  it("filters the left-pane list by filename/path via the search box", () => {
    mockDocs(DOCS);
    mockContent("# Plan\n\nBody.");
    renderWithIntl(<ProjectContextBody repoId="repo1" />);

    fireEvent.change(screen.getByLabelText("Filter documents"), {
      target: { value: "architecture" },
    });

    expect(screen.queryByTestId("doc-row-specs/plan.md")).not.toBeInTheDocument();
    expect(screen.getByTestId("doc-row-docs/architecture.md")).toBeInTheDocument();
  });

  it("switches Preview to Edit and shows the document's raw text", () => {
    mockDocs(DOCS);
    mockContent("# Plan\n\nBody.");
    renderWithIntl(<ProjectContextBody repoId="repo1" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const textarea = screen.getByRole("textbox", { name: "Edit" }) as HTMLTextAreaElement;
    expect(textarea.value).toBe("# Plan\n\nBody.");
    expect(screen.getByRole("note")).toHaveTextContent(/re-analyz/i);
  });

  it("surfaces a failed save instead of dropping it silently", () => {
    mockDocs(DOCS);
    mockContent("# Plan\n\nBody.");
    vi.mocked(useSaveDocument).mockReturnValue({
      mutate: vi.fn(),
      isPending: false,
      isError: true,
      error: new Error("disk full"),
    } as any);
    renderWithIntl(<ProjectContextBody repoId="repo1" />);

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("alert")).toHaveTextContent("disk full");
  });
});
