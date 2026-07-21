/**
 * CI export/install application service.
 *
 * Holds every rule the routes must not: input validation (AC-4, AC-11, AC-12,
 * AC-23, OQ-2), the no-write preview (AC-5), install (AC-24 … AC-28),
 * update-config (AC-30, AC-31) and tenancy (AC-46). Refuses by THROWING the
 * platform error taxonomy — routes never catch, never reclassify.
 *
 * Layering: pure generation comes from `manifest.ts`/`workflow.ts`/`bundle.ts`;
 * data access from `CiRepository`; the GitHub port and the runner-bundle reader
 * from the container. No `fs`, no octokit, no Fastify in this file.
 *
 * SECURITY — no caller-supplied path is accepted ANYWHERE on this path (AC-11).
 * Every repo path in the bundle is composed from `constants.ts` plus a slug this
 * module derives from a stored name and restricts to `[a-z0-9-]`. The request
 * body carries no path field, and the route rejects a body that invents one.
 * `server/INSIGHTS.md` records the weaker alternative that has bitten this repo
 * before: tree-boundary guards constrain WHERE a path lands but not WHICH file
 * it names. This module removes the question instead of answering it.
 */
import type { CiExportInput, CiExport, CiFile, CiInstallation, CiRun } from '@devdigest/shared';
import type { Container } from '../../platform/container.js';
import {
  BadRequestError,
  ExternalServiceError,
  NotFoundError,
} from '../../platform/errors.js';
import type { AgentRow, LinkedSkillRow } from '../agents/repository.js';
import { activeSkillLinks } from '../agents/effective-config.js';
import {
  AGENTS_DIR,
  ALLOWED_TRIGGER_TYPES,
  CI_BRANCH,
  POST_AS_VALUES,
  PR_TITLE,
  SKILLS_DIR,
  WORKFLOW_OVERRIDE_MAX_BYTES,
  type PostAs,
  type WorkflowTriggerType,
} from './constants.js';
import { buildBundle, toPreview, type BundleSkill, type RunnerFile } from './bundle.js';
import { checkWorkflowOverride } from './workflow-guard.js';
import type { CiInstallationRow, CiRunRow } from './repository.js';

/** Commit message for the "regenerate manifest + skills only" update (AC-30). */
const UPDATE_COMMIT_MESSAGE = 'Update DevDigest CI config';

/** `owner/name`, each segment starting alphanumeric. Rejects `acme`, `acme/`, URLs, `..`. */
const REPO_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** A git ref the caller may fork from. No `..`, no leading `-`, no whitespace, no `~^:?*[`. */
const BASE_REF_RE = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

/** The validated, normalised form of a wizard submission. Nothing downstream re-parses. */
interface ValidatedExportInput {
  owner: string;
  name: string;
  /** `owner/name`, re-composed from the parsed parts — never the raw string. */
  slug: string;
  triggers: WorkflowTriggerType[];
  postAs: PostAs;
  base: string;
  workflowOverride?: string;
}

export class CiService {
  constructor(private container: Container) {}

  // ---- Preview (AC-5) -----------------------------------------------------

