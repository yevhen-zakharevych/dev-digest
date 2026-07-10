import type { BriefDegradedReason } from '@devdigest/shared';

/**
 * L06 — Why+Risk Brief constants (no I/O, no logic). Rate-limit numbers,
 * temperature, prompt-template name, and input-size safety caps live here so
 * the route/service read them by name rather than embedding magic numbers.
 */

/**
 * Per-route rate limit for the (cost-incurring, single-model-call) generate
 * route — at least as tight as the intent/review precedent (AC-20). The read
 * route carries NO override (unthrottled beyond the 120/min global default).
 * NOTE: rate-limiting is disabled under `NODE_ENV=test`, so tests assert this
 * override EXISTS, not a live 429 (`server/CLAUDE.md`).
 */
export const BRIEF_GENERATE_RATE_LIMIT = { max: 10, timeWindow: '1 minute' } as const;

/** Low temperature: the field set + risk vocabulary must be stable (AC-8). */
export const BRIEF_TEMPERATURE = 0;

/** Generous ceiling for the single structured call (the input is summaries, not a diff). */
export const BRIEF_MAX_TOKENS = 4000;

/** The `risk_brief` system prompt template (editable markdown, kept out of logic). */
export const BRIEF_PROMPT_TEMPLATE = 'brief.system.md';

/** Cap on the linked-issue body slice fed to the model (mirrors intent-layer's cap). */
export const MAX_ISSUE_BODY_CHARS = 3000;

/**
 * The closed set of degraded reasons (mirrors the shared `BriefDegradedReason`
 * enum). Kept as a typed const so the service can only emit an in-vocabulary
 * reason (AC-16 — the reason code is a closed set the client maps to i18n).
 */
export const BRIEF_DEGRADED_REASONS = {
  MODEL_FAILED: 'model_failed',
  NO_INPUTS: 'no_inputs',
} as const satisfies Record<string, BriefDegradedReason>;
