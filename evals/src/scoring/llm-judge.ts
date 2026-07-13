/**
 * LLM Message Pattern judge, on the subscription. Binary PASS/FAIL per practice, PASS only with
 * a verbatim evidence quote. The judge defaults to a stronger family than the task to soften
 * single-model self-preference; the structural mitigations (blind + binary + verbatim) do the
 * rest, since on a shared subscription the families overlap.
 */

import { EVAL_JUDGE_MODEL } from "../config.js";
import { runContent } from "../runtime/dispatch.js";

const JUDGE_RUBRIC =
  "You are a strict, blind evaluator. Given an OUTPUT and a list of PRACTICES, judge each " +
  "practice independently.\n" +
  "Rules: (1) exactly PASS or FAIL per practice, no scales. (2) PASS only when a direct " +
  "verbatim quote from the OUTPUT is evidence the practice was met — a keyword is not " +
  "evidence. (3) Reply with ONLY minified JSON, no prose and no markdown fence:\n" +
  '{"results":[{"practice":"<text>","passed":true,"evidence":"<verbatim quote>"}]}\n' +
  // (4) exists because the evidence field is the JSON-breaker: a verbatim quote lifted from a
  // markdown report carries double quotes and newlines, and a weaker judge model emits them RAW,
  // producing invalid JSON that JSON.parse rejects mid-array. Constrain the quote instead of
  // hoping — a single escaped line is still verbatim evidence.
  'Rule (4): "evidence" MUST be a SINGLE line — no raw newlines, escape every double quote as \\", ' +
  "and keep it under 200 characters. Quote the shortest span that proves the practice.";

export interface Verdict {
  results: { practice: string; passed: boolean; evidence: string }[];
  passed: number;
  total: number;
  score: number;
}

/**
 * Pull the verdict object out of the judge's reply. Tolerates the two things models do to JSON
 * even when told not to: wrapping it in a ```json fence, and padding it with prose. It does NOT
 * tolerate structurally invalid JSON — that throws, and llmJudge re-asks (one bad sample is
 * cheaper to redraw than to repair with regex heuristics that can silently flip a verdict).
 */
function parseVerdict(text: string): Verdict["results"] {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) throw new Error(`judge returned no JSON: ${text.slice(0, 200)}`);
  const obj = JSON.parse(body.slice(start, end + 1));
  if (!Array.isArray(obj.results)) throw new Error("judge JSON missing results[]");
  return obj.results;
}

/**
 * Ask the judge once. Throws on a transport failure (named as infra, not as a verdict) and on
 * unparseable JSON — the caller decides whether to re-ask.
 */
async function askJudge(prompt: string, model: string): Promise<Verdict["results"]> {
  const res = await runContent(prompt, { allowedTools: [], maxTurns: 1, model });
  // The runners swallow a transport failure into `text` + isError, so an HTTP 402/403/429 from the
  // provider would otherwise reach parseVerdict as a "response" and be reported as
  // `judge returned no JSON: 402 …` — an INFRA failure wearing a bad-answer costume, the same
  // disease as the dead-session bug in INSIGHTS.md. Name it for what it is before parsing.
  if (res.isError) throw new Error(`judge call FAILED (infra, not a verdict) on ${model}: ${res.text.slice(0, 300)}`);
  return parseVerdict(res.text);
}

/** Judge an output against a list of practices. Model defaults to the stronger judge family. */
export async function llmJudge(output: string, practices: string[], model = EVAL_JUDGE_MODEL): Promise<Verdict> {
  const listed = practices.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const prompt = `${JUDGE_RUBRIC}\n\n## PRACTICES\n${listed}\n\n## OUTPUT\n${output}\n\nReturn the JSON now.`;

  // ONE re-ask, and only for a MALFORMED reply — never for a verdict we dislike. A judge that
  // emits broken JSON has told us nothing about the artifact, so scoring the case on it measures
  // the judge's syntax, not the skill (`SyntaxError: Expected ',' … at position 2113` failed a
  // dependency-checker case in CI on 2026-07-13). An infra error is NOT retried here: it rethrows
  // immediately, because re-asking a rate-limited or unfunded key just burns another call.
  let judged: Verdict["results"];
  try {
    judged = await askJudge(prompt, model);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("judge call FAILED")) throw err;
    judged = await askJudge(
      `${prompt}\n\nYour previous reply was NOT valid JSON (${err instanceof Error ? err.message : String(err)}). ` +
        `Reply with ONLY the minified JSON object. Escape every double quote inside "evidence" as \\" ` +
        `and keep each evidence value on a single line.`,
      model,
    );
  }
  // The judge ECHOES the practice text back, and it paraphrases — one dropped word ("… / is a pure
  // local rename" → "… / a pure local rename") is enough to make `aggregate()`, which keys practice
  // series by that string, split one practice into two phantom rows across a repeat series. Restore
  // the canonical wording by position; the judge answers in order, so index is the reliable join.
  const results = judged.map((r, i) => ({ ...r, practice: practices[i] ?? r.practice }));
  const total = results.length || 1;
  const passed = results.filter((r) => r.passed).length;
  return { results, passed, total, score: passed / total };
}
