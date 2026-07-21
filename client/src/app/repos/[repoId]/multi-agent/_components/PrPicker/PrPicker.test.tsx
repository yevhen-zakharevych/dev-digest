import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PrMeta } from "@devdigest/shared";
import messages from "../../../../../../../messages/en/multiAgent.json";
import { PrPicker } from "./PrPicker";

afterEach(cleanup);

const PULLS: PrMeta[] = [
  {
    id: "pr1",
    number: 12,
    title: "Fix login bug",
    author: "alice",
    branch: "fix/login",
    base: "main",
    head_sha: "abc123",
    additions: 3,
    deletions: 1,
    files_count: 2,
    status: "open",
  },
] as unknown as PrMeta[];

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ multiAgent: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe("PrPicker", () => {
  it("lists every pull request as an option", () => {
    renderWithIntl(<PrPicker pulls={PULLS} value={null} onChange={() => {}} />);
    expect(screen.getByText("#12 · Fix login bug")).toBeInTheDocument();
  });

  it("calls onChange with the PR number when a PR is selected", () => {
    const onChange = vi.fn();
    renderWithIntl(<PrPicker pulls={PULLS} value={null} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith(12);
  });
});
