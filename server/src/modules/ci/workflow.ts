/**
 * Renders the generated GitHub Actions workflow (AC-14 … AC-22).
 *
 * PURE: imports only `./constants.js` and `yaml`. No `fs`, no `process.env`,
 * no octokit. Every fixed literal (paths, action refs, secret name) comes
 * from `constants.ts` — nothing here repeats one.
 *
 * Two landmines this file exists to not reproduce:
 *  - root `INSIGHTS.md:25` — a required GitHub check must NEVER carry a
 *    `paths:` filter on `on:` (a non-matching PR then sits on "Expected"
 *    forever and can never merge). AC-15 forbids it; AC-18's fork guard is
 *    therefore a JOB-LEVEL `if:`, never an `on:` condition — a skipped job
 *    still counts as success for branch protection, a workflow that never
 *    triggered does not.
 *  - root `INSIGHTS.md:27` — the studio's known prompt-injection hole (PR
 *    metadata escaping the untrusted fence) must not be reproduced here
 *    (AC-48). This module passes no PR content at all — it only shapes the
 *    trigger, permissions and the `DEVDIGEST_POST_AS` env var.
 */
import { stringify } from 'yaml';
import {
  CHECKOUT_ACTION,
  NODE_VERSION,
  OPENROUTER_SECRET_NAME,
  RESULT_ARTIFACT_NAME,
  RESULT_FILENAME,
  RUNNER_ENTRY_PATH,
  SETUP_NODE_ACTION,
  UPLOAD_ARTIFACT_ACTION,
  WORKFLOW_NAME,
  type PostAs,
  type WorkflowTriggerType,
} from './constants.js';

/** GitHub Actions expression comparing the PR head repo to the workflow's own repo (AC-18). */
const FORK_GUARD_EXPRESSION =
  '${{ github.event.pull_request.head.repo.full_name == github.repository }}';

export interface WorkflowInput {
  /** Selected trigger types from the Configure step — never empty (AC-23 is enforced by the caller). */
  triggers: readonly WorkflowTriggerType[];
  /** "Post results as" choice, passed through as an env var, never a manifest field (AC-20). */
  postAs: PostAs;
}

/**
 * Builds the workflow YAML for `input`.
 *
 * AC-13: identical `input` always produces byte-identical text — an
 * explicitly ordered plain object passed to `yaml.stringify`, never a spread.
 */
export function renderWorkflow(input: WorkflowInput): string {
  const doc = {
    name: WORKFLOW_NAME,
    // AC-14: the ONLY trigger is `pull_request`, restricted to the selected
    // types. AC-15: deliberately no `paths`/`branches`/`tags` filter of any
    // kind here — see the module doc comment. AC-16: `pull_request_target`
    // never appears anywhere in this file.
    on: {
      pull_request: {
        types: [...input.triggers],
      },
    },
    // AC-17: exactly these two permissions, nothing else.
    permissions: {
      contents: 'read',
      'pull-requests': 'write',
    },
    // Cost guard, not a correctness one. With `synchronize` selected, every push to an
    // open PR starts a fresh model-spending run and nothing supersedes the previous one —
    // so anyone who can push a branch can burn the repository owner's API key by
    // force-pushing in a loop. Superseding in-flight runs for the same PR bounds that to
    // one run per PR at a time.
    concurrency: {
      group: 'devdigest-review-${{ github.event.pull_request.number }}',
      'cancel-in-progress': true,
    },
    jobs: {
      review: {
        'runs-on': 'ubuntu-latest',
        // A hung model call must not hold a runner (and bill for it) indefinitely.
        'timeout-minutes': 20,
        // AC-18: job-level `if:` (NOT an `on:` filter) skips fork PRs while
        // still letting the workflow run — and therefore the check — exist.
        if: FORK_GUARD_EXPRESSION,
        steps: [
          {
            name: 'Checkout',
            uses: CHECKOUT_ACTION,
            with: { 'fetch-depth': 0 },
          },
          {
            name: 'Set up Node.js',
            uses: SETUP_NODE_ACTION,
            with: { 'node-version': NODE_VERSION },
          },
          {
            // AC-21: invokes the runner committed in the same PR directly;
            // no marketplace action anywhere in this file.
            name: 'Run DevDigest review',
            id: 'review',
            run: `node ${RUNNER_ENTRY_PATH}`,
            env: {
              // AC-19: the model credential is referenced ONLY by secret
              // name — no credential value is ever written into this file.
              OPENROUTER_API_KEY: `\${{ secrets.${OPENROUTER_SECRET_NAME} }}`,
              // The Actions-provided token, not a model credential — exempt from AC-19.
              GITHUB_TOKEN: '${{ secrets.GITHUB_TOKEN }}',
              // AC-20: passed as an env var; the manifest contract gains no `post_as` key.
              DEVDIGEST_POST_AS: input.postAs,
            },
          },
          {
            // AC-22: uploaded even when the review step exits non-zero.
            name: 'Upload result artifact',
            if: 'always()',
            uses: UPLOAD_ARTIFACT_ACTION,
            with: {
              name: RESULT_ARTIFACT_NAME,
              path: RESULT_FILENAME,
            },
          },
        ],
      },
    },
  };

  return stringify(doc);
}
