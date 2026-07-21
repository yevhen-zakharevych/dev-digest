/**
 * Assembles the ordered list of generated files (AC-6) and the preview
 * transform that omits the runner bundle's contents (AC-9).
 *
 * PURE: imports only `@devdigest/shared`, `./constants.js`, `./manifest.js`
 * and `./workflow.js`. No `fs`, no network, no Drizzle. The runner's bytes
 * arrive as the `runnerFiles` parameter — this module never reads them from
 * disk.
 */
import type { CiFile } from '@devdigest/shared';
import { AGENTS_DIR, MEMORY_PATH, RUNNER_DIR, SKILLS_DIR, WORKFLOW_PATH } from './constants.js';
import { renderManifest, type ManifestAgent } from './manifest.js';
import { renderWorkflow, type WorkflowInput } from './workflow.js';

/** The subset of a stored agent this module needs, plus the slug its manifest path is named after. */
export interface BundleAgent extends ManifestAgent {
  /** Filename stem for `.devdigest/agents/<slug>.yaml` — computed by the caller. */
  slug: string;
}

/** One enabled, resolved skill — already filtered/ordered by the caller (`service.ts`). */
export interface BundleSkill {
  /** Filename stem for `.devdigest/skills/<slug>.md`. */
  slug: string;
  /** Raw skill text, no frontmatter — the runner reads the whole file as the body. */
  body: string;
}

/**
 * One file read (by the caller, `runner-bundle.ts`, from `agent-runner/dist/`)
 * out of the prebuilt runner directory. `name` is a relative filename inside
 * that directory (e.g. `index.js`, `package.json`, a numbered chunk file) —
 * whatever `ncc` produced, not a fixed list this module hardcodes.
 */
export interface RunnerFile {
  name: string;
  contents: string;
}

/** Wizard input this module needs to render the workflow, plus an optional verbatim override. */
export interface BundleWorkflowInput extends WorkflowInput {
  /**
   * The user-edited workflow TEXT from the wizard's Preview step (AC-10). When
   * present, it replaces the generated workflow text VERBATIM — the path is
   * always `constants.ts`'s `WORKFLOW_PATH`, never caller-supplied (AC-11).
   */
  workflowOverride?: string;
}

/**
 * Builds the bundle for `agent` + `skills`, given the prebuilt runner's
 * `runnerFiles` (read by the caller from `agent-runner/dist/` — whatever is
 * in there, not a fixed list) and the wizard's `input`.
 *
 * AC-6: exactly, in this stable order — manifest, one file per enabled skill,
 * empty memory placeholder, workflow, then one entry per `runnerFiles` item
 * under `.devdigest/runner/`. Zero enabled skills still yields
 * `4 + runnerFiles.length` files and a manifest with an empty `skills` list
 * that validates.
 *
 * AC-9: `editable` is `true` ONLY on the workflow entry. The contract
 * (`CiFile.editable`) defaults to `true`, so every other entry below sets it
 * explicitly to `false` — omitting one would silently make that file
 * editable in the shipped bundle.
 *
 * AC-13: byte-identical output for identical inputs — this function performs
 * no randomness, no timestamp, no Map iteration order; it only calls the
 * other pure renderers and assembles a fixed-shape array from `runnerFiles`
 * in the order given.
 */
export function buildBundle(
  agent: BundleAgent,
  skills: readonly BundleSkill[],
  runnerFiles: readonly RunnerFile[],
  input: BundleWorkflowInput,
): CiFile[] {
  const manifestContents = renderManifest(agent, skills.map((s) => s.slug));
  const workflowContents =
    input.workflowOverride ?? renderWorkflow({ triggers: input.triggers, postAs: input.postAs });

  const files: CiFile[] = [
    { path: `${AGENTS_DIR}/${agent.slug}.yaml`, contents: manifestContents, editable: false },
    ...skills.map((skill) => ({
      path: `${SKILLS_DIR}/${skill.slug}.md`,
      contents: skill.body,
      editable: false,
    })),
    { path: MEMORY_PATH, contents: '', editable: false },
    { path: WORKFLOW_PATH, contents: workflowContents, editable: true },
    ...runnerFiles.map((file) => ({
      path: `${RUNNER_DIR}/${file.name}`,
      contents: file.contents,
      editable: false,
    })),
  ];

  return files;
}

/**
 * Preview transform (AC-9): same file list, but EVERY runner entry's
 * contents are blanked (not just `index.js`) so the response payload never
 * transmits any part of the (multi-megabyte) runner bundle. `editable` flags
 * are passed through unchanged.
 */
export function toPreview(files: readonly CiFile[]): CiFile[] {
  const runnerPrefix = `${RUNNER_DIR}/`;
  return files.map((file) =>
    file.path.startsWith(runnerPrefix) ? { ...file, contents: '' } : { ...file },
  );
}
