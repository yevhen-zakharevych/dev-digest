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

  it("registers Multi-Agent Review in the GLOBAL section, not WORKSPACE (AC-1 nav placement)", () => {
    const global = NAV.find((g) => g.section === "GLOBAL");
    const item = global?.items.find((i) => i.key === "multi-agent");
    expect(item).toBeDefined();
    expect(item?.href).toBe("/repos/:repoId/multi-agent");
    expect(item?.label).toBe("Multi-Agent Review");

    const workspace = NAV.find((g) => g.section === "WORKSPACE");
    expect(workspace?.items.some((i) => i.key === "multi-agent")).toBe(false);
  });

  /* A nav entry whose route does not exist is a dangling link, and the sidebar
     has no auto-discovery to catch it. This is an ALLOWLIST, not proof the
     routes exist: it cannot see `src/app/`. Its value is that adding a nav item
     forces a deliberate edit here, so "I'll wire the page later" cannot ship
     silently. Verify the route by hand when you add a line. */
  it("points every nav item at an href on the reviewed allowlist", () => {
    const known = new Set([
      "/repos/:repoId/pulls",
      "/repos/:repoId/onboarding",
      "/repos/:repoId/context",
      "/repos/:repoId/multi-agent",
      "/skills",
      "/agents",
      "/conventions",
      "/evals",
    ]);
    for (const group of NAV) {
      for (const item of group.items) {
        expect(known, `${group.section} → ${item.key}`).toContain(item.href);
      }
    }
  });
});
