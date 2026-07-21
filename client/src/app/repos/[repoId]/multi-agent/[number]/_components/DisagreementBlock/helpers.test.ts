import { describe, it, expect } from "vitest";
import type { AgentColumn, Conflict, ConflictTake } from "@devdigest/shared";
import { filterConflicts, isConflict, pendingAgents } from "./helpers";

function take(o: Partial<ConflictTake> & Pick<ConflictTake, "agent_id" | "verdict">): ConflictTake {
  return { persona: o.agent_id, note: "", ...o };
}

function column(o: Partial<AgentColumn> & Pick<AgentColumn, "agent_id" | "status">): AgentColumn {
  return {
    run_id: `run-${o.agent_id}`,
    agent_name: `Agent ${o.agent_id}`,
    provider: null,
    model: null,
    verdict: null,
    score: null,
    summary: null,
    duration_ms: null,
    cost_usd: null,
    findings: [],
    ...o,
  };
}

describe("isConflict (AC-22 — derived client-side, the contract carries no flag)", () => {
  it("is a conflict when one agent flagged and another did not", () => {
    expect(
      isConflict([take({ agent_id: "a", verdict: "CRITICAL" }), take({ agent_id: "b", verdict: "ignored" })]),
    ).toBe(true);
  });

  it("is a conflict when the flagging agents assigned divergent severities", () => {
    expect(
      isConflict([take({ agent_id: "a", verdict: "CRITICAL" }), take({ agent_id: "b", verdict: "WARNING" })]),
    ).toBe(true);
  });

  it("is NOT a conflict when every completed agent flagged it at the same severity", () => {
    expect(
      isConflict([take({ agent_id: "a", verdict: "WARNING" }), take({ agent_id: "b", verdict: "WARNING" })]),
    ).toBe(false);
  });

  it("is NOT a conflict for a lone flagging agent (nobody to disagree with)", () => {
    expect(isConflict([take({ agent_id: "a", verdict: "SUGGESTION" })])).toBe(false);
  });

  it("is NOT a conflict when nobody flagged anything", () => {
    expect(isConflict([take({ agent_id: "a", verdict: "ignored" })])).toBe(false);
    expect(isConflict([])).toBe(false);
  });
});

describe("filterConflicts", () => {
  const unanimous: Conflict = {
    file: "src/a.ts",
    line: 10,
    title: "agreed",
    takes: [take({ agent_id: "a", verdict: "WARNING" }), take({ agent_id: "b", verdict: "WARNING" })],
  };
  const contested: Conflict = {
    file: "src/b.ts",
    line: 41,
    title: "contested",
    takes: [take({ agent_id: "a", verdict: "CRITICAL" }), take({ agent_id: "b", verdict: "ignored" })],
  };

  it("passes everything through, in server order, when the toggle is off", () => {
    expect(filterConflicts([unanimous, contested], false)).toEqual([unanimous, contested]);
  });

  it("keeps only conflict groups when the toggle is on", () => {
    expect(filterConflicts([unanimous, contested], true)).toEqual([contested]);
  });

  it("never re-sorts or re-groups — it only filters", () => {
    const other: Conflict = { ...contested, file: "src/c.ts", line: 3, title: "also contested" };
    expect(filterConflicts([contested, unanimous, other], true).map((c) => c.file)).toEqual([
      "src/b.ts",
      "src/c.ts",
    ]);
  });
});

describe("pendingAgents (AC-24 — a running agent is never 'did not flag')", () => {
  it("returns running agents that have no take yet", () => {
    const cols = [
      column({ agent_id: "a", status: "done" }),
      column({ agent_id: "b", status: "running" }),
    ];
    expect(pendingAgents(cols, [take({ agent_id: "a", verdict: "CRITICAL" })]).map((c) => c.agent_id)).toEqual([
      "b",
    ]);
  });

  it("omits failed and cancelled agents entirely — they never answered either", () => {
    const cols = [
      column({ agent_id: "b", status: "failed" }),
      column({ agent_id: "c", status: "cancelled" }),
    ];
    expect(pendingAgents(cols, [])).toEqual([]);
  });

  it("drops an agent from pending once its take has arrived", () => {
    const cols = [column({ agent_id: "b", status: "running" })];
    expect(pendingAgents(cols, [take({ agent_id: "b", verdict: "ignored" })])).toEqual([]);
  });
});
