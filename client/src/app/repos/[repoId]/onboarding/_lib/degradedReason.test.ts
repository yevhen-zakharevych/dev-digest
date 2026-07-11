import { describe, it, expect } from "vitest";
import { onboardingDegradedReasonLabel } from "./degradedReason";

describe("onboardingDegradedReasonLabel", () => {
  const t = (key: string) => `translated:${key}`;

  it("maps every known reason code to a translated message (AC-12)", () => {
    for (const reason of ["flag_off", "index_failed", "index_partial", "repo_too_large", "no_data"]) {
      expect(onboardingDegradedReasonLabel(t, reason)).toBe(`translated:degraded.reason.${reason}`);
    }
  });

  it("falls back to the raw code for an unmapped reason instead of throwing MISSING_MESSAGE (AC-12)", () => {
    expect(onboardingDegradedReasonLabel(t, "some_future_reason")).toBe("some_future_reason");
  });

  it("returns null for a null/undefined reason", () => {
    expect(onboardingDegradedReasonLabel(t, null)).toBeNull();
    expect(onboardingDegradedReasonLabel(t, undefined)).toBeNull();
  });
});
