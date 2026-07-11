import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { OnboardingSection } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/onboarding.json";
import { SectionRenderer } from "./SectionRenderer";

afterEach(cleanup);

// `MermaidDiagram` dynamically imports the `mermaid` package and renders
// async SVG — stub it so the test asserts structure (rendered or not),
// not mermaid's own parsing/rendering.
vi.mock("@/components/MermaidDiagram", () => ({
  __esModule: true,
  default: ({ chart }: { chart: string }) => <div data-testid="mermaid-stub">{chart}</div>,
}));

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

function section(o: Partial<OnboardingSection> = {}): OnboardingSection {
  return {
    kind: "architecture",
    title: "Architecture Overview",
    body: "The app is a Fastify API + Next.js client.",
    diagram: null,
    links: [],
    ...o,
  };
}

describe("SectionRenderer", () => {
  it("renders a mermaid diagram only for architecture, never for other kinds (AC-3)", () => {
    const { rerender } = renderWithIntl(
      <SectionRenderer
        section={section({ kind: "architecture", diagram: "flowchart TD\nA-->B" })}
        repoFullName="acme/widgets"
        sha="deadbeef"
      />,
    );
    expect(screen.getByTestId("mermaid-stub")).toHaveTextContent("flowchart TD");

    rerender(
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        {/* Even a (contract-violating) non-null diagram on a non-architecture
           section must never render — the gate is on `kind`, not on
           `diagram` truthiness alone. */}
        <SectionRenderer
          section={section({
            kind: "critical_paths",
            title: "Critical Paths",
            diagram: "flowchart TD\nX-->Y",
          })}
          repoFullName="acme/widgets"
          sha="deadbeef"
        />
      </NextIntlClientProvider>,
    );
    expect(screen.queryByTestId("mermaid-stub")).not.toBeInTheDocument();
  });

  it("renders an Open link per {label, path} for critical_paths (AC-4)", () => {
    renderWithIntl(
      <SectionRenderer
        section={section({
          kind: "critical_paths",
          title: "Critical Paths",
          body: "The review pipeline is load-bearing.",
          links: [{ label: "Review pipeline", path: "server/src/review.ts" }],
        })}
        repoFullName="acme/widgets"
        sha="deadbeef"
      />,
    );
    expect(screen.getByText("Review pipeline")).toBeInTheDocument();
    expect(screen.getByText("server/src/review.ts")).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Open" });
    expect(open).toHaveAttribute(
      "href",
      "https://github.com/acme/widgets/blob/deadbeef/server/src/review.ts",
    );
  });

  it("renders each run_locally step with its own keyboard-operable copy button (AC-5)", () => {
    renderWithIntl(
      <SectionRenderer
        section={section({
          kind: "run_locally",
          title: "Run Locally",
          body: "1. `pnpm install`\n2. `pnpm dev`",
        })}
        repoFullName="acme/widgets"
        sha="deadbeef"
      />,
    );
    expect(screen.getByText("pnpm install")).toBeInTheDocument();
    expect(screen.getByText("pnpm dev")).toBeInTheDocument();
    // Query by accessible NAME, not a raw button count on the section — the
    // card header's collapse chevron is also a `<button>` inside this
    // `data-testid` section, so a total-button-count assertion would break
    // the moment the chevron was added.
    const copyButtons = screen.getAllByRole("button", { name: "Copy command" });
    expect(copyButtons).toHaveLength(2);
    // Native <button> — focusable/keyboard-operable by default, no extra wiring.
    expect(copyButtons[0]?.tagName).toBe("BUTTON");
  });

  it("wraps the section in a card whose collapse chevron toggles the body without hiding the title/icon header", () => {
    renderWithIntl(
      <SectionRenderer
        section={section({ kind: "architecture", title: "Architecture Overview" })}
        repoFullName="acme/widgets"
        sha="deadbeef"
      />,
    );

    expect(screen.getByTestId("onboarding-section-architecture")).toBeInTheDocument();
    expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
    expect(screen.getByText(/Fastify API/)).toBeInTheDocument();

    const collapseBtn = screen.getByRole("button", { name: "Collapse section" });
    fireEvent.click(collapseBtn);

    // Body content hides; the title/icon header stays visible.
    expect(screen.queryByText(/Fastify API/)).not.toBeInTheDocument();
    expect(screen.getByText("Architecture Overview")).toBeInTheDocument();
    const expandBtn = screen.getByRole("button", { name: "Expand section" });

    fireEvent.click(expandBtn);
    expect(screen.getByText(/Fastify API/)).toBeInTheDocument();
  });

  it("renders the first-task complexity badge as visible TEXT, not colour alone (AC-8), and no monetary figure anywhere (AC-10)", () => {
    renderWithIntl(
      <SectionRenderer
        section={section({
          kind: "first_tasks",
          title: "First Tasks",
          body: "- Add tests for `foo.ts` (untested). Complexity: Medium\n- Resolve TODO in `bar.ts`. Complexity: High",
        })}
        repoFullName="acme/widgets"
        sha="deadbeef"
      />,
    );
    expect(screen.getByText("Medium")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    // AC-10: cost is recorded to the trace/logs only, never rendered here.
    expect(screen.queryByText(/\$\d/)).not.toBeInTheDocument();
    expect(screen.queryByText(/costUsd/i)).not.toBeInTheDocument();
  });
});
