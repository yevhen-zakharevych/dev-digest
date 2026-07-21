/**
 * workflow-guard.ts — safety check for a USER-EDITED workflow override.
 *
 * Why this file exists. The wizard deliberately lets the user edit the generated
 * workflow, and `service.ts` then commits that text verbatim. Without this check, every
 * property the workflow renderer guarantees — `pull_request` only, exactly two
 * permissions, no `pull_request_target` — is a property of the DEFAULT output and not of
 * the file that actually lands in the target repository. The malicious version arrives
 * inside a pull request titled "Add DevDigest CI review", alongside four legitimate
 * generated files and a ~1.5 MB runner bundle, in the one file the wizard itself labels
 * "editable" — i.e. in the place a human reviewer is least likely to read closely.
 *
 * Scope, deliberately narrow. This is NOT a general workflow linter and must not become
 * one: the point of an editable field is that people can tweak `runs-on`, pin a Node
 * version, add a step. It rejects exactly the two escalations that turn the exported
 * workflow into something categorically more dangerous than what we generate:
 *
 *   1. `pull_request_target` — runs with the BASE repository's secrets against a PR's
 *      code. This is the single most dangerous trigger in Actions and the reason the spec
 *      forbids it outright.
 *   2. Permissions beyond what the generated workflow grants — notably `write-all`, and
 *      any write scope other than `pull-requests`.
 *
 * Everything else is allowed through on purpose.
 */
import { parse } from 'yaml';

/** Strongest grant the generated workflow issues, per scope. Anything absent ⇒ `none`. */
const MAX_PERMISSION: Record<string, PermissionLevel> = {
  contents: 'read',
  'pull-requests': 'write',
};

type PermissionLevel = 'none' | 'read' | 'write';
const RANK: Record<PermissionLevel, number> = { none: 0, read: 1, write: 2 };

function levelOf(value: unknown): PermissionLevel | null {
  return value === 'none' || value === 'read' || value === 'write' ? value : null;
}

export interface WorkflowOverrideProblem {
  /** Stable machine code — the HTTP layer turns these into one message. */
  code: 'unparseable' | 'pull_request_target' | 'permission_escalation';
  detail: string;
}

/** Collect every `permissions:` block: the top-level one plus each job's. */
function permissionBlocks(doc: Record<string, unknown>): unknown[] {
  const blocks: unknown[] = [];
  if ('permissions' in doc) blocks.push(doc.permissions);
  const jobs = doc.jobs;
  if (jobs && typeof jobs === 'object') {
    for (const job of Object.values(jobs as Record<string, unknown>)) {
      if (job && typeof job === 'object' && 'permissions' in job) {
        blocks.push((job as Record<string, unknown>).permissions);
      }
    }
  }
  return blocks;
}

/**
 * Returns every problem found. An empty array means the override may be committed.
 *
 * Fails CLOSED: text we cannot parse is rejected rather than waved through, because a
 * check that cannot read the document cannot vouch for it.
 */
export function checkWorkflowOverride(text: string): WorkflowOverrideProblem[] {
  const problems: WorkflowOverrideProblem[] = [];

  // Substring check first, independent of parsing: `pull_request_target` is dangerous
  // wherever it appears, including places a naive `on:`-only walk would miss (an anchor,
  // an alias, a second document).
  if (text.includes('pull_request_target')) {
    problems.push({
      code: 'pull_request_target',
      detail:
        "`pull_request_target` runs with the base repository's secrets against the pull request's own code. It is never allowed in an exported workflow.",
    });
  }

  let doc: unknown;
  try {
    doc = parse(text);
  } catch (err) {
    problems.push({
      code: 'unparseable',
      detail: `The workflow is not valid YAML (${(err as Error).message}).`,
    });
    return problems;
  }
  if (!doc || typeof doc !== 'object') {
    problems.push({ code: 'unparseable', detail: 'The workflow is not a YAML mapping.' });
    return problems;
  }

  for (const block of permissionBlocks(doc as Record<string, unknown>)) {
    // The shorthand string forms: `permissions: write-all` grants write on EVERY scope.
    if (typeof block === 'string') {
      if (block !== 'read-all' && block !== 'none') {
        problems.push({
          code: 'permission_escalation',
          detail: `\`permissions: ${block}\` grants more than the exported workflow needs (contents: read, pull-requests: write).`,
        });
      }
      continue;
    }
    if (!block || typeof block !== 'object') continue;

    for (const [scope, value] of Object.entries(block as Record<string, unknown>)) {
      const level = levelOf(value);
      if (level === null) {
        problems.push({
          code: 'permission_escalation',
          detail: `\`permissions.${scope}\` has an unrecognized value; only none/read/write are allowed.`,
        });
        continue;
      }
      const allowed = MAX_PERMISSION[scope] ?? 'none';
      if (RANK[level] > RANK[allowed]) {
        problems.push({
          code: 'permission_escalation',
          detail: `\`permissions.${scope}: ${level}\` exceeds what the exported workflow grants (${allowed}).`,
        });
      }
    }
  }

  return problems;
}
