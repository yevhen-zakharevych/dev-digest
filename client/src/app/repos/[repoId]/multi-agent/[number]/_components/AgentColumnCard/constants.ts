import type { AgentColumn } from "@devdigest/shared";

/** Column-header status dot colours. `cancelled` is terminal but NOT completed
 *  — it reads as muted, not as a failure. */
export const STATUS_COLOR: Record<AgentColumn["status"], string> = {
  done: "var(--ok, var(--accent))",
  failed: "var(--crit)",
  running: "var(--accent)",
  cancelled: "var(--text-muted)",
};
