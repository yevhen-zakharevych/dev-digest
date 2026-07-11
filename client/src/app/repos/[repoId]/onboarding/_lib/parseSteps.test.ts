import { describe, it, expect } from "vitest";
import { parseRunSteps } from "./parseSteps";

describe("parseRunSteps", () => {
  it("extracts one step per numbered markdown list line, stripping inline code/bold for the clipboard value (AC-5)", () => {
    const body = [
      "Follow these steps to boot the app:",
      "",
      "1. `pnpm install`",
      "2. `docker compose up -d`",
      "3. **`pnpm dev`**",
      "",
      "That's it.",
    ].join("\n");

    const steps = parseRunSteps(body);

    expect(steps).toHaveLength(3);
    expect(steps[0]).toEqual({ raw: "`pnpm install`", command: "pnpm install" });
    expect(steps[1]?.command).toBe("docker compose up -d");
    expect(steps[2]?.command).toBe("pnpm dev");
  });

  it("returns an empty array when the body has no numbered list (degraded skeleton fallback)", () => {
    expect(parseRunSteps("No local-run steps could be determined for this repo.")).toEqual([]);
    expect(parseRunSteps(null)).toEqual([]);
    expect(parseRunSteps(undefined)).toEqual([]);
  });

  it("supports the 'N)' numbering variant, not just 'N.'", () => {
    const steps = parseRunSteps("1) npm install\n2) npm start");
    expect(steps.map((s) => s.command)).toEqual(["npm install", "npm start"]);
  });
});
