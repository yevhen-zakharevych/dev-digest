import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CopyButton } from "./CopyButton";

afterEach(cleanup);

describe("CopyButton", () => {
  it("copies the given text to the clipboard on click and briefly confirms via the accessible name (keyboard-operable, R3)", () => {
    const writeText = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } });

    render(<CopyButton text="pnpm install" label="Copy command" copiedLabel="Copied!" />);

    const btn = screen.getByRole("button", { name: "Copy command" });
    fireEvent.click(btn);

    expect(writeText).toHaveBeenCalledWith("pnpm install");
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();

    vi.unstubAllGlobals();
  });
});
