/**
 * Unit tests for the pure CI-generation core: `constants.ts`, `manifest.ts`,
 * `workflow.ts`, `bundle.ts`.
 *
 * One test per workflow AC (AC-14 … AC-22), each asserting the literal
 * observable the AC names — deliberately NOT a single snapshot test. A
 * snapshot would go green on a regression that reintroduces a `paths:`
 * filter (root `INSIGHTS.md:25`).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { AgentManifest } from '@devdigest/shared';
import {
  ALLOWED_TRIGGER_TYPES,
  MEMORY_PATH,
  OPENROUTER_SECRET_NAME,
  RUNNER_DIR,
  WORKFLOW_PATH,
} from './constants.js';
import { renderManifest, type ManifestAgent } from './manifest.js';
import { renderWorkflow, type WorkflowInput } from './workflow.js';
import { buildBundle, toPreview, type BundleAgent, type BundleSkill, type RunnerFile } from './bundle.js';

const baseAgent: ManifestAgent = {
  name: 'Security Reviewer',
  provider: 'openrouter',
  model: 'anthropic/claude-sonnet-4',
  systemPrompt: 'Review this PR for security issues.',
  strategy: 'single-pass',
  ciFailOn: 'critical',
};

const bundleAgent: BundleAgent = { ...baseAgent, slug: 'security-reviewer' };

const twoSkills: BundleSkill[] = [
  { slug: 'owasp-top-10', body: '# OWASP Top 10\n\nCheck for injection.' },
  { slug: 'secrets-scan', body: '# Secrets scan\n\nNo hardcoded credentials.' },
];

const runnerFiles: RunnerFile[] = [
  { name: 'index.js', contents: 'console.log("runner");' },
  { name: 'package.json', contents: '{"type":"module"}' },
  { name: '310.index.js', contents: '// lazily-loaded chunk' },
];

const defaultWorkflowInput: WorkflowInput = {
  triggers: ['opened', 'synchronize', 'reopened'],
  postAs: 'github_review',
};

describe('bundle.ts — AC-6 (exact ordered file list)', () => {
  it('emits manifest, one file per enabled skill, memory, workflow, then one entry per runner file — in that order', () => {
    const files = buildBundle(bundleAgent, twoSkills, runnerFiles, defaultWorkflowInput);

    // Count is derived from the inputs given, not a hardcoded magic number —
    // stays honest when the runner's `dist/` output changes shape.
    // manifest(1) + memory(1) + workflow(1) + one per skill + one per runner file.
    expect(files).toHaveLength(3 + twoSkills.length + runnerFiles.length);

    const paths = files.map((f) => f.path);
    expect(paths).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      '.devdigest/skills/owasp-top-10.md',
      '.devdigest/skills/secrets-scan.md',
      MEMORY_PATH,
      WORKFLOW_PATH,
      `${RUNNER_DIR}/index.js`,
      `${RUNNER_DIR}/package.json`,
      `${RUNNER_DIR}/310.index.js`,
    ]);
  });

  it('yields exactly 3 files (no skill entries, no runner files) with zero enabled skills, and the manifest still validates', () => {
    const files = buildBundle(bundleAgent, [], [], defaultWorkflowInput);
    expect(files).toHaveLength(3);
    expect(files.map((f) => f.path)).toEqual([
      '.devdigest/agents/security-reviewer.yaml',
      MEMORY_PATH,
      WORKFLOW_PATH,
    ]);

    const manifestFile = files[0]!;
    const parsed = AgentManifest.parse(parseYaml(manifestFile.contents));
    expect(parsed.skills).toEqual([]);
  });

  it('the memory file is empty', () => {
    const files = buildBundle(bundleAgent, twoSkills, runnerFiles, defaultWorkflowInput);
    const memoryFile = files.find((f) => f.path === MEMORY_PATH);
    expect(memoryFile?.contents).toBe('');
  });

  it('skill file bodies are the raw skill text with no frontmatter added', () => {
    const files = buildBundle(bundleAgent, twoSkills, runnerFiles, defaultWorkflowInput);
    const skillFile = files.find((f) => f.path === '.devdigest/skills/owasp-top-10.md');
    expect(skillFile?.contents).toBe(twoSkills[0]!.body);
  });
});

describe('bundle.ts — AC-9 (editable flags + preview blanking)', () => {
  it('editable is true ONLY on the workflow entry', () => {
    const files = buildBundle(bundleAgent, twoSkills, runnerFiles, defaultWorkflowInput);
    for (const file of files) {
      if (file.path === WORKFLOW_PATH) {
        expect(file.editable).toBe(true);
      } else {
        expect(file.editable).toBe(false);
      }
    }
  });

  it('toPreview blanks every runner entry, not just index.js, and leaves other files untouched', () => {
    const files = buildBundle(bundleAgent, twoSkills, runnerFiles, defaultWorkflowInput);
    const preview = toPreview(files);

    for (const file of preview) {
      if (file.path.startsWith(`${RUNNER_DIR}/`)) {
        expect(file.contents).toBe('');
      }
    }
    // Non-runner files are unaffected.
    const manifestPreview = preview.find((f) => f.path === '.devdigest/agents/security-reviewer.yaml');
    expect(manifestPreview?.contents).not.toBe('');
    const workflowPreview = preview.find((f) => f.path === WORKFLOW_PATH);
    expect(workflowPreview?.contents).not.toBe('');
    expect(workflowPreview?.editable).toBe(true);
  });
});

describe('manifest.ts — AC-7 (manifest contract + round-trip)', () => {
  it('carries name, provider, model, system_prompt, skills (link order), strategy, ci_fail_on', () => {
    const yamlText = renderManifest(baseAgent, ['owasp-top-10', 'secrets-scan']);
    const parsed = parseYaml(yamlText);

    expect(parsed).toEqual({
      name: 'Security Reviewer',
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-4',
      system_prompt: 'Review this PR for security issues.',
      skills: ['owasp-top-10', 'secrets-scan'],
      strategy: 'single-pass',
      ci_fail_on: 'critical',
    });
  });

  it('the emitted YAML validates against the same AgentManifest contract the runner uses, after a yaml round-trip', () => {
    const yamlText = renderManifest(baseAgent, ['owasp-top-10']);
    const roundTripped = parseYaml(yamlText);
    const result = AgentManifest.safeParse(roundTripped);
    expect(result.success).toBe(true);
  });

  it('emits provider verbatim even though the runner ignores it (OQ-3)', () => {
    const yamlText = renderManifest({ ...baseAgent, provider: 'anthropic' }, []);
    const parsed = parseYaml(yamlText);
    expect(parsed.provider).toBe('anthropic');
  });
});

describe('manifest.ts + workflow.ts — AC-13 (byte-identical output)', () => {
  it('two manifest renders of identical input are byte-identical, including key order', () => {
    const a = renderManifest(baseAgent, ['owasp-top-10', 'secrets-scan']);
    const b = renderManifest(baseAgent, ['owasp-top-10', 'secrets-scan']);
    expect(a).toBe(b);

    // Pin the exact key sequence — not just deep-equality of the parsed
    // object, which would not catch a reordering.
    const keyOrder = a
      .split('\n')
      .filter((line) => /^[a-z_]+:/i.test(line))
      .map((line) => line.split(':')[0]);
    expect(keyOrder).toEqual([
      'name',
      'provider',
      'model',
      'system_prompt',
      'skills',
      'strategy',
      'ci_fail_on',
    ]);
  });

  it('two workflow renders of identical input are byte-identical', () => {
    const a = renderWorkflow(defaultWorkflowInput);
    const b = renderWorkflow(defaultWorkflowInput);
    expect(a).toBe(b);
  });

  it('two full bundles of identical input are byte-identical', () => {
    const a = buildBundle(bundleAgent, twoSkills, runnerFiles, defaultWorkflowInput);
    const b = buildBundle(bundleAgent, twoSkills, runnerFiles, defaultWorkflowInput);
    expect(a).toEqual(b);
  });
});

describe('workflow.ts — AC-14 (pull_request trigger only, restricted to selected types)', () => {
  it('the workflow text contains one `on:` key, `pull_request`, with `types` matching the selection', () => {
    const text = renderWorkflow({ triggers: ['opened', 'synchronize'], postAs: 'github_review' });
    const doc = parseYaml(text);

    expect(Object.keys(doc.on)).toEqual(['pull_request']);
    expect(doc.on.pull_request.types).toEqual(['opened', 'synchronize']);
  });

  it('contains no issue_comment, workflow_dispatch, push or schedule trigger', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    for (const forbidden of ['issue_comment', 'workflow_dispatch', 'push', 'schedule']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('ALLOWED_TRIGGER_TYPES is the exact set the Configure step may select', () => {
    expect(ALLOWED_TRIGGER_TYPES).toEqual(['opened', 'synchronize', 'reopened']);
  });
});

describe('workflow.ts — AC-15 (no path/branch/tag filter — load-bearing, not stylistic)', () => {
  it('contains none of paths, paths-ignore, branches, branches-ignore, tags, tags-ignore', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    for (const forbidden of [
      'paths:',
      'paths-ignore:',
      'branches:',
      'branches-ignore:',
      'tags:',
      'tags-ignore:',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('workflow.ts — AC-16 (pull_request_target never appears)', () => {
  it('the string pull_request_target does not occur anywhere in the output', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    expect(text).not.toContain('pull_request_target');
  });
});

describe('workflow.ts — AC-17 (exactly two permissions)', () => {
  it('permissions is precisely contents: read and pull-requests: write', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    const doc = parseYaml(text);
    expect(doc.permissions).toEqual({ contents: 'read', 'pull-requests': 'write' });
    expect(Object.keys(doc.permissions)).toHaveLength(2);
  });
});

describe('workflow.ts — AC-18 (fork PRs skip the job via job-level if, not an on: filter)', () => {
  it('the review job carries a job-level if comparing the PR head repo to the workflow repo', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    const doc = parseYaml(text);

    expect(doc.jobs.review.if).toContain('github.event.pull_request.head.repo.full_name');
    expect(doc.jobs.review.if).toContain('github.repository');
    // The guard must be job-level, never folded into `on:` (AC-15's own reasoning).
    expect(doc.on.pull_request.if).toBeUndefined();
  });
});

describe('workflow.ts — AC-19 (model credential referenced only as a secret name)', () => {
  it('references secrets.OPENROUTER_API_KEY and contains no key-shaped literal', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    expect(text).toContain(`secrets.${OPENROUTER_SECRET_NAME}`);
    // No sk-/OpenRouter/Anthropic-shaped literal key anywhere in the output.
    expect(text).not.toMatch(/sk-[A-Za-z0-9-_]{10,}/);
  });
});

describe('workflow.ts — AC-20 (post_as travels as a workflow env var, never a manifest field)', () => {
  it.each(['github_review', 'pr_comment', 'none'] as const)(
    'emits DEVDIGEST_POST_AS: %s on the run step',
    (postAs) => {
      const text = renderWorkflow({ ...defaultWorkflowInput, postAs });
      const doc = parseYaml(text);
      const runStep = doc.jobs.review.steps.find((s: { id?: string }) => s.id === 'review');
      expect(runStep.env.DEVDIGEST_POST_AS).toBe(postAs);
    },
  );

  it('the manifest YAML has no post_as key', () => {
    const yamlText = renderManifest(baseAgent, []);
    const parsed = parseYaml(yamlText);
    expect(parsed).not.toHaveProperty('post_as');
  });
});

describe('workflow.ts — AC-21 (invokes the runner directly; only first-party uses:)', () => {
  it('the run step executes node .devdigest/runner/index.js', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    const doc = parseYaml(text);
    const runStep = doc.jobs.review.steps.find((s: { id?: string }) => s.id === 'review');
    expect(runStep.run).toBe('node .devdigest/runner/index.js');
  });

  it('every uses: entry is a first-party GitHub action (checkout, setup-node, upload-artifact)', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    const doc = parseYaml(text);
    const usesEntries = doc.jobs.review.steps
      .map((s: { uses?: string }) => s.uses)
      .filter((u: string | undefined): u is string => u != null);

    expect(usesEntries.length).toBeGreaterThan(0);
    for (const uses of usesEntries) {
      expect(uses.startsWith('actions/')).toBe(true);
    }
  });

  it('the string devdigest/review-action does not occur', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    expect(text).not.toContain('devdigest/review-action');
  });
});

describe('workflow.ts — AC-22 (result artifact uploaded even on non-zero exit)', () => {
  it('the artifact-upload step carries if: always()', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    const doc = parseYaml(text);
    const uploadStep = doc.jobs.review.steps.find(
      (s: { uses?: string }) => typeof s.uses === 'string' && s.uses.includes('upload-artifact'),
    );
    expect(uploadStep.if).toBe('always()');
  });
});

describe('AC-48 (no grounding/fencing weakening option anywhere in the bundle)', () => {
  it('the manifest emits only keys AgentManifest defines', () => {
    const yamlText = renderManifest(baseAgent, ['owasp-top-10']);
    const parsed = parseYaml(yamlText);
    const allowedKeys = new Set(Object.keys(AgentManifest.shape));
    for (const key of Object.keys(parsed)) {
      expect(allowedKeys.has(key)).toBe(true);
    }
  });

  it('the workflow passes no input that could disable grounding or move PR content out of the fence', () => {
    const text = renderWorkflow(defaultWorkflowInput);
    for (const forbidden of [
      'DEVDIGEST_SKIP_GROUNDING',
      'SKIP_GROUNDING',
      'DISABLE_GROUNDING',
      'pr.title',
      'pr.body',
      'github.event.pull_request.title',
      'github.event.pull_request.body',
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });
});

describe('layering — these four files import only @devdigest/shared, yaml and each other', () => {
  const files = ['constants.ts', 'manifest.ts', 'workflow.ts', 'bundle.ts'];
  // Only real import/usage sites — not doc-comment prose that happens to
  // mention these words while explaining why they are absent.
  const forbidden = [
    /from ['"]fs['"]/,
    /from ['"]node:fs['"]/,
    /process\.env[.[]/,
    /from ['"]drizzle-orm/,
    /from ['"]fastify/,
    /from ['"]octokit/,
    /from ['"]@octokit/,
  ];

  it.each(files)('%s has no fs/env/Drizzle/Fastify/octokit import', (filename) => {
    const source = readFileSync(path.join(import.meta.dirname, filename), 'utf8');
    const importLines = source
      .split('\n')
      .filter((line) => line.trim().startsWith('import') || line.includes('process.env'));
    for (const pattern of forbidden) {
      expect(importLines.some((line) => pattern.test(line))).toBe(false);
    }
  });
});
