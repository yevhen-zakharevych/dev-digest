/**
 * CI Runs read + manual-refresh ingest (AC-32 … AC-38, AC-40).
 *
 * INGESTION HAPPENS HERE AND NOWHERE ELSE. There is no timer, no boot hook and
 * no read-path side effect: `list()` only queries storage, and `refresh()` runs
 * exactly once per user-initiated request. AC-32 states that leaving the CI Runs
 * page open for an hour must issue no ingestion, and the only way to guarantee
 * that is for this to be the sole entry point.
 */
import type { CiRun } from '@devdigest/shared';
import { CiResultArtifact } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import {
  MAX_WORKFLOW_RUNS,
  RESULT_ARTIFACT_NAME,
  RESULT_FILENAME,
  WORKFLOW_FILE_BASENAME,
} from './constants.js';
import type { CiInstallationRow, UpsertRunValues } from './repository.js';
import { parseRepoSlug, toCiRunDto } from './service.js';

/** Where an ingested row came from — the CI Runs table's "source" column. */
const RUN_SOURCE = 'github_actions';

/** A run row plus its installation's repository slug (AC-40, composed at the repo layer). */
export type CiRunWithRepoDto = CiRun & { repo: string };

/** AC-37 — one repository that could not be refreshed, with the reason. */
export interface CiRefreshFailure {
  repo: string;
  message: string;
}

export interface CiRefreshResult {
  runs: CiRunWithRepoDto[];
  failed: CiRefreshFailure[];
}

export class CiRunsService {
  constructor(private container: Container) {}

  /**
   * AC-38 — only runs reachable installation → agent → workspace. A pure read:
   * it issues no GitHub request at all, which is what makes AC-32's "no
   * ingestion at any other time" observable.
   */
  async list(workspaceId: string): Promise<CiRunWithRepoDto[]> {
    const rows = await this.container.ciRepo.listRuns(workspaceId);
    return rows.map((row) => ({ ...toCiRunDto(row.run), repo: row.repo }));
  }

  /**
   * AC-32 — ONE bounded listing per installation in the caller's workspace,
   * capped at the 20 most recent runs of the generated workflow file.
   *
   * AC-37 — one installation's GitHub failure does not abort the rest: each
   * installation is isolated, and the repositories that failed come back named
   * in `failed` while every other installation's runs still land.
   */
  async refresh(workspaceId: string): Promise<CiRefreshResult> {
    const installations = await this.container.ciRepo.listInstallationsForWorkspace(workspaceId);
    const failed: CiRefreshFailure[] = [];

    if (installations.length > 0) {
      const github = await this.container.github();
      for (const installation of installations) {
        try {
          await this.ingestInstallation(github, installation);
        } catch (err) {
          failed.push({ repo: installation.repo, message: (err as Error).message });
        }
      }
    }

    return { runs: await this.list(workspaceId), failed };
  }

  /** Every workflow run of one installation, ingested into `ci_runs`. */
  private async ingestInstallation(
    github: Awaited<ReturnType<Container['github']>>,
    installation: CiInstallationRow,
  ): Promise<void> {
    const { owner, name } = parseRepoSlug(installation.repo);
    const repoRef = { owner, name };
    const runs = await github.listWorkflowRuns(
      repoRef,
      WORKFLOW_FILE_BASENAME,
      MAX_WORKFLOW_RUNS,
    );

    for (const run of runs) {
      // A run still queued/in-progress has no artifact yet, so it is not even
      // asked for — the status is `running` by definition of "not completed".
      const artifactText =
        run.status === 'completed'
          ? await github.downloadRunResultArtifact(
              repoRef,
              run.id,
              RESULT_ARTIFACT_NAME,
              RESULT_FILENAME,
            )
          : null;

      const values = deriveRunValues(run, artifactText);
      // AC-38 — the installation id is always resolved BEFORE the write, so no
      // row is ever created without one.
      await this.container.ciRepo.upsertRun(installation.id, run.htmlUrl, values);
    }
  }
}

