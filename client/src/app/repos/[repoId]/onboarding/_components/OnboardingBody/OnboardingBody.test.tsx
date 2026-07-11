import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingResponse, RunEvent } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";

// House style: mock the hooks modules rather than standing up a real
// QueryClient (client/INSIGHTS.md "A component whose data comes from a
// `lib/hooks/<domain>.ts` TanStack hook is tested by `vi.mock`-ing the
// hooks module").
vi.mock("@/lib/hooks/onboarding", () => ({
  useOnboarding: vi.fn(),
  useGenerateOnboarding: vi.fn(),
  isOnboardingScanResult: (r: unknown) => typeof (r as { scanId?: unknown }).scanId === "string",
}));
const mockUseRunEvents = vi.fn(
  (_ids: string[]): { events: RunEvent[]; running: boolean } => ({ events: [], running: false }),
);
vi.mock("@/lib/hooks/reviews", () => ({
  useRunEvents: (ids: string[]) => mockUseRunEvents(ids),
}));
vi.mock("@/lib/repo-context", () => ({
  useActiveRepo: vi.fn(() => ({ activeRepo: { id: "r1", full_name: "acme/widgets" } })),
}));

import { useOnboarding, useGenerateOnboarding } from "@/lib/hooks/onboarding";
import { OnboardingBody } from "./OnboardingBody";

afterEach(cleanup);

function renderWithIntl() {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      <OnboardingBody repoId="r1" />
    </NextIntlClientProvider>,
  );
}

function response(o: Partial<OnboardingResponse> = {}): OnboardingResponse {
  return {
    sections: [
      { kind: "architecture", title: "Architecture", body: "…", diagram: null, links: [] },
      { kind: "critical_paths", title: "Critical Paths", body: "…", diagram: null, links: [] },
      { kind: "run_locally", title: "Run Locally", body: "1. `pnpm install`", diagram: null, links: [] },
      { kind: "reading_path", title: "Reading Path", body: "…", diagram: null, links: [] },
      { kind: "first_tasks", title: "First Tasks", body: "…", diagram: null, links: [] },
    ],
    status: "fresh",
    degraded: false,
    indexedSha: "abc123",
    filesIndexed: 10,
    generatedAt: new Date().toISOString(),
    ...o,
  };
}

describe("OnboardingBody", () => {
  it("shows the Generate empty state when no artifact exists yet, then subscribes to SSE progress on the async full-generation path (AC-11, AC-18)", async () => {
    mockUseRunEvents.mockImplementation((ids: string[]) =>
      ids.length > 0
        ? { events: [{ runId: ids[0]!, seq: 1, kind: "info", msg: "Gathering facts…", t: "00.10" }], running: true }
        : { events: [], running: false },
    );
    const mutateAsync = vi.fn().mockResolvedValue({ scanId: "run-1" });
    vi.mocked(useOnboarding).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useGenerateOnboarding).mockReturnValue({ mutateAsync, isPending: false } as never);

    renderWithIntl();

    const generateBtn = screen.getByRole("button", { name: "Generate onboarding tour" });
    expect(generateBtn).toBeInTheDocument();
    fireEvent.click(generateBtn);

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledWith({ repoId: "r1", force: false }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Gathering facts"));
  });

  it("never renders SSE progress on the synchronous degraded generate path (plan §13 Gap 3)", async () => {
    mockUseRunEvents.mockImplementation(() => ({ events: [], running: false }));
    const degraded = response({ degraded: true, degradedReason: "no_data" });
    const mutateAsync = vi.fn().mockResolvedValue(degraded);
    vi.mocked(useOnboarding).mockReturnValue({
      data: null,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useGenerateOnboarding).mockReturnValue({ mutateAsync, isPending: false } as never);

    renderWithIntl();
    fireEvent.click(screen.getByRole("button", { name: "Generate onboarding tour" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    // The mutation resolved with a full OnboardingResponse (no scanId) — no
    // scanId was ever handed to `useRunEvents`, and no progress region exists.
    expect(mockUseRunEvents).toHaveBeenCalledWith([]);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders the header + all five sections for a stale artifact (AC-14: stale still renders) and forces Regenerate with force:true (AC-15)", () => {
    mockUseRunEvents.mockImplementation(() => ({ events: [], running: false }));
    const mutateAsync = vi.fn().mockResolvedValue(response());
    vi.mocked(useOnboarding).mockReturnValue({
      data: response({ status: "stale" }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useGenerateOnboarding).mockReturnValue({ mutateAsync, isPending: false } as never);

    renderWithIntl();

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Onboarding for acme/widgets");
    for (const testId of [
      "onboarding-section-architecture",
      "onboarding-section-critical_paths",
      "onboarding-section-run_locally",
      "onboarding-section-reading_path",
      "onboarding-section-first_tasks",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }

    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(mutateAsync).toHaveBeenCalledWith({ repoId: "r1", force: true });
  });

  it("re-seeds a non-dismissible progress state from the persisted `generating` flag after a reload, with no local scanId (AC-18, client/INSIGHTS.md:92-93)", () => {
    mockUseRunEvents.mockImplementation(() => ({ events: [], running: false }));
    vi.mocked(useOnboarding).mockReturnValue({
      data: response({ generating: true }),
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    } as never);
    vi.mocked(useGenerateOnboarding).mockReturnValue({ mutateAsync: vi.fn(), isPending: false } as never);

    renderWithIntl();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();
  });
});
