import { describe, it, expect } from "vitest";
import type { AgentEstimate } from "@devdigest/shared";
import {
  computeEstimateSummary,
  formatAgentDuration,
  formatAgentHint,
  formatSeconds,
} from "./helpers";

const ESTIMATES: AgentEstimate[] = [
  { agent_id: "a1", avg_duration_ms: 8200, avg_cost_usd: 0.06, sample_size: 5 },
  { agent_id: "a2", avg_duration_ms: 12000, avg_cost_usd: 0.02, sample_size: 3 },
  { agent_id: "a3", avg_duration_ms: null, avg_cost_usd: null, sample_size: 0 },
];

describe("formatSeconds", () => {
  it("keeps one decimal below 10s and rounds above", () => {
    expect(formatSeconds(8200)).toBe("8.2s");
    expect(formatSeconds(12000)).toBe("12s");
  });
});

describe("formatAgentHint (AC-7)", () => {
  it("renders a numeric time+cost hint for an agent with history", () => {
    expect(formatAgentHint(ESTIMATES[0])).toBe("8.2s · $0.060");
  });

  /* "No history" is returned as `null`, not as a display string: the two entry
     points label it differently ("—" on the Configure page, "no history" in the
     PR-page panel) and the label is an i18n key, which a pure helper must not
     reach for. What matters for AC-7 is that it is never a fabricated 0s/$0. */
  it("returns null for a row with a null avg_duration_ms", () => {
    expect(formatAgentHint(ESTIMATES[2])).toBeNull();
  });

  it("returns null when the agent has no row at all", () => {
    expect(formatAgentHint(undefined)).toBeNull();
  });
});

describe("formatAgentDuration (AC-1 — the PR-page picker's time-only hint)", () => {
  it("renders duration alone, with no cost", () => {
    expect(formatAgentDuration(ESTIMATES[0])).toBe("8.2s");
    expect(formatAgentDuration(ESTIMATES[1])).toBe("12s");
  });

  it("returns null for no history, never 0s", () => {
    expect(formatAgentDuration(ESTIMATES[2])).toBeNull();
    expect(formatAgentDuration(undefined)).toBeNull();
  });
});

describe("computeEstimateSummary (AC-8, AC-9)", () => {
  /* Time SUMS, it does not take the max: the server awaits each agent in turn
     (`modules/reviews/run-executor.ts:129`), so two agents of 8.2 s and 12 s
     take 20.2 s of wall clock, not 12 s. */
  it("time = SUM and cost = SUM across agents that both have history", () => {
    const summary = computeEstimateSummary(["a1", "a2"], ESTIMATES);
    expect(summary.timeMs).toBe(20200);
    expect(summary.costUsd).toBeCloseTo(0.08);
    expect(summary.approximate).toBe(false);
  });

  it("excludes a history-less agent from the cost sum and marks the summary approximate", () => {
    const summary = computeEstimateSummary(["a1", "a3"], ESTIMATES);
    expect(summary.timeMs).toBe(8200);
    expect(summary.costUsd).toBeCloseTo(0.06);
    expect(summary.approximate).toBe(true);
  });

  it("renders no numeric time/cost when every selected agent lacks history", () => {
    const summary = computeEstimateSummary(["a3"], ESTIMATES);
    expect(summary.timeMs).toBeNull();
    expect(summary.costUsd).toBeNull();
    expect(summary.approximate).toBe(true);
  });

  it("treats an agent absent from the estimates array as history-less too", () => {
    const summary = computeEstimateSummary(["ghost"], ESTIMATES);
    expect(summary.timeMs).toBeNull();
    expect(summary.costUsd).toBeNull();
    expect(summary.approximate).toBe(true);
  });

  it("is independent of selection order", () => {
    const a = computeEstimateSummary(["a1", "a2", "a3"], ESTIMATES);
    const b = computeEstimateSummary(["a3", "a2", "a1"], ESTIMATES);
    expect(a).toEqual(b);
  });

  it("returns no time/cost for an empty selection", () => {
    const summary = computeEstimateSummary([], ESTIMATES);
    expect(summary).toEqual({ timeMs: null, costUsd: null, approximate: false });
  });
});
