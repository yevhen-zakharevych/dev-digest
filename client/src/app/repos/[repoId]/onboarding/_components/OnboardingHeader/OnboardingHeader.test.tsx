import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingResponse } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";
import { OnboardingHeader } from "./OnboardingHeader";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function response(o: Partial<OnboardingResponse> = {}): OnboardingResponse {
  return {
    sections: [
      { kind: "architecture", title: "Architecture", body: "…", diagram: null, links: [] },
      { kind: "critical_paths", title: "Critical Paths", body: "…", diagram: null, links: [] },
      { kind: "run_locally", title: "Run Locally", body: "…", diagram: null, links: [] },
      { kind: "reading_path", title: "Reading Path", body: "…", diagram: null, links: [] },
      { kind: "first_tasks", title: "First Tasks", body: "…", diagram: null, links: [] },
    ],
    status: "fresh",
    degraded: false,
    indexedSha: "abc123",
    filesIndexed: 42,
    generatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    ...o,
  };
}

describe("OnboardingHeader", () => {
  it("shows the title (with the repo name as a mono chip), subtitle (file count + refreshed time), Regenerate, and a disabled Share (AC-20) — the anchor nav itself now lives in OnThisPageNav (AC-17, AC-19)", () => {
    const onRegenerate = vi.fn();
    renderWithIntl(
      <OnboardingHeader
        repoName="acme/widgets"
        data={response()}
        onRegenerate={onRegenerate}
        regenerating={false}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Onboarding for acme/widgets");
    expect(screen.getByText(/index of 42 files/)).toBeInTheDocument();
    expect(screen.getByText(/refreshed/)).toBeInTheDocument();

    // The header no longer owns the anchor nav — no `navigation` role here.
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();

    const regenerateBtn = screen.getByRole("button", { name: "Regenerate" });
    fireEvent.click(regenerateBtn);
    expect(onRegenerate).toHaveBeenCalledTimes(1);

    // AC-20: Share is present-but-disabled and never calls anything.
    const shareBtn = screen.getByRole("button", { name: "Share" });
    expect(shareBtn).toBeDisabled();
  });

  it("shows the stale status badge (AC-14) and disables Regenerate while a run is in progress (AC-18)", () => {
    renderWithIntl(
      <OnboardingHeader
        repoName="acme/widgets"
        data={response({ status: "stale" })}
        onRegenerate={vi.fn()}
        regenerating={true}
      />,
    );
    expect(screen.getByText(/Stale/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Regenerating…" })).toBeDisabled();
  });

  it("maps a known degraded reason code to its i18n message, not the raw code (AC-12)", () => {
    renderWithIntl(
      <OnboardingHeader
        repoName="acme/widgets"
        data={response({ degraded: true, degradedReason: "index_partial" })}
        onRegenerate={vi.fn()}
        regenerating={false}
      />,
    );
    expect(screen.getByText(/only partially built/)).toBeInTheDocument();
    expect(screen.queryByText("index_partial")).not.toBeInTheDocument();
  });

  it("falls back to the raw reason code for an unmapped degraded reason instead of throwing MISSING_MESSAGE (AC-12)", () => {
    renderWithIntl(
      <OnboardingHeader
        repoName="acme/widgets"
        // Cast bypasses the closed enum only to prove the client's fallback
        // path — the server never emits an out-of-vocabulary code today.
        data={response({ degraded: true, degradedReason: "some_future_reason" as never })}
        onRegenerate={vi.fn()}
        regenerating={false}
      />,
    );
    expect(screen.getByText(/some_future_reason/)).toBeInTheDocument();
  });
});
