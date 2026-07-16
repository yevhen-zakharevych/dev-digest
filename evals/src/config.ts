/**
 * All tunables in one place. No logic here — just the knobs the rest of the package reads.
 * Nothing in this module imports from another src module (it is the bottom of the dependency
 * graph): config knows nothing of runtime, scoring, or the SDK.
 */

// --- Models -----------------------------------------------------------------
// Cheap model under test by default; the judge is a stronger family to soften self-preference.
export const EVAL_MODEL = process.env.EVAL_MODEL ?? "claude-haiku-4-5";
export const EVAL_JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL ?? "claude-sonnet-5";
export const MAX_TURNS = Number(process.env.EVAL_MAX_TURNS ?? "8");

/**
 * Output cap for the OpenAI-format content call (run-openrouter.ts). MUST be set explicitly:
 * OpenRouter PRE-AUTHORIZES credits against `max_tokens`, and when the field is omitted it
 * assumes the model's maximum output (64_000 for claude-haiku-4.5). A judge verdict is a few
 * hundred tokens of JSON, but the omitted cap made every judge call demand a 64k-token credit
 * reservation — which failed with `402 … you requested up to 64000 tokens, but can only afford
 * 51849` on a key with a modest balance. 8k comfortably fits the longest artifact report we
 * produce (the 5-section dependency-checker one) and cuts the reservation ~8x.
 */
export const EVAL_MAX_TOKENS = Number(process.env.EVAL_MAX_TOKENS ?? "8192");

// --- Configuration tag ------------------------------------------------------
// "candidate" = artifact injected (normal). "baseline" = no artifact (benchmark lift baseline).
export const EVAL_CONFIG = process.env.EVAL_CONFIG ?? "candidate";
export const IS_BASELINE = EVAL_CONFIG === "baseline";

// --- Scoring / statistics thresholds ---------------------------------------
export const DEFAULT_THRESHOLD = 0.6; // judge score gate for a quality case
export const FLAKY_LOW = 0.2; // pass rate strictly inside (20%, 80%) is "flaky"
export const FLAKY_HIGH = 0.8;
export const COST_REGRESSION_RATIO = 1.25; // candidate mean tokens > 125% of baseline

// --- Tool allow-lists -------------------------------------------------------
// Subagent-spawning tool name varies by harness; count both.
export const SPAWN_TOOLS = new Set(["Task", "Agent"]);
// workflowTask runs against the LIVE repo with bypassPermissions — keep this read-only.
export const WORKFLOW_ALLOWED_TOOLS = ["Read", "Grep", "Glob", "Task", "Agent", "Skill"];

// --- Output verbosity -------------------------------------------------------
// Set EVAL_QUIET to suppress per-run trace/verdict spam during multi-run aggregation.
export const QUIET = Boolean(process.env.EVAL_QUIET);
