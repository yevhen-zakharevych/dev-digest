import { describe, it, expect } from "vitest";
import { activeKeyFor } from "./helpers";

describe("activeKeyFor", () => {
  it("highlights the repo-scoped Onboarding Tour entry for /repos/:repoId/onboarding", () => {
    expect(activeKeyFor("/repos/r1/onboarding")).toBe("onboarding-tour");
  });

  it("does NOT highlight it for the unrelated top-level /onboarding add-repo screen (AC-19)", () => {
    expect(activeKeyFor("/onboarding")).not.toBe("onboarding-tour");
  });

  it("still resolves the other repo-scoped routes correctly", () => {
    expect(activeKeyFor("/repos/r1/pulls")).toBe("pulls");
    expect(activeKeyFor("/repos/r1/context")).toBe("context");
  });
});
