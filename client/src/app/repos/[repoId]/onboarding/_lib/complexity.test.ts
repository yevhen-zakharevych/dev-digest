import { describe, it, expect } from "vitest";
import { extractComplexity, splitTaskBlocks } from "./complexity";

describe("splitTaskBlocks", () => {
  it("splits a markdown body into one block per top-level bullet", () => {
    const body = [
      "- Add tests for `foo.ts` (untested). Complexity: Medium",
      "  It has no corresponding spec file.",
      "- Resolve the TODO in `bar.ts`. Complexity: Low",
    ].join("\n");

    const blocks = splitTaskBlocks(body);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toContain("foo.ts");
    expect(blocks[0]).toContain("no corresponding spec file");
    expect(blocks[1]).toContain("bar.ts");
  });

  it("returns an empty array when the body has no starter gaps (AC-7 edge case: no fabricated tasks)", () => {
    expect(splitTaskBlocks("No obvious starter gaps were found in this repo.")).toEqual([]);
    expect(splitTaskBlocks(null)).toEqual([]);
  });
});

describe("extractComplexity", () => {
  it("pulls the deterministic Low/Medium/High token out of a task block, case-insensitively (AC-8)", () => {
    expect(extractComplexity("Fix foo.ts. Complexity: Medium")).toBe("Medium");
    expect(extractComplexity("Fix bar.ts. complexity: HIGH")).toBe("High");
    expect(extractComplexity("Fix baz.ts. Complexity: low")).toBe("Low");
  });

  it("returns null when the block carries no complexity marker", () => {
    expect(extractComplexity("Fix qux.ts — no badge here.")).toBeNull();
  });
});
