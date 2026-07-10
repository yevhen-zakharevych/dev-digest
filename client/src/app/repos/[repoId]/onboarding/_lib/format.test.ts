import { describe, it, expect } from "vitest";
import { describeRelativeTime } from "./format";

describe("describeRelativeTime", () => {
  const now = Date.parse("2026-07-10T12:00:00.000Z");

  it("buckets a past timestamp into now/minutes/hours/days", () => {
    expect(describeRelativeTime(new Date(now - 30_000).toISOString(), now)).toEqual({
      unit: "now",
      value: 0,
    });
    expect(describeRelativeTime(new Date(now - 5 * 60_000).toISOString(), now)).toEqual({
      unit: "minutes",
      value: 5,
    });
    expect(describeRelativeTime(new Date(now - 3 * 3_600_000).toISOString(), now)).toEqual({
      unit: "hours",
      value: 3,
    });
    expect(describeRelativeTime(new Date(now - 2 * 86_400_000).toISOString(), now)).toEqual({
      unit: "days",
      value: 2,
    });
  });

  it("never goes negative for a clock-skewed future timestamp", () => {
    expect(describeRelativeTime(new Date(now + 60_000).toISOString(), now)).toEqual({
      unit: "now",
      value: 0,
    });
  });
});
