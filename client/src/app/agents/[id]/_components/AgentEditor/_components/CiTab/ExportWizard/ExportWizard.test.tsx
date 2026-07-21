import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CiFile } from "@devdigest/shared";
import messages from "../../../../../../../../../messages/en/ci.json";

// Populated per-test via module-level `let`s (mirrors `EvalsTab.test.tsx`'s
// own pattern — the `vi.mock` factory cannot close over bindings declared
// after it).
let mockPreviewFiles: CiFile[] | undefined;
let mockPreviewError: Error | null = null;
let mockPreviewPending = false;
const previewMutate = vi.fn();

let mockExportPrUrl: string | null = null;
let mockExportError: Error | null = null;
let mockExportPending = false;
const exportMutate = vi.fn();

vi.mock("@/lib/hooks/ci-export", () => ({
  useCiPreview: () => ({
    mutate: previewMutate,
    data: mockPreviewFiles,
    error: mockPreviewError,
    isPending: mockPreviewPending,
    isError: !!mockPreviewError,
  }),
  useExportToCi: () => ({
    mutate: exportMutate,
    data: mockExportPrUrl != null ? { pr_url: mockExportPrUrl } : undefined,
    error: mockExportError,
    isPending: mockExportPending,
  }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({
    activeRepo: { id: "r1", full_name: "acme/payments-api" },
    repos: [],
    repoId: "r1",
    setRepoId: vi.fn(),
    reposLoaded: true,
  }),
}));

import { ExportWizard } from "./ExportWizard";

afterEach(() => {
  cleanup();
  mockPreviewFiles = undefined;
  mockPreviewError = null;
  mockPreviewPending = false;
  mockExportPrUrl = null;
  mockExportError = null;
  mockExportPending = false;
  previewMutate.mockClear();
  exportMutate.mockClear();
});

const AGENT: Agent = {
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
};

const WORKFLOW_FILE: CiFile = {
  path: ".github/workflows/devdigest-review.yml",
  contents: "on:\n  pull_request:\n    types: [opened]\n",
  editable: true,
};
const RUNNER_FILE: CiFile = { path: ".devdigest/runner/index.js", contents: "", editable: false };
const MANIFEST_FILE: CiFile = { path: ".devdigest/agents/security-reviewer.yaml", contents: "name: x\n", editable: false };

function renderWithIntl(ui: React.ReactElement) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
        {ui}
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

function continueButton() {
  return screen.getByRole("button", { name: /continue/i });
}

describe("ExportWizard", () => {
  it("AC-1: opens on Target with the 4-step stepper and GitHub Actions pre-selected", () => {
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    for (const label of ["Target", "Preview", "Configure", "Install"]) {
      // The current step's own label is deliberately echoed a second time in
      // a visually-hidden `aria-live` region (exposes the current step to
      // assistive tech without a new catalogue string) — `getAllByText`
      // tolerates that intentional duplicate.
      expect(screen.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    expect(screen.getByRole("radio", { name: /github actions/i })).toHaveAttribute("aria-checked", "true");
  });

  it("AC-2: a disabled non-GitHub-Actions card is a no-op — selection and step stay unchanged", () => {
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    const circle = screen.getByRole("radio", { name: /circleci/i });
    expect(circle).toBeDisabled();

    fireEvent.click(circle);

    expect(screen.getByRole("radio", { name: /github actions/i })).toHaveAttribute("aria-checked", "true");
    expect(circle).toHaveAttribute("aria-checked", "false");
    // Still on Target — Preview's file list isn't rendered.
    expect(screen.queryByText(/files to create/i)).not.toBeInTheDocument();
  });

  it("AC-4: Continue stays inert for an empty, bare, trailing-slash or full-URL repo", () => {
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);
    const repoInput = screen.getByLabelText(/target repository/i);

    for (const bad of ["", "acme", "acme/", "https://github.com/acme/x"]) {
      fireEvent.change(repoInput, { target: { value: bad } });
      expect(continueButton()).toBeDisabled();
    }

    fireEvent.change(repoInput, { target: { value: "acme/payments-api" } });
    expect(continueButton()).toBeEnabled();
  });

  it("AC-23: deselecting all three trigger chips leaves Continue inert on Configure", () => {
    mockPreviewFiles = [WORKFLOW_FILE, RUNNER_FILE];
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    fireEvent.click(continueButton()); // Target -> Preview
    fireEvent.click(continueButton()); // Preview -> Configure

    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes).toHaveLength(3);
    checkboxes.forEach((cb) => fireEvent.click(cb));

    expect(continueButton()).toBeDisabled();
  });

  it("AC-9: the runner entry shows a placeholder instead of code; the workflow entry is the only editable one", () => {
    mockPreviewFiles = [WORKFLOW_FILE, MANIFEST_FILE, RUNNER_FILE];
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    fireEvent.click(continueButton()); // Target -> Preview

    // The workflow file is selected first — its editable affordance shows,
    // and its content is a real, editable textarea.
    expect(screen.getByRole("textbox")).toBeInTheDocument();

    fireEvent.click(screen.getByText(RUNNER_FILE.path));

    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.getByText(/bundled review runner ships with this pull request/i)).toBeInTheDocument();
  });

  it("AC-8 (UI half): a runner-bundle failure surfaces the server's own message with no success state", () => {
    mockPreviewError = new Error("Runner bundle not found — run `cd agent-runner && pnpm build`.");
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    fireEvent.click(continueButton()); // Target -> Preview

    expect(screen.getByText(/runner bundle not found/i)).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    expect(screen.queryByText(/files to create/i)).not.toBeInTheDocument();
  });

  it("AC-44: the Configure step's secrets block is static — no ready/not-set pill, no request on open", () => {
    mockPreviewFiles = [WORKFLOW_FILE, RUNNER_FILE];
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    fireEvent.click(continueButton()); // Target -> Preview
    fireEvent.click(continueButton()); // Preview -> Configure

    expect(screen.getByText("OPENROUTER_API_KEY")).toBeInTheDocument();
    expect(screen.getByText("GITHUB_TOKEN")).toBeInTheDocument();
    expect(screen.queryByText(/\bready\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/not set/i)).not.toBeInTheDocument();
    // Reaching Configure fired exactly the one preview call from entering
    // Preview — never a second network call just for opening Configure.
    expect(previewMutate).toHaveBeenCalledTimes(1);
  });

  it("AC-45: the blocking callout names 'Fail CI on' + branch protection and never a GitHub App", () => {
    mockPreviewFiles = [WORKFLOW_FILE, RUNNER_FILE];
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    fireEvent.click(continueButton());
    fireEvent.click(continueButton());

    expect(screen.getByText(/fail ci on/i)).toBeInTheDocument();
    expect(screen.getByText(/required in the repository.s branch protection/i)).toBeInTheDocument();
    // The copy explicitly reassures no GitHub App is needed — it must never
    // instead claim one IS required (the superseded string I5 deleted).
    expect(screen.getByText(/no github app is needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/requires a github app/i)).not.toBeInTheDocument();
  });

  it("AC-10: an edit made in Preview is sent verbatim as `workflow` on export", () => {
    mockPreviewFiles = [WORKFLOW_FILE, RUNNER_FILE];
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    fireEvent.click(continueButton()); // -> Preview
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "on:\n  pull_request: {}\n" } });
    fireEvent.click(continueButton()); // -> Configure
    fireEvent.click(continueButton()); // -> Install

    fireEvent.click(screen.getByRole("button", { name: /^install$/i }));

    expect(exportMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: AGENT.id,
        input: expect.objectContaining({ workflow: "on:\n  pull_request: {}\n" }),
      }),
    );
  });

  it("AC-28 (UI half): the Install step renders a working link to the opened PR", () => {
    mockPreviewFiles = [WORKFLOW_FILE, RUNNER_FILE];
    mockExportPrUrl = "https://github.com/acme/payments-api/pull/7";
    renderWithIntl(<ExportWizard agent={AGENT} onClose={vi.fn()} />);

    fireEvent.click(continueButton());
    fireEvent.click(continueButton());
    fireEvent.click(continueButton());

    const link = screen.getByRole("link", { name: /view pull request/i });
    expect(link).toHaveAttribute("href", mockExportPrUrl);
  });
});
