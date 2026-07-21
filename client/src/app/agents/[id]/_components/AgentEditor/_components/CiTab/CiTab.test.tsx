import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, CiInstallation, CiRun } from "@devdigest/shared";
import messages from "../../../../../../../../messages/en/ci.json";
import type { CiInstallationRow } from "./types";

// Populated per-test via module-level `let`s — the `vi.mock` factory can't
// close over bindings declared after it (hoisting), so the mock reads these
// directly at call time (mirrors `EvalsTab.test.tsx:12-19`).
let mockInstallations: CiInstallationRow[] | undefined;
let mockInstallationsLoading = false;
const updateConfigMutate = vi.fn();
const updateAgentMutate = vi.fn();

vi.mock("@/lib/hooks/ci-export", () => ({
  useCiInstallations: () => ({ data: mockInstallations, isLoading: mockInstallationsLoading }),
  useUpdateCiConfig: () => ({ mutate: updateConfigMutate, isPending: false }),
  useCiPreview: () => ({ mutate: vi.fn(), data: undefined, error: null, isPending: false, isError: false }),
  useExportToCi: () => ({ mutate: vi.fn(), data: undefined, error: null, isPending: false }),
}));

vi.mock("@/lib/hooks/agents", () => ({
  useUpdateAgent: () => ({ mutate: updateAgentMutate, isPending: false }),
}));

vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: () => ({ activeRepo: null, repos: [], repoId: null, setRepoId: vi.fn(), reposLoaded: true }),
}));

import { CiTab } from "./CiTab";

afterEach(() => {
  cleanup();
  mockInstallations = undefined;
  mockInstallationsLoading = false;
  updateConfigMutate.mockClear();
  updateAgentMutate.mockClear();
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

function makeInstallation(overrides: Partial<CiInstallation> = {}): CiInstallation {
  return {
    id: "inst1",
    agent_id: AGENT.id,
    repo: "acme/payments-api",
    target_type: "gha",
    installed_at: "2026-07-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeRun(overrides: Partial<CiRun> = {}): CiRun {
  return {
    id: "run1",
    ci_installation_id: "inst1",
    pr_number: 42,
    ran_at: "2026-07-20T10:00:00.000Z",
    status: "succeeded",
    findings_count: 2,
    cost_usd: 0.05,
    github_url: "https://github.com/acme/payments-api/actions/runs/1",
    source: "gha",
    ...overrides,
  };
}

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

describe("CiTab", () => {
  it("shows the empty state when the agent has no installations", () => {
    mockInstallations = [];
    renderWithIntl(<CiTab agent={AGENT} />);

    expect(screen.getByText(/not deployed to ci yet/i)).toBeInTheDocument();
  });

  it("AC-1: 'Add to CI' opens a modal with a 4-step stepper starting on Target", () => {
    mockInstallations = [];
    renderWithIntl(<CiTab agent={AGENT} />);

    fireEvent.click(screen.getByRole("button", { name: /add to ci/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    // The current step's label is echoed a second time in a visually-hidden
    // `aria-live` region (assistive-tech announcement) — `getAllByText`
    // tolerates that intentional duplicate for "Target".
    expect(screen.getAllByText("Target").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Preview")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
    expect(screen.getByText("Install")).toBeInTheDocument();
    // Starts on Target: GitHub Actions is pre-selected.
    expect(screen.getByRole("radio", { name: /github actions/i })).toHaveAttribute("aria-checked", "true");
  });

  it("AC-43: a repo with no ingested run shows the neutral 'no runs yet' state, never a stale status", () => {
    mockInstallations = [{ ...makeInstallation(), last_run: null }];
    renderWithIntl(<CiTab agent={AGENT} />);

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    // Exactly ONE node says it: the shared status pill owns the null state, and the
    // recency slot beside it stays absent rather than echoing the same sentence.
    // `getAllByText` here would hide a regression that reintroduces the duplicate.
    expect(screen.getAllByText(/no runs yet/i)).toHaveLength(1);
    expect(screen.queryByText(/succeeded|failed/i)).not.toBeInTheDocument();
  });

  it("AC-43: lists one row per installed repository with an 'Active in N repos' count", () => {
    mockInstallations = [
      { ...makeInstallation(), last_run: makeRun() },
      { ...makeInstallation({ id: "inst2", repo: "acme/web" }), last_run: null },
    ];
    renderWithIntl(<CiTab agent={AGENT} />);

    expect(screen.getByText("acme/payments-api")).toBeInTheDocument();
    expect(screen.getByText("acme/web")).toBeInTheDocument();
    expect(screen.getByText(/active in 2 repos/i)).toBeInTheDocument();
  });

  it("AC-30/AC-31: 'Update CI config' is per-row, with no header-level bulk control", () => {
    mockInstallations = [
      { ...makeInstallation(), last_run: makeRun() },
      { ...makeInstallation({ id: "inst2", repo: "acme/web" }), last_run: null },
    ];
    renderWithIntl(<CiTab agent={AGENT} />);

    const updateButtons = screen.getAllByRole("button", { name: /update ci config/i });
    expect(updateButtons).toHaveLength(2);

    fireEvent.click(updateButtons[0]!);
    expect(updateConfigMutate).toHaveBeenCalledTimes(1);
    expect(updateConfigMutate).toHaveBeenCalledWith(
      expect.objectContaining({ installationId: "inst1" }),
      expect.anything(),
    );
  });

  it("AC-29: 'Fail CI on' persists via the existing useUpdateAgent mutation", () => {
    mockInstallations = [];
    renderWithIntl(<CiTab agent={AGENT} />);

    fireEvent.change(screen.getByRole("combobox"), { target: { value: "any" } });
    expect(updateAgentMutate).toHaveBeenCalledWith({ id: AGENT.id, patch: { ci_fail_on: "any" } });
  });
});
