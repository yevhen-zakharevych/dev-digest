/**
 * Fixed paths, names and bounds for the generated CI bundle.
 *
 * Single source of truth for every literal the generated workflow and the
 * CI runner (`agent-runner/`) must agree on. `agent-runner/src/index.ts:5`'s
 * doc comment already points at this file — keep the name.
 *
 * PURE: no `fs`, no `process.env`, no imports beyond this module's own
 * constants. `manifest.ts`, `workflow.ts` and `bundle.ts` import from here
 * instead of repeating a path literal.
 */

/** Directory holding the single checked-in agent manifest (AC-6). */
export const AGENTS_DIR = '.devdigest/agents';

/** Directory holding the resolved skill bodies the manifest's `skills` slugs reference. */
export const SKILLS_DIR = '.devdigest/skills';

/** Empty placeholder memory file shipped with every export (AC-6). */
export const MEMORY_PATH = '.devdigest/memory.jsonl';

/**
 * Directory the prebuilt runner ships into. The runner is NOT a single file:
 * `ncc` emits `index.js` plus a `package.json` (`{"type":"module"}` — load
 * bearing, since the target repo's own nearest `package.json` almost never
 * declares ESM) plus lazily-loaded chunk files whose names are not stable
 * across `agent-runner` dependency changes. `bundle.ts` therefore takes
 * "whatever is in `agent-runner/dist/`" as a list, one `CiFile` per entry
 * under this directory — never a hardcoded filename list.
 */
export const RUNNER_DIR = '.devdigest/runner';

/** Path of the prebuilt runner entry point, invoked directly by the workflow (AC-21). */
export const RUNNER_ENTRY_PATH = `${RUNNER_DIR}/index.js`;

/** Path of the generated GitHub Actions workflow inside the target repo (AC-6, AC-10). */
export const WORKFLOW_PATH = '.github/workflows/devdigest-review.yml';

/** Basename of the workflow file — used to query Actions runs for it (AC-32). */
export const WORKFLOW_FILE_BASENAME = 'devdigest-review.yml';

/** Display name of the generated workflow (the `name:` key, shown in the Actions tab). */
export const WORKFLOW_NAME = 'DevDigest CI Review';

/** Name of the uploaded result artifact (AC-22); the name `downloadRunResultArtifact` looks up. */
export const RESULT_ARTIFACT_NAME = 'devdigest-result';

/** Filename the runner writes its result JSON to, and the single entry read out of the artifact archive (AC-36). */
export const RESULT_FILENAME = 'devdigest-result.json';

/** Branch every export commits onto (AC-24); reused, never duplicated, across re-exports (AC-25, AC-27). */
export const CI_BRANCH = 'devdigest/ci';

/** Title of the pull request opened by install (AC-24). */
export const PR_TITLE = 'Add DevDigest CI review';

/** The only trigger types the Configure step may select (AC-14, AC-23). */
export const ALLOWED_TRIGGER_TYPES = ['opened', 'synchronize', 'reopened'] as const;
export type WorkflowTriggerType = (typeof ALLOWED_TRIGGER_TYPES)[number];

/** The only "Post results as" choices the runner understands (`agent-runner/src/index.ts:25-28`). */
export const POST_AS_VALUES = ['github_review', 'pr_comment', 'none'] as const;
export type PostAs = (typeof POST_AS_VALUES)[number];

/**
 * Actions secret the workflow reads the model credential from (AC-19). The
 * generated workflow never contains a credential VALUE — only this name,
 * referenced as `secrets.OPENROUTER_API_KEY`.
 */
export const OPENROUTER_SECRET_NAME = 'OPENROUTER_API_KEY';

/** First-party-only `uses:` references (AC-21) — no marketplace action. */
export const CHECKOUT_ACTION = 'actions/checkout@v4';
export const SETUP_NODE_ACTION = 'actions/setup-node@v4';
export const UPLOAD_ARTIFACT_ACTION = 'actions/upload-artifact@v4';
export const NODE_VERSION = '20';

/** Byte ceiling for a client-supplied workflow override (AC-12, OQ-6: bytes, not characters). */
export const WORKFLOW_OVERRIDE_MAX_BYTES = 65536;

/** Byte ceiling for a downloaded result artifact archive (AC-36). */
export const RESULT_ARCHIVE_MAX_BYTES = 5 * 1024 * 1024;

/** Most recent workflow runs fetched per installation per refresh (AC-32). */
export const MAX_WORKFLOW_RUNS = 20;
