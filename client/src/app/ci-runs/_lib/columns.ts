/* _lib/columns.ts — column definitions + pure formatters for the CI Runs
   table (AC-40). Route-local: this table is the only consumer.

   `CiRun` (`@devdigest/shared`) carries no dedicated repository field — the
   contract is already fixed for this task (it mirrors the `ci_runs` table,
   which is keyed by `ci_installation_id`, not a denormalized repo string).
   The spec's own wording for AC-40 says the Actions link "opens that run in
   the target repo's Actions tab", i.e. the repo is already encoded in
   `github_url` (`.../<owner>/<repo>/actions/runs/<id>`). Deriving it there
   avoids inventing a second field for data the contract already carries. */
import type { CiRun } from "@devdigest/shared";

export interface CiRunColumn {
  key: string;
  /** Suffix under the `ci` namespace, e.g. "runs.table.pullRequest". */
  labelKey: string;
}

/** The seven labelled columns; the eighth AC-40 value (the Actions run link)
 *  has no header of its own and reuses `runs.view` ("View") as its cell text. */
export const CI_RUN_COLUMNS: CiRunColumn[] = [
  { key: "pullRequest", labelKey: "runs.table.pullRequest" },
  { key: "repository", labelKey: "runs.table.repository" },
  { key: "agent", labelKey: "runs.table.agent" },
  { key: "status", labelKey: "runs.table.status" },
  { key: "findings", labelKey: "runs.table.findings" },
  { key: "cost", labelKey: "runs.table.cost" },
  { key: "duration", labelKey: "runs.table.duration" },
];

/** A `failed` run (AC-35) has null metric fields — render an explicit dash,
 *  never `NaN` / `null` / `undefined` as text. */
const DASH = "—";

export function formatPrNumber(v: CiRun["pr_number"]): string {
  return v == null ? DASH : `#${v}`;
}

export function formatFindings(v: CiRun["findings_count"]): string {
  return v == null ? DASH : String(v);
}

export function formatCost(v: CiRun["cost_usd"]): string {
  return v == null ? DASH : `$${v.toFixed(2)}`;
}

export function formatDuration(v: CiRun["duration_s"]): string {
  return v == null ? DASH : `${v.toFixed(1)}s`;
}
