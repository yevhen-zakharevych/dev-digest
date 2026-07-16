/**
 * LLM Message Pattern judge. Binary PASS/FAIL per practice, PASS only with a verbatim evidence
 * quote. The judge should run in a different family from the task where possible, to soften
 * single-model self-preference; the structural mitigations (blind + binary + verbatim) do the rest.
 *
 * The reply format is LINE-BASED, not JSON. That is deliberate — see JUDGE_RUBRIC.
 */

import { EVAL_JUDGE_MODEL } from "../config.js";
import { runContent } from "../runtime/dispatch.js";

/**
 * WHY NOT JSON.
 *
 * The judge's `evidence` is a VERBATIM quote lifted out of a markdown report, so it routinely
 * contains double quotes, brackets, backticks and em-dashes — e.g. a Mermaid line like
 *   subgraph internal["Internal — TypeScript path aliases (source, not npm)"]
 * Asking a model to hand-write that inside a JSON string means asking it to escape correctly every
 * single time. It does not. Two CI runs on 2026-07-13 died on exactly this:
 *   SyntaxError: Expected ',' or ']' after array element in JSON at position 2113   (deepseek)
 *   SyntaxError: Expected ',' or ']' after array element in JSON at position 449    (haiku)
 * The second one landed AFTER the rubric was already told to escape quotes and keep evidence on one
 * line — so this is not a model-quality problem that a firmer instruction fixes. It is the format.
 *
 * A case that dies here is scored on the JUDGE'S SYNTAX, not on the artifact — the same class of
 * lie as the dead-session bug in INSIGHTS.md.
 *
 * The line format below cannot be broken by its own payload: evidence is read RAW to end-of-line,
 * so there is nothing to escape and nothing to balance. The judge also no longer echoes the
 * practice text back (we key by [[n]] and fill the wording from our own array), which retires a
 * second landmine: a paraphrased echo used to split one practice into two phantom rows in
 * `aggregate()`, whose series are keyed by practice text.
 */
const JUDGE_RUBRIC =
  "You are a strict, blind evaluator. Given an OUTPUT and a numbered list of PRACTICES, judge each " +
  "practice independently.\n\n" +
  "Rules:\n" +
  "1. Exactly PASS or FAIL per practice. No scales, no partial credit.\n" +
  "2. PASS only when a direct VERBATIM quote from the OUTPUT proves the practice was met. A " +
  "keyword is not evidence. If you cannot quote it, it is a FAIL.\n" +
  "3. Answer EVERY practice, in order, using EXACTLY this two-line block and nothing else:\n\n" +
  "[[1]] PASS\n" +
  "[[EVIDENCE]] <the verbatim quote, on ONE line>\n" +
  "[[2]] FAIL\n" +
  "[[EVIDENCE]]\n\n" +
  "4. Do NOT use JSON. Do NOT use a markdown fence. Do NOT restate the practice. The evidence is " +
  "read raw to the end of the line, so do NOT escape anything — paste the quote exactly as it " +
  "appears, quotes and brackets and all. Keep it to one line; if the span you want is multi-line, " +
  "quote the single most telling line of it.";

export interface Verdict {
  results: { practice: string; passed: boolean; evidence: string }[];
  passed: number;
  total: number;
  score: number;
}

const VERDICT_LINE = /^\s*\[\[(\d+)\]\]\s*(PASS|FAIL)\b/i;
const EVIDENCE_LINE = /^\s*\[\[EVIDENCE\]\]\s?(.*)$/i;

/**
 * Read the judge's reply into one result per practice, keyed by the [[n]] marker rather than by
 * position — a judge that answers out of order, or repeats itself, cannot silently shift a verdict
 * onto the wrong practice. Any line that is neither marker (stray prose, a fence, a preamble) is
 * ignored, so the parser is tolerant of everything EXCEPT a missing verdict, which throws so the
 * caller can re-ask rather than score a partial answer.
 *
 * Exported for the unit tests: this function is the one place a malformed reply can turn into a
 * wrong number, and it had no test before it broke CI twice.
 */
export function parseVerdict(text: string, practices: string[]): Verdict["results"] {
  const byIndex = new Map<number, { passed: boolean; evidence: string }>();
  let open: number | undefined;

  for (const line of text.split(/\r?\n/)) {
    const v = line.match(VERDICT_LINE);
    if (v) {
      open = Number(v[1]);
      byIndex.set(open, { passed: v[2].toUpperCase() === "PASS", evidence: "" });
      continue;
    }
    const e = line.match(EVIDENCE_LINE);
    if (e && open !== undefined) {
      const entry = byIndex.get(open);
      if (entry) entry.evidence = e[1].trim();
      open = undefined; // the evidence line closes its block
    }
  }

  if (byIndex.size === 0) {
    throw new Error(`judge returned no [[n]] PASS/FAIL lines: ${text.slice(0, 200)}`);
  }
  const missing = practices.map((_, i) => i + 1).filter((n) => !byIndex.has(n));
  if (missing.length) {
    throw new Error(`judge skipped practice(s) ${missing.join(", ")} of ${practices.length}`);
  }

  // The practice WORDING is ours, never the model's — see the note on JUDGE_RUBRIC.
  return practices.map((practice, i) => {
    const r = byIndex.get(i + 1)!;
    return { practice, passed: r.passed, evidence: r.evidence };
  });
}

/**
 * Ask the judge once. Throws on a transport failure (named as infra, not as a verdict) and on an
 * unreadable reply — the caller decides whether to re-ask.
 */
async function askJudge(prompt: string, model: string, practices: string[]): Promise<Verdict["results"]> {
  const res = await runContent(prompt, { allowedTools: [], maxTurns: 1, model });
  // The runners swallow a transport failure into `text` + isError, so an HTTP 402/403/429 from the
  // provider would otherwise reach the parser as a "response" and be reported as a bad verdict —
  // an INFRA failure wearing a bad-answer costume. Name it for what it is before parsing.
  if (res.isError) throw new Error(`judge call FAILED (infra, not a verdict) on ${model}: ${res.text.slice(0, 300)}`);
  return parseVerdict(res.text, practices);
}

/** Judge an output against a list of practices. Model defaults to the stronger judge family. */
export async function llmJudge(output: string, practices: string[], model = EVAL_JUDGE_MODEL): Promise<Verdict> {
  const listed = practices.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const prompt = `${JUDGE_RUBRIC}\n\n## PRACTICES\n${listed}\n\n## OUTPUT\n${output}\n\nAnswer now, using the [[n]] / [[EVIDENCE]] blocks.`;

  // ONE re-ask, and only for an UNREADABLE reply — never for a verdict we dislike. A judge whose
  // answer we cannot read has told us nothing about the artifact, so scoring the case on it would
  // measure the judge, not the skill. An infra error is NOT retried: it rethrows immediately,
  // because re-asking a rate-limited or unfunded key just burns another call.
  let judged: Verdict["results"];
  try {
    judged = await askJudge(prompt, model, practices);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("judge call FAILED")) throw err;
    judged = await askJudge(
      `${prompt}\n\nYour previous reply could not be read (${err instanceof Error ? err.message : String(err)}). ` +
        `Answer again using ONLY the two-line blocks: a line "[[n]] PASS" or "[[n]] FAIL", each ` +
        `followed by a line starting "[[EVIDENCE]] ". One block per practice, ${practices.length} in total.`,
      model,
      practices,
    );
  }

  const total = judged.length || 1;
  const passed = judged.filter((r) => r.passed).length;
  return { results: judged, passed, total, score: passed / total };
}
