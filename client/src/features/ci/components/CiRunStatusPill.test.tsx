import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../../messages/en/ci.json";
import { CiRunStatusPill } from "./CiRunStatusPill";

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ ci: messages }}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(cleanup);

describe("CiRunStatusPill", () => {
  it("renders a text label for every status — colour is never the only signal", () => {
    for (const [status, label] of [
      ["succeeded", "Succeeded"],
      ["no_findings", "No findings"],
      ["failed", "Failed"],
      ["running", "Running"],
    ] as const) {
      renderWithIntl(<CiRunStatusPill status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      cleanup();
    }
  });

  it("renders a distinct 'no runs yet' state for null — NOT failed", () => {
    // An installation nobody has opened a PR against has not failed at anything;
    // collapsing null into `failed` would report a healthy deployment as broken.
    renderWithIntl(<CiRunStatusPill status={null} />);
    expect(screen.getByText("No runs yet")).toBeInTheDocument();
    expect(screen.queryByText("Failed")).not.toBeInTheDocument();
  });
});
