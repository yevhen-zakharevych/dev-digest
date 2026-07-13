/**
 * Unit tests for the judge's reply parser — no model, no network.
 *
 * This function had NO test and broke CI twice in one day (2026-07-13), both times because the
 * old JSON contract could not survive its own payload: a verbatim quote out of a markdown report
 * carries `"`, `[`, `]`, backticks and em-dashes, and the judge emitted them unescaped. Every case
 * below feeds the parser exactly the kind of evidence that used to blow it up.
 */

import { describe, test, expect } from "vitest";
import { parseVerdict } from "./llm-judge.js";

const PRACTICES = ["names the layer", "cites the principle", "keeps the list clean"];

describe("parseVerdict", () => {
  test("evidence may contain the quotes and brackets that used to break JSON", () => {
    // The literal line that killed the `…with a Mermaid graph` case in CI.
    const mermaid = 'subgraph internal["Internal — TypeScript path aliases (source, not npm)"]';
    const reply = [
      "[[1]] PASS",
      `[[EVIDENCE]] ${mermaid}`,
      "[[2]] PASS",
      "[[EVIDENCE]] Violates the Dependency Rule: `service.ts:13` reads `process.env.GITHUB_TOKEN`",
      "[[3]] FAIL",
      "[[EVIDENCE]]",
    ].join("\n");

    const results = parseVerdict(reply, PRACTICES);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({ practice: PRACTICES[0], passed: true, evidence: mermaid });
    expect(results[1].passed).toBe(true);
    expect(results[2]).toEqual({ practice: PRACTICES[2], passed: false, evidence: "" });
  });

  test("evidence may contain markdown table pipes — a `|`-delimited format would have failed here", () => {
    const row = "| `e2e/` | npm | **not installed** | manifest only — no sizes |";
    const results = parseVerdict(`[[1]] PASS\n[[EVIDENCE]] ${row}\n[[2]] FAIL\n[[EVIDENCE]]\n[[3]] FAIL\n[[EVIDENCE]]`, PRACTICES);
    expect(results[0].evidence).toBe(row);
  });

  test("the practice wording is OURS, never the judge's paraphrase", () => {
    // aggregate() keys its series by practice text, so a paraphrased echo used to split one
    // practice into two phantom rows across a repeat series.
    const results = parseVerdict("[[1]] PASS\n[[EVIDENCE]] x\n[[2]] PASS\n[[EVIDENCE]] y\n[[3]] PASS\n[[EVIDENCE]] z", PRACTICES);
    expect(results.map((r) => r.practice)).toEqual(PRACTICES);
  });

  test("verdicts are keyed by [[n]], so an out-of-order reply lands on the right practice", () => {
    const reply = ["[[3]] PASS", "[[EVIDENCE]] third", "[[1]] FAIL", "[[EVIDENCE]]", "[[2]] PASS", "[[EVIDENCE]] second"].join("\n");
    const results = parseVerdict(reply, PRACTICES);
    expect(results.map((r) => r.passed)).toEqual([false, true, true]);
    expect(results[2].evidence).toBe("third");
  });

  test("surrounding prose and a stray code fence are ignored, not fatal", () => {
    const reply = [
      "Sure! Here is my assessment:",
      "```",
      "[[1]] PASS",
      "[[EVIDENCE]] the summary states the change crosses no layer boundary",
      "[[2]] FAIL",
      "[[EVIDENCE]]",
      "[[3]] PASS",
      "[[EVIDENCE]] FINDINGS: (none)",
      "```",
      "Let me know if you'd like more detail.",
    ].join("\n");
    const results = parseVerdict(reply, PRACTICES);
    expect(results.map((r) => r.passed)).toEqual([true, false, true]);
  });

  test("a skipped practice throws — a partial answer must be re-asked, never scored", () => {
    const reply = "[[1]] PASS\n[[EVIDENCE]] a\n[[2]] PASS\n[[EVIDENCE]] b";
    expect(() => parseVerdict(reply, PRACTICES)).toThrow(/skipped practice\(s\) 3 of 3/);
  });

  test("a reply with no verdict lines at all throws", () => {
    expect(() => parseVerdict("I cannot evaluate this output.", PRACTICES)).toThrow(/no \[\[n\]\] PASS\/FAIL lines/);
  });

  test("a PASS with no evidence line still parses, and carries empty evidence", () => {
    // Deliberately NOT auto-downgraded to FAIL here: the parser reports what the judge said, and
    // changing the grading semantics is a separate decision from fixing a crash.
    const results = parseVerdict("[[1]] PASS\n[[2]] FAIL\n[[EVIDENCE]]\n[[3]] FAIL\n[[EVIDENCE]]", PRACTICES);
    expect(results[0]).toEqual({ practice: PRACTICES[0], passed: true, evidence: "" });
  });
});
