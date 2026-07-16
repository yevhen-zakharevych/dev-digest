import { createHash } from 'node:crypto';
import type { EvalExpectation, EvalExpectedItem, EvalForbiddenRegion } from '@devdigest/shared';

/**
 * Case fingerprinting (AC-14).
 *
 * A fingerprint is the join key a comparison (`compare.ts`) uses to decide
 * whether two runs actually saw the SAME case: it is a content hash over
 * every frozen input that reaches the model plus the expectation the case is
 * scored against. Editing the diff, the expectation, an expected item, or the
 * forbidden region MUST change the fingerprint; nothing else may.
 *
 * PURE and deterministic ACROSS PROCESSES:
 *  - no `Math.random`, no `Date`, no object-identity or Map/Set iteration
 *    order dependence;
 *  - `canonicalize` sorts every object's keys recursively before
 *    `JSON.stringify`, so two structurally-identical inputs built with keys
 *    in a different order hash identically;
 *  - `sha256` + `JSON.stringify` are stable Node built-ins — no reliance on
 *    object insertion order, WeakMap, or any other process-local state.
 */

export interface FingerprintInput {
  /** The case's frozen `input_diff.raw` (AC-6). */
  diff: string;
  /** The case's frozen PR meta (title + description) — `EvalCase.input_meta`, opaque JSON. */
  prMeta: unknown;
  expectation: EvalExpectation;
  expectedItems: EvalExpectedItem[];
  forbiddenRegion: EvalForbiddenRegion | null;
}

/**
 * Recursively sort object keys so two structurally-equal values with
 * differently-ordered keys serialize identically. Arrays keep their order —
 * order is semantic content, not incidental structure.
 */
export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) sorted[key] = canonicalize(obj[key]);
    return sorted;
  }
  return value;
}

/** A canonical, key-order-independent JSON serialization of `value`. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/**
 * Compute the case's input fingerprint: a sha256 hex digest over the
 * canonicalized frozen inputs + expectation. Two calls with structurally
 * identical input — in this process or a fresh one — always agree.
 */
export function computeFingerprint(input: FingerprintInput): string {
  const canonical = canonicalStringify({
    diff: input.diff,
    prMeta: input.prMeta,
    expectation: input.expectation,
    expectedItems: input.expectedItems,
    forbiddenRegion: input.forbiddenRegion,
  });
  return createHash('sha256').update(canonical).digest('hex');
}
