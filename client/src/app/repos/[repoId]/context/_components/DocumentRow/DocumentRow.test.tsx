import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { DiscoveredDocument } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/projectContext.json";
import { DocumentRow } from "./DocumentRow";

afterEach(cleanup);

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ projectContext: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const DOC: DiscoveredDocument = {
  path: "docs/architecture/invariants.md",
  bucket: "docs",
  estimated_tokens: 1234,
  used_by_agents: 2,
};

describe("DocumentRow", () => {
  it("shows the filename, its OWN folder path, and the bucket badge as colour PLUS a text label", () => {
    renderWithIntl(<DocumentRow doc={DOC} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText("invariants.md")).toBeInTheDocument();
    expect(screen.getByText("docs/architecture")).toBeInTheDocument();
    expect(screen.getByText("Docs")).toBeInTheDocument();
  });

  it("shows a different document's own folder path, not a hardcoded one", () => {
    const other: DiscoveredDocument = {
      path: "specs/2026-01-01-feature.md",
      bucket: "specs",
      estimated_tokens: 10,
      used_by_agents: 0,
    };
    renderWithIntl(<DocumentRow doc={other} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByText("2026-01-01-feature.md")).toBeInTheDocument();
    expect(screen.getByText("specs")).toBeInTheDocument();
  });

  it("calls onSelect with the document's path when clicked (keyboard-operable native button)", () => {
    const onSelect = vi.fn();
    renderWithIntl(<DocumentRow doc={DOC} selected={false} onSelect={onSelect} />);

    fireEvent.click(screen.getByTestId(`doc-row-${DOC.path}`));

    expect(onSelect).toHaveBeenCalledWith(DOC.path);
  });

  it("marks the selected row with aria-current", () => {
    renderWithIntl(<DocumentRow doc={DOC} selected onSelect={vi.fn()} />);

    expect(screen.getByTestId(`doc-row-${DOC.path}`)).toHaveAttribute("aria-current", "true");
  });

  it("does not mark an unselected row with aria-current", () => {
    renderWithIntl(<DocumentRow doc={DOC} selected={false} onSelect={vi.fn()} />);

    expect(screen.getByTestId(`doc-row-${DOC.path}`)).not.toHaveAttribute("aria-current");
  });
});
