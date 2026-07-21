import { describe, it, expect } from "vitest";
import type { AgentColumn, MultiAgentRun } from "@devdigest/shared";
import { MULTI_RUN_POLL_MS, multiRunPollInterval } from "./multi-agent-runs";

function column(status: AgentColumn["status"]): AgentColumn {
  return {
    run_id: `run-${status}`,
    agent_id: `agent-${status}`,
    agent_name: status,
    provider: null,
    model: null,
    status,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: [],
  };
}

function run(columns: AgentColumn[]): MultiAgentRun {
  return {
    id: "mr-1",
    pr_id: "pr-1",
    ran_at: "2026-07-21T00:00:00.000Z",
    agent_count: columns.length,
    total_duration_ms: 0,
    total_cost_usd: null,
    columns,
    conflicts: [],
  };
}

describe("multiRunPollInterval — AC-16 self-clearing poll", () => {
  it("polls while any column is still running", () => {
    expect(multiRunPollInterval(run([column("done"), column("running")]))).toBe(MULTI_RUN_POLL_MS);
  });

  it("stops once every column is terminal", () => {
    expect(multiRunPollInterval(run([column("done"), column("failed")]))).toBe(false);
  });

  it("treats `cancelled` as terminal — a cancelled agent must not poll forever", () => {
    expect(multiRunPollInterval(run([column("cancelled")]))).toBe(false);
  });

  it("does not poll before any data has arrived, or for a PR with no multi-run", () => {
    expect(multiRunPollInterval(undefined)).toBe(false);
    expect(multiRunPollInterval(null)).toBe(false);
  });
});
