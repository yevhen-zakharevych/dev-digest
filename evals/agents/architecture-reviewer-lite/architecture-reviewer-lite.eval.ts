import { describeAgent, runAgentCases } from "../../src/index.js";
// Deliberately imports the STRICT variant's cases — same fixtures, same practices, same
// thresholds. The only thing that differs between the two runs is the agent artifact
// `agentTask` injects as the system prompt, which is what makes this pair a controlled A/B
// rather than two unrelated evals.
import { cases } from "../architecture-reviewer/architecture-reviewer.cases.js";

// The WEAKENED variant — `.claude/agents/architecture-reviewer-lite.md`, with two rules cut:
// the "cite the violated principle by name" (falsifiability) rule, and the "never flag
// style/correctness/security/performance" scope carve-out. Everything else is byte-identical.
describeAgent("architecture-reviewer-lite", () => runAgentCases("architecture-reviewer-lite", cases));
