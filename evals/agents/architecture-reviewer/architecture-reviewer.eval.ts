import { describeAgent, runAgentCases } from "../../src/index.js";
import { cases } from "./architecture-reviewer.cases.js";

// The STRICT variant — the real `.claude/agents/architecture-reviewer.md`, all rules intact.
// This is the A side of the A/B; the B side (architecture-reviewer-lite) runs the same cases.
describeAgent("architecture-reviewer", () => runAgentCases("architecture-reviewer", cases));
