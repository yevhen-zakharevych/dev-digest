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

  it("registers the CI Runs item in a GLOBAL section, pointing at the workspace-wide route (AC-41)", () => {
    const global = NAV.find((g) => g.section === "GLOBAL");
    const item = global?.items.find((i) => i.key === "ci-runs");
    expect(item).toBeDefined();
    expect(item?.href).toBe("/ci-runs");
    expect(item?.label).toBe("CI Runs");
  });
});