/** The reduced workflow-run shape ingest reads. Matches the `CiWorkflowRunRef` port type. */
interface WorkflowRunLike {
  id: number;
  htmlUrl: string;
  status: string;
  conclusion: string | null;
  prNumber: number | null;
  createdAt: string;
}

/**
 * AC-33 — status is derived from the ARTIFACT, never from the workflow run's
 * own conclusion:
 *
 *   artifact present, ≥ 1 finding      → `succeeded`
 *   artifact present, 0 findings       → `no_findings`
 *   completed, no readable artifact    → `failed`
 *   not completed                      → `running`
 *
 * The case this rule exists for: a run that BLOCKED the PR has conclusion
 * `failure` and an artifact full of findings. Deriving from `conclusion` would
 * record the gate working as a failure of the review. `run.conclusion` is
 * therefore not read anywhere in this function.
 *
 * AC-35 — a missing, unreadable or non-validating artifact persists NOTHING
 * from the payload: not `findings_count`, not `cost_usd`, not `duration_s`, and
 * not `agent`. What survives is the run's OWN metadata (url, PR number, time),
 * which does not come from the payload — an unreadable artifact must not cost
 * the row its Actions link.
 */
export function deriveRunValues(
  run: WorkflowRunLike,
  artifactText: string | null,
): UpsertRunValues {
  const base: UpsertRunValues = {
    prNumber: run.prNumber,
    ranAt: parseDate(run.createdAt),
    status: run.status === 'completed' ? 'failed' : 'running',
    findingsCount: null,
    costUsd: null,
    // From the workflow-run listing, NOT the artifact — a `failed` row keeps it.
    githubUrl: run.htmlUrl,
    source: RUN_SOURCE,
    agent: null,
    durationS: null,
  };

  if (run.status !== 'completed' || artifactText === null) return base;

  const parsed = safeParseArtifact(artifactText);
  // Not `success` ⇒ fall back to `base`, whose every artifact-derived field is
  // already null. Nothing is copied out of a payload that failed validation,
  // however plausible its individual fields looked.
  if (!parsed) return base;

  return {
    ...base,
    status: parsed.findings_count >= 1 ? 'succeeded' : 'no_findings',
    // GitHub's own value wins. The artifact's `pr_number` is third-party text and
    // letting it override would let a crafted artifact file a run against an unrelated
    // pull request. It is used only when the listing has none.
    prNumber: run.prNumber ?? parsed.pr_number ?? null,
    findingsCount: parsed.findings_count,
    costUsd: parsed.cost_usd,
    // Third-party text produced by someone else's CI. Stored as a plain string and never
    // interpolated anywhere — unlike `repo`, which is a value this server owns because it
    // comes from the installation row.
    //
    // TRUNCATED because the contract puts no bound on it: an artifact that decompresses
    // within every size guard can still carry a megabytes-long name, which would be
    // persisted and then re-served in full to every client on every CI Runs page load.
    agent: truncateAgent(parsed.agent),
    // The contract field is SECONDS; the artifact carries milliseconds. Absent
    // ⇒ null, never 0 (0 would read as "instantaneous review").
    durationS: parsed.duration_ms === null || parsed.duration_ms === undefined
      ? null
      : parsed.duration_ms / 1000,
  };
}

/**
 * Longest agent name we will persist. A display label, not a document — anything past
 * this is a producer misbehaving, and the row is still perfectly readable truncated.
 */
const MAX_AGENT_NAME_CHARS = 200;

function truncateAgent(agent: string): string {
  return agent.length <= MAX_AGENT_NAME_CHARS ? agent : `${agent.slice(0, MAX_AGENT_NAME_CHARS)}…`;
}

/** JSON + Zod, both fail-soft. Returns `null` for anything that is not a valid artifact. */
function safeParseArtifact(text: string): CiResultArtifact | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const result = CiResultArtifact.safeParse(json);
  return result.success ? result.data : null;
}

/** `null` rather than an `Invalid Date` row when GitHub hands back something unparseable. */
function parseDate(value: string): Date | null {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