  /**
   * The file list the wizard's Preview step renders. Performs NO write of any
   * kind — it never touches the GitHub port at all, so there is no code path
   * from here to a branch, a commit, a PR or an installation row.
   *
   * The runner entries come back with empty `contents` (`toPreview`) so the
   * response never carries the multi-megabyte bundle (AC-9).
   */
  async preview(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiFile[]> {
    const validated = this.validateInput(input);
    const files = await this.generate(workspaceId, agentId, validated);
    return toPreview(files);
  }

  // ---- Export / install (AC-24 … AC-28) -----------------------------------

  /**
   * Commit the whole bundle as ONE commit on `devdigest/ci` forked from the
   * requested base, then open (or reuse) the PR, then record the installation.
   *
   * Order is load-bearing:
   *  - validation and bundle generation run BEFORE any GitHub call (AC-4, AC-8);
   *  - the installation row is written only AFTER GitHub accepted the write, so
   *    a rejection leaves no installation and no partial success (AC-26).
   */
  async export(
    workspaceId: string,
    agentId: string,
    input: CiExportInput,
  ): Promise<CiExport> {
    const validated = this.validateInput(input);
    const files = await this.generate(workspaceId, agentId, validated);

    const github = await this.container.github();
    const repoRef = { owner: validated.owner, name: validated.name };

    // ONE commit carrying every generated file (AC-24). `commitFiles` creates a
    // blob per file and references it by SHA, so the request body does not grow
    // with the bundle.
    await this.withGitHubFailure(
      validated.slug,
      'push commits',
      'Nothing was committed and no CI installation was created.',
      () =>
        github.commitFiles(repoRef, {
          branch: CI_BRANCH,
          base: validated.base,
          message: PR_TITLE,
          files: files.map((f) => ({ path: f.path, contents: f.contents })),
        }),
    );

    // AC-25 — an already-open PR from `devdigest/ci` is REUSED, never duplicated.
    // The message here deliberately does NOT claim "nothing was committed": the
    // commit above already landed on `devdigest/ci`. What AC-26 forbids is a
    // PARTIAL SUCCESS being reported, and no installation is written below.
    const prUrl = await this.withGitHubFailure(
      validated.slug,
      'open pull requests',
      `The branch ${CI_BRANCH} was updated, but no pull request could be opened and no CI installation was created.`,
      async () => {
        const existing = await github.findOpenPr(repoRef, CI_BRANCH);
        if (existing) return existing.url;
        const opened = await github.openPullRequest(repoRef, {
          title: PR_TITLE,
          head: CI_BRANCH,
          base: validated.base,
          body: 'Adds the DevDigest review workflow, agent manifest and skills to this repository.',
        });
        return opened.url;
      },
    );

    const installation = await this.container.ciRepo.upsertInstallation(
      agentId,
      validated.slug,
      'gha',
    );

    // AC-28 — installation + committed file list + PR URL. The file list keeps
    // its committed PATHS but drops the runner BYTES (AC-9): the response is a
    // receipt, not a second copy of the bundle.
    return {
      installation: toCiInstallationDto(installation),
      files: toPreview(files),
      pr_url: prUrl,
    };
  }

  // ---- Installations for the agent's CI tab (AC-43) ------------------------

  /**
   * One row per installed repository plus that repository's most recent
   * ingested run (or `null` — "no runs yet", never a stale status).
   *
   * The composed shape is assembled here from two already-vendored contracts
   * rather than minting a third; see the plan's §7.4.
   */
  async listInstallations(
    workspaceId: string,
    agentId: string,
  ): Promise<(CiInstallation & { last_run: CiRun | null })[]> {
    await this.requireAgent(workspaceId, agentId);
    const installations = await this.container.ciRepo.listInstallationsForAgent(
      workspaceId,
      agentId,
    );
    const latest = await this.container.ciRepo.latestRunPerInstallation(
      installations.map((i) => i.id),
    );
    return installations.map((installation) => {
      const run = latest.get(installation.id);
      return {
        ...toCiInstallationDto(installation),
        last_run: run ? toCiRunDto(run) : null,
      };
    });
  }

  // ---- Update CI config (AC-30, AC-31) ------------------------------------

  /**
   * Regenerate the manifest + skill files for ONE installation (addressed by
   * its own id — there is no multi-installation variant, AC-31) and commit them
   * onto that installation's `devdigest/ci`, reusing the open PR when there is
   * one.
   *
   * The workflow file and the runner bundle are deliberately NOT in the payload:
   * a config update must not rewrite the file the user may have edited, nor
   * re-upload megabytes of unchanged runner. That also means this endpoint does
   * not read the runner bundle at all, so it keeps working when
   * `agent-runner/dist` is absent.
   */
  async updateConfig(
    workspaceId: string,
    installationId: string,
  ): Promise<{ pr_url: string | null; files: CiFile[] }> {
    const found = await this.container.ciRepo.getInstallation(workspaceId, installationId);
    if (!found) throw new NotFoundError('CI installation not found');

    const { agent, skills } = await this.loadAgentBundleInputs(workspaceId, found.agentId);
    // Regenerated through `buildBundle` (not a bespoke second renderer) so the
    // manifest bytes are identical to the ones export would write (AC-13). The
    // workflow/runner entries it also produces are filtered out below.
    const configFiles = buildBundle(agent, skills, [], {
      triggers: [...ALLOWED_TRIGGER_TYPES],
      postAs: 'github_review',
    }).filter(
      (f) => f.path.startsWith(`${AGENTS_DIR}/`) || f.path.startsWith(`${SKILLS_DIR}/`),
    );

    const { owner, name, slug } = parseRepoSlug(found.installation.repo);
    const github = await this.container.github();
    const repoRef = { owner, name };

    await this.withGitHubFailure(
      slug,
      'push commits',
      'Nothing was committed; the CI installation is unchanged.',
      () =>
        github.commitFiles(repoRef, {
          branch: CI_BRANCH,
          // The installation predates this call, so `devdigest/ci` already exists
          // and `base` is only the fallback for a branch someone deleted.
          base: 'main',
          message: UPDATE_COMMIT_MESSAGE,
          files: configFiles.map((f) => ({ path: f.path, contents: f.contents })),
        }),
    );

    const existing = await this.withGitHubFailure(
      slug,
      'read pull requests',
      `The config was committed to ${CI_BRANCH}, but the pull request could not be read.`,
      () => github.findOpenPr(repoRef, CI_BRANCH),
    );

    return { pr_url: existing?.url ?? null, files: configFiles };
  }

  // ---- internals ----------------------------------------------------------

  /**
   * AC-4, AC-12, AC-23, OQ-2 — every refusal here happens BEFORE the first
   * GitHub call and before the runner bundle is read, so a rejected request
   * creates no branch, no commit, no PR and no installation.
   */
  private validateInput(input: CiExportInput): ValidatedExportInput {
    // OQ-2 — the contract admits `circle`/`jenkins`/`cli` and `action: 'files'`
    // (the wizard renders them as disabled "coming soon" cards); the server
    // refuses them rather than half-implementing them.
    if (input.target !== 'gha') {
      throw new BadRequestError(
        `Unsupported CI target '${input.target}'. Only GitHub Actions ('gha') is supported.`,
      );
    }
    if (input.action !== 'open_pr') {
      throw new BadRequestError(
        `Unsupported export action '${input.action}'. Only 'open_pr' is supported.`,
      );
    }

    const { owner, name, slug } = parseRepoSlug(input.repo);

    // AC-23 — an empty selection, or anything outside the three allowed types,
    // is refused here rather than by narrowing the contract (which would be a
    // second dual-vendored edit).
    if (input.triggers.length === 0) {
      throw new BadRequestError('Select at least one pull-request trigger.');
    }
    const allowed = new Set<string>(ALLOWED_TRIGGER_TYPES);
    const unknown = input.triggers.filter((trigger) => !allowed.has(trigger));
    if (unknown.length > 0) {
      throw new BadRequestError(
        `Unsupported trigger type(s): ${unknown.join(', ')}. Allowed: ${ALLOWED_TRIGGER_TYPES.join(', ')}.`,
      );
    }
    // De-duplicated, and re-ordered into the constant's own order so the
    // generated workflow is byte-identical regardless of chip click order (AC-13).
    const triggers = ALLOWED_TRIGGER_TYPES.filter((allowedTrigger) =>
      input.triggers.includes(allowedTrigger),
    );

    if (!POST_AS_VALUES.includes(input.post_as)) {
      throw new BadRequestError(`Unsupported "post results as" value '${input.post_as}'.`);
    }

    if (!BASE_REF_RE.test(input.base) || input.base.includes('..')) {
      throw new BadRequestError(
        `'${input.base}' is not a valid base branch name.`,
      );
    }

    // AC-12 / OQ-6 — the authoritative check is BYTES, not characters. The
    // contract's `.max(65536)` is a character-level first gate, which a
    // multi-byte payload slips straight through.
    if (
      input.workflow !== undefined &&
      Buffer.byteLength(input.workflow, 'utf8') > WORKFLOW_OVERRIDE_MAX_BYTES
    ) {
      throw new BadRequestError(
        `The workflow override is larger than ${WORKFLOW_OVERRIDE_MAX_BYTES} bytes. Nothing was committed.`,
      );
    }

    // The size cap above is a resource guard and says nothing about CONTENT. An edited
    // workflow is committed verbatim, so without this check AC-14…AC-22 would describe
    // only what the renderer emits, not what the export actually ships.
    if (input.workflow !== undefined) {
      const problems = checkWorkflowOverride(input.workflow);
      if (problems.length > 0) {
        throw new BadRequestError(
          `The edited workflow was rejected and nothing was committed. ${problems
            .map((p) => p.detail)
            .join(' ')}`,
        );
      }
    }

    return {
      owner,
      name,
      slug,
      triggers: [...triggers],
      postAs: input.post_as,
      base: input.base,
      ...(input.workflow !== undefined ? { workflowOverride: input.workflow } : {}),
    };
  }

  /** Resolve the agent + skills + runner bytes and render the full bundle. */
  private async generate(
    workspaceId: string,
    agentId: string,
    input: ValidatedExportInput,
  ): Promise<CiFile[]> {
    const { agent, skills } = await this.loadAgentBundleInputs(workspaceId, agentId);
    // AC-8 — throws a ConfigError naming `agent-runner/dist` and the build
    // command. Deliberately before any GitHub call: a missing bundle must fail
    // the WHOLE operation, not commit four of five files.
    const runnerFiles: RunnerFile[] = await this.container.runnerBundle.read();
    return buildBundle(agent, skills, runnerFiles, {
      triggers: input.triggers,
      postAs: input.postAs,
      ...(input.workflowOverride !== undefined
        ? { workflowOverride: input.workflowOverride }
        : {}),
    });
  }

  /** The stored agent + its enabled skills, as the pure generators want them. */
  private async loadAgentBundleInputs(workspaceId: string, agentId: string) {
    const agent = await this.requireAgent(workspaceId, agentId);
    const links = await this.container.agentsRepo.linkedSkills(agentId);
    return { agent: toBundleAgent(agent), skills: toBundleSkills(links) };
  }

  /** AC-46 — an agent outside the caller's workspace is NOT FOUND, never forbidden. */
  private async requireAgent(workspaceId: string, agentId: string): Promise<AgentRow> {
    const agent = await this.container.agentsRepo.getById(workspaceId, agentId);
    if (!agent) throw new NotFoundError('Agent not found');
    return agent;
  }

  /**
   * AC-26 — a GitHub rejection surfaces as one error naming the repository and
   * the access it needs, with no installation written and nothing reported as a
   * partial success. Wrapping (rather than letting the octokit error escape)
   * also keeps a token or URL out of the client-visible message.
   */
  private async withGitHubFailure<T>(
    repoSlug: string,
    access: string,
    outcome: string,
    op: () => Promise<T>,
  ): Promise<T> {
    try {
      return await op();
    } catch (err) {
      throw new ExternalServiceError(
        `GitHub rejected the operation on ${repoSlug}: ${(err as Error).message}. ` +
          `Check that the repository exists and that the configured GitHub token can ${access} on ${repoSlug}. ` +
          outcome,
      );
    }
  }
}

// ---- pure helpers ---------------------------------------------------------

/**
 * AC-4 — `owner/name` or nothing. `acme`, `acme/`, `acme/x/y` and
 * `https://github.com/acme/x` all raise here, before any GitHub call.
 */
export function parseRepoSlug(raw: string): { owner: string; name: string; slug: string } {
  const value = raw.trim();
  if (!REPO_SLUG_RE.test(value)) {
    throw new BadRequestError(
      `'${raw}' is not a valid repository. Use the "owner/name" form, e.g. "acme/widgets".`,
    );
  }
  const [owner, name] = value.split('/') as [string, string];
  return { owner, name, slug: `${owner}/${name}` };
}

/**
 * Filename stem for a stored name. Restricted to `[a-z0-9-]`, which is what
 * makes `${AGENTS_DIR}/${slug}.yaml` provably in-bundle: a name containing
 * `../`, a leading `/` or a NUL cannot survive this (AC-11).
 */
export function slugify(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function toBundleAgent(agent: AgentRow) {
  return {
    slug: slugify(agent.name, 'agent'),
    name: agent.name,
    provider: agent.provider,
    model: agent.model,
    systemPrompt: agent.systemPrompt,
    strategy: agent.strategy,
    ciFailOn: agent.ciFailOn,
  };
}

/**
 * The skills that actually reach the prompt, in injection order — resolved with
 * the REVIEW path's own rule (`activeSkillLinks`: link enabled AND skill
 * enabled). Re-deriving it here would let the exported agent drift from the one
 * the studio runs.
 *
 * Slugs are de-duplicated with a numeric suffix: two skills named "Security"
 * would otherwise collide on one `.devdigest/skills/security.md`, silently
 * shipping one body twice.
 */
function toBundleSkills(links: LinkedSkillRow[]): BundleSkill[] {
  const seen = new Set<string>();
  return activeSkillLinks(links).map((link) => {
    const base = slugify(link.skill.name, 'skill');
    let slug = base;
    let n = 2;
    while (seen.has(slug)) slug = `${base}-${n++}`;
    seen.add(slug);
    return { slug, body: link.skill.body };
  });
}

// ---- row → contract mappers ----------------------------------------------

export function toCiInstallationDto(row: CiInstallationRow): CiInstallation {
  return {
    id: row.id,
    agent_id: row.agentId,
    repo: row.repo,
    target_type: row.targetType,
    installed_at: row.installedAt.toISOString(),
  };
}

export function toCiRunDto(row: CiRunRow): CiRun {
  return {
    id: row.id,
    ci_installation_id: row.ciInstallationId,
    pr_number: row.prNumber,
    ran_at: row.ranAt ? row.ranAt.toISOString() : null,
    status: row.status,
    findings_count: row.findingsCount,
    cost_usd: row.costUsd,
    github_url: row.githubUrl,
    source: row.source,
    agent: row.agent,
    duration_s: row.durationS,
  };
}
