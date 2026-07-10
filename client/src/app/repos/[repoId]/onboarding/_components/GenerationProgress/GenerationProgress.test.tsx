import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { RunEvent } from "@devdigest/shared";
import { GenerationProgress } from "./GenerationProgress";

afterEach(cleanup);

describe("GenerationProgress", () => {
  it("renders a live status region with no dismiss/close control, showing a hint when no events have arrived yet (AC-18)", () => {
    render(<GenerationProgress title="Generating…" hint="Waiting for the generation to start…" />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Generating…");
    expect(status).toHaveTextContent("Waiting for the generation to start…");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("streams the tail of SSE events once they arrive", () => {
    const events: RunEvent[] = [
      { runId: "run-1", seq: 1, kind: "info", msg: "Gathering repo facts…", t: "00.10" },
      { runId: "run-1", seq: 2, kind: "info", msg: "Calling the model…", t: "00.50" },
    ];
    render(<GenerationProgress title="Generating…" hint="Waiting…" events={events} />);

    expect(screen.getByText(/Gathering repo facts/)).toBeInTheDocument();
    expect(screen.getByText(/Calling the model/)).toBeInTheDocument();
  });
});
