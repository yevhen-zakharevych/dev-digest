/* types.ts — the CI tab's own view-model types, composed from the two
   vendored contracts (client/AGENTS.md: "not redefined locally" — neither
   `CiInstallation` nor `CiRun`'s fields are hand-copied here, only
   intersected). */
import type { CiInstallation, CiRun } from "@devdigest/shared";

/** One row of `GET /agents/:id/ci/installations` — an installed repository
 *  plus its most recently ingested run, or `null` when none has landed yet
 *  (AC-43 — a repo with no ingested run is NEVER shown as a stale status). */
export type CiInstallationRow = CiInstallation & { last_run: CiRun | null };
