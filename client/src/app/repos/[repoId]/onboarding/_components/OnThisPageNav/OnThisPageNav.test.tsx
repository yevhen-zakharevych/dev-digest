import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";
import { OnThisPageNav } from "./OnThisPageNav";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function sections(): OnboardingSection[] {
  return [
    { kind: "architecture", title: "Architecture", body: "…", diagram: null, links: [] },
    { kind: "critical_paths", title: "Critical Paths", body: "…", diagram: null, links: [] },
    { kind: "run_locally", title: "Run Locally", body: "…", diagram: null, links: [] },
    { kind: "reading_path", title: "Reading Path", body: "…", diagram: null, links: [] },
    { kind: "first_tasks", title: "First Tasks", body: "…", diagram: null, links: [] },
  ];
}

describe("OnThisPageNav", () => {
  it("renders the 'On this page' label and a keyboard-reachable anchor link per section (AC-17, AC-19)", () => {
    renderWithIntl(<OnThisPageNav sections={sections()} />);

    expect(screen.getByText("On this page")).toBeInTheDocument();

    const nav = screen.getByRole("navigation", { name: "Onboarding sections" });
    const links = nav.querySelectorAll("a[href]");
    expect(links).toHaveLength(5);
    expect(links[0]).toHaveAttribute("href", "#architecture");
    expect(links[1]).toHaveAttribute("href", "#critical_paths");
    expect(links[2]).toHaveAttribute("href", "#run_locally");
    expect(links[3]).toHaveAttribute("href", "#reading_path");
    expect(links[4]).toHaveAttribute("href", "#first_tasks");
    // Real anchors — focusable/keyboard-operable by default, no extra wiring.
    for (const link of links) {
      expect(link.tagName).toBe("A");
    }
  });

  it("falls back to the section's own title for an unmapped kind instead of throwing MISSING_MESSAGE", () => {
    renderWithIntl(
      <OnThisPageNav
        sections={[
          { kind: "custom_kind" as never, title: "Custom Section", body: "…", diagram: null, links: [] },
        ]}
      />,
    );
    expect(screen.getByText("Custom Section")).toBeInTheDocument();
  });

  it("does not throw when IntersectionObserver is unavailable, as in jsdom", () => {
    expect(typeof IntersectionObserver).toBe("undefined");
    expect(() => renderWithIntl(<OnThisPageNav sections={sections()} />)).not.toThrow();
  });
});
