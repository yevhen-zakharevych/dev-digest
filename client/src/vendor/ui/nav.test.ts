import { describe, it, expect } from "vitest";
import { NAV } from "./nav";

describe("NAV", () => {
  it("registers the Onboarding Tour item in the WORKSPACE section, pointing at the repo-scoped route (AC-19)", () => {
    const workspace = NAV.find((g) => g.section === "WORKSPACE");
    const item = workspace?.items.find((i) => i.key === "onboarding-tour");
    expect(item).toBeDefined();
    expect(item?.href).toBe("/repos/:repoId/onboarding");
    expect(item?.label).toBe("Onboarding Tour");
  });
});
