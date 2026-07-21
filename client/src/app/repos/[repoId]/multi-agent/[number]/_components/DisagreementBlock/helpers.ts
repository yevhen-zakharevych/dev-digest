/* Pure helpers for the "Where agents disagree" block.

   AC-22: `Conflict` carries NO `is_conflict` field and the contract must not be
   widened, so conflict-ness is derived client-side from `takes[]`. Keeping it a
   pure function (rather than inline JSX logic) is what makes it unit-testable
   without mounting anything. */

import type { AgentColumn, Conflict, ConflictTake } from "@devdigest/shared";

/**
 * A group is a CONFLICT when the completed agents disagree:
 *   - at least one flagged AND at least one did not ("ignored"), OR
 *   - the flagging agents assigned divergent severities.
 * A group where every completed agent flagged it at the same severity is
 * unanimous, and so is a (degenerate) group where nobody flagged anything.
 */
export function isConflict(takes: ConflictTake[]): boolean {
  const flagged = takes.filter((t) => t.verdict !== "ignored");
  if (flagged.length === 0) return false;
  const ignoredCount = takes.length - flagged.length;
  if (ignoredCount > 0) return true;
  return new Set(flagged.map((t) => t.verdict)).size > 1;
}

/** Server order is authoritative — this filters, it never re-groups or re-sorts. */
export function filterConflicts(conflicts: Conflict[], onlyConflicts: boolean): Conflict[] {
  return onlyConflicts ? conflicts.filter((c) => isConflict(c.takes)) : conflicts;
}

/**
 * AC-21/AC-24: takes are computed over `done` columns only, so an agent still
 * `running` has no take — and must be shown as PENDING, never as "did not
 * flag". `failed`/`cancelled` agents never answered either, so they are absent
 * from the group entirely rather than being reported as a verdict.
 */
export function pendingAgents(columns: AgentColumn[], takes: ConflictTake[]): AgentColumn[] {
  const answered = new Set(takes.map((t) => t.agent_id));
  return columns.filter((c) => c.status === "running" && !answered.has(c.agent_id));
}
